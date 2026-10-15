const crypto = require('node:crypto');
const db = require('../config/database');
const reauth = require('../services/reauthService');
const { recordAuditEvent } = require('../services/auditService');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const identityHash = identity => crypto.createHash('sha256').update(JSON.stringify(canonical(identity))).digest('hex');
const reject = (code, statusCode = 400) => { throw Object.assign(new Error(code), {code, statusCode}); };
const validBase64 = (value, length) => typeof value === 'string' && Buffer.from(value, 'base64').length === length && Buffer.from(value, 'base64').toString('base64') === value;
const updateUnlockSecret = async (req, res) => {
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) reject('INVALID_UNLOCK_ENVELOPE');
    const keys = Object.keys(req.body).filter(key => key !== '_reauth_token').sort().join(',');
    if (keys !== 'expectedIdentityHash,kdf,salt,wrappedMasterKey') reject('INVALID_UNLOCK_ENVELOPE');
    const {kdf, salt, wrappedMasterKey: wrapped, expectedIdentityHash} = req.body;
    if (!/^[a-f0-9]{64}$/.test(expectedIdentityHash || '') || !kdf || Object.keys(kdf).sort().join(',') !== 'hash,iterations,name'
      || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || kdf.iterations !== 600000 || !validBase64(salt, 32)
      || !wrapped || Object.keys(wrapped).sort().join(',') !== 'ciphertext,iv,version' || wrapped.version !== 2
      || !validBase64(wrapped.iv, 12) || !validBase64(wrapped.ciphertext, 48)) reject('INVALID_UNLOCK_ENVELOPE');
    const row = (await client.query('SELECT crypto_identity FROM users WHERE id=$1 FOR UPDATE', [req.user.id])).rows[0];
    const identity = row?.crypto_identity;
    if (identity?.version !== 2 || identity.userId !== req.user.id) reject('IDENTITY_MIGRATION_REQUIRED', 409);
    if (identityHash(identity) !== expectedIdentityHash) reject('CRYPTO_IDENTITY_CHANGED', 409);
    if (identity.salt === salt || JSON.stringify(canonical(identity.wrappedMasterKey)) === JSON.stringify(canonical(wrapped))) reject('UNCHANGED_UNLOCK_ENVELOPE');
    await reauth.consume(client, req, 'crypto_unlock_secret_change');
    // Preserve every other JSONB field on the server, including unknown future fields.
    const result = await client.query(`UPDATE users SET crypto_identity = jsonb_set(jsonb_set(jsonb_set(
      crypto_identity,'{kdf}',$1::jsonb),'{salt}',$2::jsonb),'{wrappedMasterKey}',$3::jsonb), updated_at=CURRENT_TIMESTAMP
      WHERE id=$4 AND crypto_identity=$5::jsonb RETURNING crypto_identity`,
    [JSON.stringify(kdf), JSON.stringify(salt), JSON.stringify(wrapped), req.user.id, JSON.stringify(identity)]);
    if (!result.rowCount) reject('CRYPTO_IDENTITY_CHANGED', 409);
    await recordAuditEvent({queryable:client,throwOnError:true,user:req.user,req,action:'crypto_unlock_secret_changed',status:'success',metadata:{version:2}});
    await client.query('COMMIT');
    res.json({identity:result.rows[0].crypto_identity});
  } catch (error) {
    if(client) await client.query('ROLLBACK').catch(() => {});
    const code = error.statusCode ? error.code : 'UNLOCK_SECRET_CHANGE_FAILED';
    res.status(error.statusCode || 500).json({code,error:code === 'CRYPTO_IDENTITY_CHANGED'
      ? 'A identidade foi alterada em outra aba. Feche e abra este formulário novamente.'
      : 'Não foi possível alterar a senha dos cofres. Confira sua identidade e tente novamente.',
    ...(error.purpose ? {purpose:error.purpose} : {})});
  } finally { client?.release(); }
};
module.exports = {updateUnlockSecret, identityHash};
