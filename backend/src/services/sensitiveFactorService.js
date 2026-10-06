const { authenticator } = require('otplib');
const { decryptSecret } = require('./mfaService');
// Caller holds a reserved transaction. Every sensitive operation shares this step lock.
const consumeTotp = async (client, userId, code, {allowSetup=false}={}) => {
  const settings = (await client.query('SELECT * FROM user_mfa_settings WHERE user_id=$1 FOR UPDATE',[userId])).rows[0];
  if (!settings || (!settings.enabled && !allowSetup)) throw Object.assign(new Error('MFA não habilitado.'),{statusCode:403,code:'MFA_REQUIRED'});
  const delta = /^\d{6}$/.test(String(code || '')) ? authenticator.checkDelta(String(code), decryptSecret(settings.totp_secret_encrypted)) : null;
  const step = Number.isInteger(delta) ? Math.floor(Date.now()/30000)+delta : null;
  if (step === null || (settings.last_totp_step !== null && step <= Number(settings.last_totp_step))) {
    throw Object.assign(new Error('Use um código MFA novo para confirmar esta ação.'),{statusCode:403,code:'FRESH_MFA_REQUIRED'});
  }
  await client.query('UPDATE user_mfa_settings SET last_totp_step=$2,last_used_at=CURRENT_TIMESTAMP WHERE user_id=$1',[userId,step]);
};
module.exports = { consumeTotp };
