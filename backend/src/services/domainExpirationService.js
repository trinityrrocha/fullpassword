const crypto = require('crypto');
const db = require('../config/database');
const { sendEmail } = require('./emailService');
const { safeLogError } = require('../utils/safeLogger');

const DOMAIN_EXPIRATION_LOCK_ID = 8142031;
const MAX_NOTIFICATIONS_PER_CLIENT = 100;
const MAX_EMAILS_PER_NOTIFICATION = 20;

class DomainExpirationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DomainExpirationValidationError';
    this.statusCode = 400;
  }
}

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

const parseIsoDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
};

const getDateInTimeZone = (date = new Date(), timeZone = 'America/Sao_Paulo') => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const getDomainExpirationEvent = (expirationDate, today) => {
  const expiration = parseIsoDate(expirationDate);
  const current = parseIsoDate(today);
  if (!expiration || !current) return null;
  const daysUntilExpiration = Math.round((expiration.getTime() - current.getTime()) / 86400000);
  if ([30, 15, 5].includes(daysUntilExpiration)) return { key: `before-${daysUntilExpiration}`, expired: false, daysUntilExpiration };
  if (daysUntilExpiration === 0) return { key: 'due', expired: true, daysUntilExpiration };
  if (daysUntilExpiration >= -10 && daysUntilExpiration <= -1) return { key: `expired-${Math.abs(daysUntilExpiration)}`, expired: true, daysUntilExpiration };
  return null;
};

const buildDomainExpirationEmail = (domain, event) => event.expired
  ? {
      subject: `Domínio vencido: ${domain}`,
      text: `Seu domínio "${domain}" está com o status vencido. Por favor, faça a renovação para manter os serviços ativos.`
    }
  : {
      subject: `Domínio próximo do vencimento: ${domain}`,
      text: `Seu domínio "${domain}" está próximo do vencimento. Por favor, faça a renovação para manter os serviços ativos.`
    };

const normalizeNotification = (notification) => {
  const hostingServerId = String(notification?.hostingServerId || '').trim();
  const domain = String(notification?.domain || '').trim().toLowerCase();
  const expirationDate = String(notification?.expirationDate || '').trim();
  const emails = [...new Set((Array.isArray(notification?.emails) ? notification.emails : [])
    .map((email) => String(email || '').trim().toLowerCase())
    .filter(Boolean))];

  if (!hostingServerId || hostingServerId.length > 200) throw new DomainExpirationValidationError('Identificador de hospedagem inválido.');
  if (!domain || domain.length > 253 || /[\s/@]/.test(domain)) throw new DomainExpirationValidationError('Domínio de notificação inválido.');
  if (!parseIsoDate(expirationDate)) throw new DomainExpirationValidationError('Data de vencimento inválida.');
  if (!emails.length || emails.length > MAX_EMAILS_PER_NOTIFICATION || emails.some((email) => !isValidEmail(email))) {
    throw new DomainExpirationValidationError('Lista de e-mails de notificação inválida.');
  }
  return { hostingServerId, domain, expirationDate, emails };
};

const syncDomainExpirationNotifications = async (clientId, notifications, updatedBy) => {
  if (!Array.isArray(notifications) || notifications.length > MAX_NOTIFICATIONS_PER_CLIENT) {
    throw new DomainExpirationValidationError('Lista de notificações de domínio inválida.');
  }
  const normalized = notifications.map(normalizeNotification);
  if (new Set(normalized.map((item) => item.hostingServerId)).size !== normalized.length) {
    throw new DomainExpirationValidationError('Há identificadores de hospedagem duplicados.');
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const notification of normalized) {
      await client.query(
        `INSERT INTO domain_expiration_notifications (
           client_id, hosting_server_id, domain, expiration_date, notify_emails, updated_by
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (client_id, hosting_server_id) DO UPDATE SET
           domain = EXCLUDED.domain,
           expiration_date = EXCLUDED.expiration_date,
           notify_emails = EXCLUDED.notify_emails,
           sent_keys = CASE
             WHEN domain_expiration_notifications.expiration_date IS DISTINCT FROM EXCLUDED.expiration_date
               OR domain_expiration_notifications.domain IS DISTINCT FROM EXCLUDED.domain
             THEN '[]'::jsonb ELSE domain_expiration_notifications.sent_keys END,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
        [clientId, notification.hostingServerId, notification.domain, notification.expirationDate, JSON.stringify(notification.emails), updatedBy]
      );
    }
    if (normalized.length) {
      await client.query(
        'DELETE FROM domain_expiration_notifications WHERE client_id = $1 AND NOT (hosting_server_id = ANY($2::text[]))',
        [clientId, normalized.map((item) => item.hostingServerId)]
      );
    } else {
      await client.query('DELETE FROM domain_expiration_notifications WHERE client_id = $1', [clientId]);
    }
    await client.query('COMMIT');
    return normalized.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const recipientKey = (today, eventKey, email) => `${today}:${eventKey}:${crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)}`;

const processDomainExpirationNotifications = async ({ now = new Date(), timeZone = 'America/Sao_Paulo' } = {}) => {
  const client = await db.pool.connect();
  let lockAcquired = false;
  let delivered = 0;
  try {
    const lockResult = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [DOMAIN_EXPIRATION_LOCK_ID]);
    lockAcquired = Boolean(lockResult.rows[0]?.acquired);
    if (!lockAcquired) return { delivered: 0, skipped: true };

    const today = getDateInTimeZone(now, timeZone);
    const result = await client.query('SELECT client_id, hosting_server_id, domain, expiration_date::text, notify_emails, sent_keys FROM domain_expiration_notifications ORDER BY client_id, hosting_server_id');
    for (const row of result.rows) {
      const event = getDomainExpirationEvent(row.expiration_date, today);
      if (!event) continue;
      const sentKeys = Array.isArray(row.sent_keys) ? row.sent_keys : [];
      const emails = Array.isArray(row.notify_emails) ? row.notify_emails.filter(isValidEmail) : [];
      for (const email of emails) {
        const key = recipientKey(today, event.key, email);
        if (sentKeys.includes(key)) continue;
        try {
          await sendEmail({ to: email, ...buildDomainExpirationEmail(row.domain, event) });
          await client.query(
            `UPDATE domain_expiration_notifications
             SET sent_keys = CASE WHEN sent_keys ? $3 THEN sent_keys ELSE sent_keys || to_jsonb($3::text) END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE client_id = $1 AND hosting_server_id = $2`,
            [row.client_id, row.hosting_server_id, key]
          );
          sentKeys.push(key);
          delivered += 1;
        } catch (error) {
          safeLogError('Falha segura ao enviar notificação de vencimento de domínio.', { name: error?.name, code: error?.code }, { includeStack: false });
        }
      }
    }
    return { delivered, skipped: false };
  } finally {
    if (lockAcquired) await client.query('SELECT pg_advisory_unlock($1)', [DOMAIN_EXPIRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
};

module.exports = {
  DomainExpirationValidationError,
  buildDomainExpirationEmail,
  getDateInTimeZone,
  getDomainExpirationEvent,
  normalizeNotification,
  processDomainExpirationNotifications,
  syncDomainExpirationNotifications
};
