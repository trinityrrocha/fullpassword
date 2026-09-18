const crypto = require('crypto');
const db = require('../config/database');
const { authenticator } = require('otplib');
const hashChallenge = (value) => crypto.createHash('sha256').update(value).digest('hex');
const invalid = () => Object.assign(new Error('Desafio MFA inválido ou expirado.'), { code: 'MFA_CHALLENGE_INVALID' });

const storeChallenge = async (id, user, purpose) => {
  await db.query('DELETE FROM mfa_login_challenges WHERE expires_at < CURRENT_TIMESTAMP');
  await db.query(`INSERT INTO mfa_login_challenges(challenge_hash,user_id,purpose,token_version,expires_at)
    VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP + INTERVAL '5 minutes')`,
  [hashChallenge(id),user.id,purpose,user.token_version]);
};

// All instances share PostgreSQL row locks; neither challenge nor TOTP step is reusable.
const consumeChallenge = async (payload, { code, recoveryCode } = {}) => {
  if (!payload?.jti || !/^[a-f0-9]{64}$/.test(payload.jti)) throw invalid();
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const challenge = (await client.query(`SELECT * FROM mfa_login_challenges
      WHERE challenge_hash=$1 AND user_id=$2 AND purpose=$3 AND token_version=$4
        AND expires_at > CURRENT_TIMESTAMP AND consumed_at IS NULL
      FOR UPDATE`,[hashChallenge(payload.jti),payload.sub,payload.purpose,payload.token_version])).rows[0];
    if (!challenge || challenge.attempts >= 5) throw invalid();
    const { decryptSecret, useRecoveryCode, replaceRecoveryCodes } = require('./mfaService');
    const settings = (await client.query(`SELECT m.* FROM user_mfa_settings m
      JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND u.is_active=TRUE
        AND u.token_version=$2 FOR UPDATE OF m`,[payload.sub,payload.token_version])).rows[0];
    if (!settings || (payload.purpose==='login' && !settings.enabled) || (payload.purpose==='setup' && settings.enabled)) throw invalid();
    const recent = Date.now()-new Date(settings.attempt_window_started_at).getTime() < 300000;
    if (recent && settings.failed_attempts >= 10) throw invalid();
    await client.query('UPDATE mfa_login_challenges SET attempts=attempts+1 WHERE challenge_hash=$1',[hashChallenge(payload.jti)]);
    const delta = /^\d{6}$/.test(String(code || ''))
      ? authenticator.checkDelta(String(code),decryptSecret(settings.totp_secret_encrypted)) : null;
    const step = Number.isInteger(delta) ? Math.floor(Date.now()/30000)+delta : null;
    const validTotp = step !== null && (settings.last_totp_step===null || step>Number(settings.last_totp_step));
    const recoveryCodeUsed = !validTotp && payload.purpose==='login' && recoveryCode
      ? await useRecoveryCode(payload.sub,recoveryCode,client) : false;
    if (!validTotp && !recoveryCodeUsed) {
      await client.query(`UPDATE user_mfa_settings SET
        failed_attempts=CASE WHEN attempt_window_started_at > CURRENT_TIMESTAMP-INTERVAL '5 minutes' THEN failed_attempts+1 ELSE 1 END,
        attempt_window_started_at=CASE WHEN attempt_window_started_at > CURRENT_TIMESTAMP-INTERVAL '5 minutes' THEN attempt_window_started_at ELSE CURRENT_TIMESTAMP END
        WHERE user_id=$1`,[payload.sub]);
      await client.query('COMMIT'); // Persist failed attempts even when authentication is rejected.
      throw invalid();
    }
    await client.query(`UPDATE user_mfa_settings SET last_totp_step=COALESCE($2,last_totp_step),
      enabled=enabled OR $3='setup',
      confirmed_at=CASE WHEN $3='setup' THEN CURRENT_TIMESTAMP ELSE confirmed_at END,
      last_used_at=CURRENT_TIMESTAMP,failed_attempts=0 WHERE user_id=$1`,[payload.sub,validTotp?step:null,payload.purpose]);
    await client.query('UPDATE mfa_login_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE challenge_hash=$1',[hashChallenge(payload.jti)]);
    const recoveryCodes = payload.purpose === 'setup' ? await replaceRecoveryCodes(client, payload.sub) : undefined;
    await client.query('COMMIT');
    return { recoveryCodeUsed: Boolean(recoveryCodeUsed), recoveryCodes };
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally { client.release(); }
};
module.exports = { storeChallenge, consumeChallenge };
