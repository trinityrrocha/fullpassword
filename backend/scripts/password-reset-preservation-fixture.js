// Called by the existing disposable PostgreSQL + HTTP integration, synthetic data only.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const argon2 = require('argon2');

module.exports = async ({ database, ownerApi, ownerUser, secret, legacyVault, VaultSession, unlockUserIdentity, password }) => {
  const owner = ownerUser.id;
  const snapshot = async () => {
    const user = (await database.query('SELECT crypto_identity,wrapped_key,crypto_salt,public_key,encrypted_private_key FROM users WHERE id=$1', [owner])).rows[0];
    const tables = ['vault_crypto_epochs', 'vault_crypto_envelopes', 'vault_records', 'vault_record_history',
      'vault_item_crypto', 'vault_item_crypto_envelopes', 'vault_items', 'vault_shares', 'client_key_shares'];
    const rows = {};
    for (const table of tables) {
      rows[table] = (await database.query(`SELECT row_to_json(t) AS data FROM ${table} t`)).rows
        .map(row => JSON.stringify(row.data)).sort();
    }
    return { user, rows };
  };
  const before = await snapshot();
  const authBefore = (await database.query('SELECT hash_senha_login,token_version FROM users WHERE id=$1', [owner])).rows[0];
  const activeSessions = Number((await database.query('SELECT count(*) AS n FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL', [owner])).rows[0].n);
  assert(activeSessions > 0);
  const historicId = (await database.query("INSERT INTO system_audit_events(user_id,user_email,action,status,metadata) VALUES($1,'owner@example.invalid','password_reset_crypto_identity_rotated','success',$2) RETURNING id", [owner, { fixture: 'SYNTHETIC_HISTORIC_EVENT' }])).rows[0].id;
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = require('../src/services/passwordResetService').hashPasswordResetToken(token);
  await database.query("INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,CURRENT_TIMESTAMP+INTERVAL '30 minutes')", [owner, tokenHash]);
  const nextPassword = 'SYNTHETIC_NewLogin_!' + crypto.randomBytes(16).toString('hex');
  // Extra crypto fields must not replace the independent identity.
  await ownerApi.post('/auth/password-reset/complete', {
    token, new_password: nextPassword, confirmation: 'RESETAR ACESSO', crypto_identity: { version: 99 }
  });
  assert.deepEqual(await snapshot(), before, 'identity, all vault ciphertexts/envelopes/history/grants must remain byte-identical');
  const authAfter = (await database.query('SELECT hash_senha_login,token_version FROM users WHERE id=$1', [owner])).rows[0];
  assert.notEqual(authAfter.hash_senha_login, authBefore.hash_senha_login);
  assert(await argon2.verify(authAfter.hash_senha_login, nextPassword));
  assert(!(await argon2.verify(authAfter.hash_senha_login, password)));
  assert.equal(authAfter.token_version, authBefore.token_version + 1);
  const revoked = (await database.query("SELECT count(*)::int AS n FROM user_sessions WHERE user_id=$1 AND revoke_reason='password_reset' AND revoked_at IS NOT NULL", [owner])).rows[0].n;
  assert.equal(revoked, activeSessions);
  await assert.rejects(ownerApi.get('/auth/me'), error => error.response.status === 401);
  await assert.rejects(ownerApi.post('/auth/login', { email: 'owner@example.invalid', password }), error => error.response.status === 401);
  const logged = (await ownerApi.post('/auth/login', { email: 'owner@example.invalid', password: nextPassword })).data.user;
  assert.deepEqual(logged.crypto_identity, ownerUser.crypto_identity);
  const keys = await unlockUserIdentity(logged, secret);
  const vault = new VaultSession({ api: ownerApi, vaultId: legacyVault, user: logged, keys });
  await vault.load();
  assert.equal(vault.categories()[0].decrypted.servers[0].name, 'SYNTHETIC_LEGACY_RECORD');
  const event = (await database.query("SELECT metadata FROM system_audit_events WHERE user_id=$1 AND action='password_reset_crypto_identity_preserved'", [owner])).rows;
  assert.equal(event.length, 1);
  assert.equal(event[0].metadata.revoked_sessions, activeSessions);
  assert.equal(event[0].metadata.invalidated_vault_shares, 0);
  const audit = JSON.stringify((await database.query('SELECT action,metadata FROM system_audit_events WHERE user_id=$1', [owner])).rows);
  assert(!audit.includes(token) && !audit.includes(nextPassword) && !audit.includes(secret));
  assert.equal((await database.query('SELECT action,metadata FROM system_audit_events WHERE id=$1', [historicId])).rows[0].action, 'password_reset_crypto_identity_rotated');
  assert.equal((await database.query('SELECT used_at IS NOT NULL AS used FROM password_reset_tokens WHERE token_hash=$1', [tokenHash])).rows[0].used, true);
  await assert.rejects(ownerApi.post('/auth/password-reset/complete', { token, new_password: nextPassword, confirmation: 'RESETAR ACESSO' }), error => error.response.data.code === 'PASSWORD_RESET_TOKEN_INVALID');
  console.log('PASS reset HTTP + PostgreSQL: password/hash changes, old sessions revoked, independent identity and all envelopes/ciphertexts unchanged, unlock/vault decrypts, new audit emitted, historic event preserved, token replay denied.');
};
