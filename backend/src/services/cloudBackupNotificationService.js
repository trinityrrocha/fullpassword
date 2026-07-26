const { sendEmail } = require('./emailService');
const { recordAuditEvent } = require('./auditService');
const { getRawSettings } = require('./cloudBackupSettingsService');
const { safeLogError } = require('../utils/safeLogger');

const PROVIDER_LABELS = Object.freeze({
  google_drive: 'Google Drive',
  backblaze_b2: 'Backblaze B2',
  mega_s3: 'Mega S3',
  ftp: 'FTP/FTPS',
  none: 'Nenhum'
});

const SAFE_ERROR_MESSAGES = Object.freeze({
  CLOUD_BACKUP_PROVIDER_REQUIRED: 'Nenhum provedor de Backup Nuvem está ativo.',
  CLOUD_BACKUP_PROVIDER_NOT_CONFIGURED: 'O provedor ativo ainda não está configurado.',
  CLOUD_BACKUP_PASSPHRASE_REQUIRED: 'A frase de criptografia do backup não está definida.',
  CLOUD_BACKUP_INVALID_ENDPOINT: 'O endpoint do armazenamento remoto é inválido.',
  CLOUD_BACKUP_INVALID_FTP_HOST: 'O host FTP é inválido.',
  CLOUD_BACKUP_TEST_FAILED: 'A comunicação com o armazenamento remoto falhou.',
  CLOUD_BACKUP_RUN_FAILED: 'Não foi possível concluir o envio do Backup Nuvem.',
  GOOGLE_DRIVE_NOT_CONNECTED: 'A conta Google Drive não está conectada.',
  GOOGLE_DRIVE_API_ERROR: 'A comunicação com o Google Drive falhou.'
});

const safeFailureMessage = (error) => {
  if (SAFE_ERROR_MESSAGES[error?.code]) return SAFE_ERROR_MESSAGES[error.code];
  return 'Não foi possível concluir a operação de Backup Nuvem.';
};

const buildFailureEmail = ({ provider, triggerType, error, occurredAt = new Date() }) => {
  const providerLabel = PROVIDER_LABELS[provider] || 'Não identificado';
  const message = safeFailureMessage(error);
  return {
    subject: '[FullPassword] Falha no backup em nuvem',
    text: [
      'O FullPassword não conseguiu concluir o backup em nuvem.',
      '',
      `Provedor: ${providerLabel}`,
      `Data/hora: ${occurredAt.toISOString()}`,
      `Tipo de execução: ${triggerType}`,
      `Erro: ${message}`,
      '',
      'Acesse o painel do FullPassword para mais detalhes.'
    ].join('\n')
  };
};

const buildRecoveryEmail = ({ provider, triggerType, occurredAt = new Date() }) => ({
  subject: '[FullPassword] Backup em nuvem normalizado',
  text: [
    'O FullPassword voltou a concluir o backup em nuvem com sucesso.',
    '',
    `Provedor: ${PROVIDER_LABELS[provider] || 'Não identificado'}`,
    `Data/hora: ${occurredAt.toISOString()}`,
    `Tipo de execução: ${triggerType}`,
    '',
    'Acesse o painel do FullPassword para mais detalhes.'
  ].join('\n')
});

const deliverNotification = async ({
  actionSent,
  actionFailed,
  email,
  provider,
  triggerType,
  recipients,
  user,
  req
}) => {
  const deliveries = await Promise.allSettled(
    recipients.map((to) => sendEmail({ to, ...email }))
  );
  const failedCount = deliveries.filter((delivery) => delivery.status === 'rejected').length;
  const metadata = {
    provider,
    trigger_type: triggerType,
    recipient_count: recipients.length
  };
  if (failedCount === 0) {
    await recordAuditEvent({
      user,
      action: actionSent,
      status: 'success',
      req,
      metadata
    });
    return { sent: true, recipient_count: recipients.length };
  }
  await recordAuditEvent({
    user,
    action: actionFailed,
    status: 'failed',
    req,
    metadata: {
      ...metadata,
      failed_count: failedCount,
      reason: 'smtp_delivery_unavailable'
    }
  });
  safeLogError('Falha sanitizada ao enviar notificação do Backup Nuvem.', {
    name: 'CloudBackupNotificationDeliveryError'
  }, { includeStack: false });
  return { sent: false, failed_count: failedCount };
};

const notifyCloudBackupFailure = async ({
  provider,
  triggerType,
  error,
  user = null,
  req = null
} = {}) => {
  try {
    const settings = await getRawSettings();
    if (settings.failure_email_enabled !== true) return { skipped: true, reason: 'disabled' };
    const recipients = Array.isArray(settings.failure_email_recipients)
      ? settings.failure_email_recipients
      : [];
    if (!recipients.length) return { skipped: true, reason: 'no_recipients' };
    return deliverNotification({
      actionSent: 'cloud_backup_failure_email_sent',
      actionFailed: 'cloud_backup_failure_email_failed',
      email: buildFailureEmail({
        provider: provider || settings.active_provider,
        triggerType,
        error
      }),
      provider: provider || settings.active_provider,
      triggerType,
      recipients,
      user,
      req
    });
  } catch {
    safeLogError('Falha sanitizada ao preparar notificação do Backup Nuvem.', {
      name: 'CloudBackupNotificationError'
    }, { includeStack: false });
    return { sent: false, reason: 'notification_unavailable' };
  }
};

const notifyCloudBackupRecovery = async ({
  provider,
  triggerType,
  user = null,
  req = null
} = {}) => {
  try {
    const settings = await getRawSettings();
    if (
      settings.failure_email_enabled !== true
      || settings.failure_email_on_recovery !== true
    ) return { skipped: true, reason: 'disabled' };
    const recipients = Array.isArray(settings.failure_email_recipients)
      ? settings.failure_email_recipients
      : [];
    if (!recipients.length) return { skipped: true, reason: 'no_recipients' };
    return deliverNotification({
      actionSent: 'cloud_backup_recovery_email_sent',
      actionFailed: 'cloud_backup_failure_email_failed',
      email: buildRecoveryEmail({ provider, triggerType }),
      provider,
      triggerType,
      recipients,
      user,
      req
    });
  } catch {
    safeLogError('Falha sanitizada ao preparar e-mail de normalização do Backup Nuvem.', {
      name: 'CloudBackupRecoveryNotificationError'
    }, { includeStack: false });
    return { sent: false, reason: 'notification_unavailable' };
  }
};

module.exports = {
  PROVIDER_LABELS,
  safeFailureMessage,
  buildFailureEmail,
  buildRecoveryEmail,
  notifyCloudBackupFailure,
  notifyCloudBackupRecovery
};
