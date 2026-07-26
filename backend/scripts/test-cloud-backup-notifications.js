const assert = require('assert');
const path = require('path');

const servicePath = require.resolve('../src/services/cloudBackupNotificationService');
const emailPath = require.resolve('../src/services/emailService');
const settingsPath = require.resolve('../src/services/cloudBackupSettingsService');
const auditPath = require.resolve('../src/services/auditService');

const sentEmails = [];
const auditEvents = [];
let deliveryFails = false;
let settings = {
  active_provider: 'mega_s3',
  failure_email_enabled: true,
  failure_email_recipients: ['admin@example.test'],
  failure_email_on_recovery: true
};

require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async (message) => {
      if (deliveryFails) throw new Error('SMTP_PASSWORD_MUST_NOT_LEAK');
      sentEmails.push(message);
    }
  }
};
require.cache[settingsPath] = {
  id: settingsPath,
  filename: settingsPath,
  loaded: true,
  exports: { getRawSettings: async () => ({ ...settings }) }
};
require.cache[auditPath] = {
  id: auditPath,
  filename: auditPath,
  loaded: true,
  exports: {
    recordAuditEvent: async (event) => {
      auditEvents.push(event);
    }
  }
};
delete require.cache[servicePath];

const {
  buildFailureEmail,
  notifyCloudBackupFailure,
  notifyCloudBackupRecovery
} = require(servicePath);

const run = async () => {
  const safeEmail = buildFailureEmail({
    provider: 'mega_s3',
    triggerType: 'manual',
    error: {
      name: 'CloudBackupError',
      code: 'CLOUD_BACKUP_RUN_FAILED',
      message: 'secretAccessKey=REAL_SECRET_SHOULD_NOT_APPEAR'
    }
  });
  assert.match(safeEmail.subject, /Falha no backup em nuvem/);
  assert.doesNotMatch(safeEmail.text, /REAL_SECRET_SHOULD_NOT_APPEAR|secretAccessKey/);
  assert.match(safeEmail.text, /Mega S3/);
  assert.match(safeEmail.text, /manual/);

  const sent = await notifyCloudBackupFailure({
    provider: 'mega_s3',
    triggerType: 'scheduled',
    error: { code: 'CLOUD_BACKUP_TEST_FAILED' }
  });
  assert.equal(sent.sent, true);
  assert.equal(sentEmails.length, 1);
  assert.equal(auditEvents.at(-1).action, 'cloud_backup_failure_email_sent');
  assert.equal(JSON.stringify(auditEvents.at(-1)).includes('admin@example.test'), false);

  const recovered = await notifyCloudBackupRecovery({
    provider: 'mega_s3',
    triggerType: 'scheduled'
  });
  assert.equal(recovered.sent, true);
  assert.equal(sentEmails.length, 2);
  assert.equal(auditEvents.at(-1).action, 'cloud_backup_recovery_email_sent');

  deliveryFails = true;
  const failedDelivery = await notifyCloudBackupFailure({
    provider: 'ftp',
    triggerType: 'test',
    error: new Error('FTP_PASSWORD_MUST_NOT_LEAK')
  });
  assert.equal(failedDelivery.sent, false);
  assert.equal(auditEvents.at(-1).action, 'cloud_backup_failure_email_failed');
  assert.doesNotMatch(JSON.stringify(auditEvents), /SMTP_PASSWORD_MUST_NOT_LEAK|FTP_PASSWORD_MUST_NOT_LEAK/);

  settings = { ...settings, failure_email_enabled: false };
  const skipped = await notifyCloudBackupFailure({
    provider: 'ftp',
    triggerType: 'manual',
    error: new Error('ignored')
  });
  assert.equal(skipped.skipped, true);

  assert.equal(path.basename(servicePath), 'cloudBackupNotificationService.js');
  console.log('Cloud Backup notification tests passed.');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
