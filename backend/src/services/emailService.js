const nodemailer = require('nodemailer');
const { getSmtpDeliverySettings, isValidEmail, SmtpSettingsError } = require('./smtpSettingsService');
const { safeLogError } = require('../utils/safeLogger');

class EmailDeliveryError extends Error {
  constructor(message = 'Não foi possível enviar o e-mail pela configuração SMTP.') {
    super(message);
    this.name = 'EmailDeliveryError';
    this.code = 'SMTP_DELIVERY_FAILED';
    this.statusCode = 502;
  }
}

const createTransportOptions = (settings) => {
  const directTls = settings.security === 'ssl_tls';
  const startTls = settings.security === 'starttls';
  const timeoutMs = settings.timeout_seconds * 1000;
  const options = {
    host: settings.host,
    port: settings.port,
    secure: directTls,
    requireTLS: startTls,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs
  };

  if (directTls || startTls) {
    options.tls = {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2'
    };
  }
  if (settings.username || settings.password) {
    options.auth = {
      user: settings.username,
      pass: settings.password
    };
  }
  return options;
};

const sendEmail = async ({ to, subject, text, html }, { allowDisabled = false } = {}) => {
  if (!isValidEmail(to)) throw new SmtpSettingsError('O destinatário do e-mail é inválido.');
  const settings = await getSmtpDeliverySettings({ allowDisabled });
  const transporter = nodemailer.createTransport(createTransportOptions(settings));

  try {
    await transporter.sendMail({
      from: {
        name: settings.from_name || 'FullPassword',
        address: settings.from_email
      },
      to,
      replyTo: settings.reply_to || undefined,
      subject,
      text,
      html
    });
  } catch (error) {
    safeLogError('Falha ao entregar e-mail pelo transporte SMTP.', {
      name: 'SmtpTransportError',
      code: error?.code
    }, { includeStack: false });
    throw new EmailDeliveryError();
  } finally {
    transporter.close?.();
    settings.password = '';
  }
};

const sendTestEmail = ({ to }) => sendEmail({
  to,
  subject: 'Teste de e-mail do FullPassword',
  text: 'Este é um e-mail de teste enviado pelo FullPassword para validar a configuração SMTP.',
  html: '<p>Este é um e-mail de teste enviado pelo <strong>FullPassword</strong> para validar a configuração SMTP.</p>'
}, { allowDisabled: true });

module.exports = {
  EmailDeliveryError,
  createTransportOptions,
  sendEmail,
  sendTestEmail
};
