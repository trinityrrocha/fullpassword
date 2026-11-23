const db = require('../config/database');
const { sendEmail } = require('./emailService');
const { safeLogError } = require('../utils/safeLogger');

// Best effort: a mail failure (or SMTP disabled) never blocks or undoes a decision. It returns what happened so the
// caller can audit it. Bodies carry no credentials, keys or provider data beyond the addresses the person already sees.
const clean = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 254);
const link = () => `${(process.env.APP_ORIGIN || '').replace(/\/$/, '')}/spfbl`;

const send = async (to, subject, lines) => {
  try {
    await sendEmail({ to, subject, text: `${lines.join('\n')}\n\nAcesse: ${link()}\n` });
    return 'sent';
  } catch (error) {
    safeLogError('Notificação do SPFBL não enviada.', { name: 'SpfblNotificationError', code: error?.code }, { includeStack: false });
    return 'skipped';
  }
};

const notifyAdmins = async (request) => {
  const admins = (await db.query('SELECT email FROM users WHERE is_super_admin = TRUE AND is_active = TRUE')).rows;
  const results = [];
  for (const admin of admins) {
    results.push(await send(admin.email, `SPFBL: solicitação de revisão — ${clean(request.domain)}`, [
      'Uma nova solicitação de revisão de bloqueio aguarda decisão.', '', `Domínio: ${clean(request.domain)}`, `Destinatário: ${clean(request.recipient)}`, `Remetente: ${clean(request.sender) || 'Não informado'}`
    ]));
  }
  return results.includes('sent') ? 'sent' : 'skipped';
};

const DECISIONS = { unlocked: 'liberado no SPFBL', kept: 'mantido (nenhuma liberação foi enviada)', reblocked: 'bloqueado novamente' };
const notifyDecision = async (request, action) => {
  if (!request.actor_id || !DECISIONS[action]) return 'skipped';
  const user = (await db.query('SELECT email FROM users WHERE id = $1 AND is_active = TRUE', [request.actor_id])).rows[0];
  if (!user) return 'skipped';
  return send(user.email, `SPFBL: decisão sobre sua solicitação — ${clean(request.domain)}`, [
    `Sua solicitação foi tratada: o bloqueio foi ${DECISIONS[action]}.`, '', `Domínio: ${clean(request.domain)}`, `Destinatário: ${clean(request.recipient)}`, `Remetente: ${clean(request.sender) || 'Não informado'}`
  ]);
};

module.exports = { notifyAdmins, notifyDecision };
