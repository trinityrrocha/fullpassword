const crypto = require('node:crypto');
const db = require('../config/database');
const { sendEmail } = require('./emailService');
const { recordAuditEvent } = require('./auditService');
const { DomainError, today, daysBetween } = require('./domainManagerService');
const { safeLogError } = require('../utils/safeLogger');

// Expiry alerts of the Domain Manager. Same steps as the vault's expiry notice (30, 15, 5 days, the due day and 1 to 10 days after),
// but each step fires on the FIRST pass inside its range, so a missed day is not a missed alert.
// Every (domain, expiry date, step, recipient) is claimed in the database BEFORE sending and released if the send fails: two instances
// cannot both send, a failure is retried, and a renewal (new expiry date) starts a fresh sequence by itself.
const MAX_EMAILS = 20;
const MAX_AFTER_EXPIRY_DAYS = 10;
const RETRY_AFTER_MS = 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const eventFor = (daysLeft) => {
  if (!Number.isInteger(daysLeft) || daysLeft > 30 || daysLeft < -MAX_AFTER_EXPIRY_DAYS) return null;
  if (daysLeft > 15) return { key: 'before-30', expired: false };
  if (daysLeft > 5) return { key: 'before-15', expired: false };
  if (daysLeft > 0) return { key: 'before-5', expired: false };
  if (daysLeft === 0) return { key: 'due', expired: true };
  return { key: `expired-${-daysLeft}`, expired: true };
};

const normalizeEmails = (input) => {
  if (!Array.isArray(input) || input.length > MAX_EMAILS) throw new DomainError(`Informe até ${MAX_EMAILS} e-mails.`, 'DM_ALERT_EMAILS_INVALID', 422);
  const emails = [...new Set(input.map((email) => (typeof email === 'string' ? email.trim().toLowerCase() : '')))];
  if (emails.some((email) => !email || email.length > 254 || !EMAIL_PATTERN.test(email))) throw new DomainError('Há um e-mail inválido na lista.', 'DM_ALERT_EMAILS_INVALID', 422);
  return emails;
};

const hash = (email) => crypto.createHash('sha256').update(email).digest('hex').slice(0, 16);
const link = () => `${(process.env.APP_ORIGIN || '').replace(/\/$/, '')}/domains`;
const brDate = (iso) => iso.split('-').reverse().join('/');

const buildEmail = ({ domain, expiresOn, daysLeft, expired }) => {
  const when = daysLeft === 0 ? 'vence hoje' : daysLeft > 0 ? `vence em ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}` : `venceu há ${-daysLeft} ${daysLeft === -1 ? 'dia' : 'dias'}`;
  return {
    subject: expired ? `Domínio vencido: ${domain}` : `Domínio próximo do vencimento: ${domain}`,
    text: `O domínio "${domain}" ${when} (vencimento em ${brDate(expiresOn)}). Renove o domínio para manter os serviços ativos.\n\nAcesse: ${link()}\n`
  };
};

const createAlertService = ({ queryable = db, send = sendEmail, audit = recordAuditEvent, now = Date.now } = {}) => {
  const retryAt = new Map();

  const defaults = { enabled: false, notify_admins: false, emails: [] };
  const getAlerts = async (domainId) => {
    const domain = (await queryable.query('SELECT id FROM dm_domains WHERE id = $1', [domainId])).rows[0];
    if (!domain) throw new DomainError('Domínio não encontrado.', 'DM_NOT_FOUND', 404);
    const row = (await queryable.query('SELECT enabled, notify_admins, emails FROM dm_alert_settings WHERE domain_id = $1', [domainId])).rows[0];
    return row ? { enabled: row.enabled, notify_admins: row.notify_admins, emails: Array.isArray(row.emails) ? row.emails : [] } : { ...defaults };
  };

  const saveAlerts = async (domainId, input, userId) => {
    if (!input || typeof input !== 'object' || typeof input.enabled !== 'boolean' || typeof input.notify_admins !== 'boolean') {
      throw new DomainError('Dados de alerta inválidos.', 'DM_ALERT_INVALID', 422);
    }
    const emails = normalizeEmails(input.emails ?? []);
    if (input.enabled && emails.length === 0 && !input.notify_admins) {
      throw new DomainError('Informe ao menos um e-mail ou marque "Notificar os administradores".', 'DM_ALERT_NO_RECIPIENT', 422);
    }
    await getAlerts(domainId);
    await queryable.query(
      `INSERT INTO dm_alert_settings (domain_id, enabled, notify_admins, emails, updated_by) VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (domain_id) DO UPDATE SET enabled = EXCLUDED.enabled, notify_admins = EXCLUDED.notify_admins, emails = EXCLUDED.emails,
         updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [domainId, input.enabled, input.notify_admins, JSON.stringify(emails), userId || null]);
    return getAlerts(domainId);
  };

  const claim = async (domainId, expiresOn, eventKey, recipient) => (await queryable.query(
    `INSERT INTO dm_notifications_sent (domain_id, expires_on, event_key, recipient) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING recipient`,
    [domainId, expiresOn, eventKey, recipient])).rowCount === 1;
  const release = (domainId, expiresOn, eventKey, recipient) => queryable.query(
    'DELETE FROM dm_notifications_sent WHERE domain_id = $1 AND expires_on = $2 AND event_key = $3 AND recipient = $4', [domainId, expiresOn, eventKey, recipient]);

  // The vault's own expiry notice keeps working as before: an address it already covers for the same domain is not mailed twice.
  const coveredByVaultNotice = async (domain) => {
    let rows;
    try { rows = (await queryable.query('SELECT notify_emails FROM domain_expiration_notifications WHERE lower(domain) = $1', [domain])).rows; } catch { return new Set(); }
    return new Set(rows.flatMap((row) => (Array.isArray(row.notify_emails) ? row.notify_emails : [])).map((email) => String(email).toLowerCase()));
  };

  const processDue = async () => {
    const day = today(now());
    const rows = (await queryable.query(
      `SELECT d.id, d.name, s.expires_on::text AS expires_on, a.notify_admins, a.emails
         FROM dm_domains d JOIN dm_alert_settings a ON a.domain_id = d.id AND a.enabled
         JOIN dm_snapshots s ON s.domain_id = d.id
        WHERE d.active AND s.expires_on IS NOT NULL AND s.expires_on BETWEEN $1::date - ${MAX_AFTER_EXPIRY_DAYS} AND $1::date + 30`, [day])).rows;
    const result = { sent: 0, bells: 0, failed: 0 };
    let admins = null;
    for (const row of rows) {
      const daysLeft = daysBetween(day, row.expires_on);
      const event = eventFor(daysLeft);
      if (!event) continue;
      if (row.notify_admins && admins === null) admins = (await queryable.query('SELECT email FROM users WHERE is_super_admin = TRUE AND is_active = TRUE')).rows.map((admin) => admin.email.toLowerCase());
      const covered = await coveredByVaultNotice(row.name);
      const recipients = [...new Set([...(Array.isArray(row.emails) ? row.emails : []), ...(row.notify_admins ? admins : [])].map((email) => String(email).toLowerCase()))]
        .filter((email) => !covered.has(email));
      const mail = buildEmail({ domain: row.name, expiresOn: row.expires_on, daysLeft, expired: event.expired });
      for (const email of recipients) {
        const recipient = hash(email);
        const retryKey = `${row.id}:${row.expires_on}:${event.key}:${recipient}`;
        if ((retryAt.get(retryKey) || 0) > now()) continue;
        if (!(await claim(row.id, row.expires_on, event.key, recipient))) continue;
        try {
          await send({ to: email, ...mail });
          retryAt.delete(retryKey);
          result.sent += 1;
        } catch (error) {
          await release(row.id, row.expires_on, event.key, recipient);
          retryAt.set(retryKey, now() + RETRY_AFTER_MS);
          result.failed += 1;
          safeLogError('Falha segura ao enviar alerta de vencimento do Domain Manager.', { name: error?.name, code: error?.code }, { includeStack: false });
        }
      }
      // The bell (Super Admins) is part of "notify the administrators", whether or not the mail could be sent.
      if (row.notify_admins && await claim(row.id, row.expires_on, event.key, 'bell')) {
        await audit({ action: 'domain_manager_expiry_alert', status: 'success', metadata: { domain: row.name, days_left: daysLeft, event: event.key }, queryable });
        result.bells += 1;
      }
    }
    return result;
  };

  return { getAlerts, saveAlerts, processDue };
};

let shared = null;
const getAlertService = () => { shared = shared || createAlertService(); return shared; };

module.exports = { createAlertService, getAlertService, eventFor, normalizeEmails, buildEmail, MAX_EMAILS };
