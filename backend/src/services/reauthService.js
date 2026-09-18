const crypto=require('crypto');
const argon2=require('argon2');
const db=require('../config/database');
const {JWT_SECRET}=require('../config/security');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).filter(k=>!['_reauth_token','current_password','mfa_code'].includes(k)).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const actionHash=action=>crypto.createHmac('sha256',JWT_SECRET).update(canonical(action ?? {})).digest('hex');
const denied=purpose=>Object.assign(new Error('Confirme sua identidade para esta alteração.'),{statusCode:403,code:'REAUTH_REQUIRED',purpose});
const SCHEMA_SQL=`
 CREATE TABLE IF NOT EXISTS sensitive_auth_grants(
 token_hash TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id UUID NOT NULL,token_version INTEGER NOT NULL,purpose TEXT NOT NULL,
 action_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ);
 CREATE TABLE IF NOT EXISTS email_change_requests(
 token_hash TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 old_email TEXT NOT NULL,new_email TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ);
 CREATE TABLE IF NOT EXISTS sensitive_auth_attempts(
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 window_started_at TIMESTAMPTZ NOT NULL,attempts INTEGER NOT NULL);
`;
const ensureSchema=client=>client.query(SCHEMA_SQL);
// Count attempts in an independently committed statement: failed password checks
// must not roll back the budget, and every application instance shares it.
const attemptLimit=async(req,res,next)=>{
 try {
  const result=await db.query(`INSERT INTO sensitive_auth_attempts(user_id,window_started_at,attempts)
   VALUES($1,CURRENT_TIMESTAMP,1) ON CONFLICT(user_id) DO UPDATE SET
   attempts=CASE WHEN sensitive_auth_attempts.window_started_at<CURRENT_TIMESTAMP-INTERVAL '10 minutes' THEN 1 ELSE sensitive_auth_attempts.attempts+1 END,
   window_started_at=CASE WHEN sensitive_auth_attempts.window_started_at<CURRENT_TIMESTAMP-INTERVAL '10 minutes' THEN CURRENT_TIMESTAMP ELSE sensitive_auth_attempts.window_started_at END
   RETURNING attempts`,[req.user.id]);
  if(result.rows[0].attempts>8) return res.status(429).json({code:'REAUTH_ATTEMPT_LIMIT',error:'Aguarde dez minutos antes de tentar confirmar sua identidade novamente.'});
  next();
 } catch {res.status(503).json({code:'REAUTH_UNAVAILABLE',error:'Não foi possível confirmar sua identidade.'});}
};
const issue=async(req,res)=>{
 const client=await db.pool.connect();
 try {
  await client.query('BEGIN');
  const purpose=req.body.purpose;
  if(!/^profile_change$|^admin_(?:user_change|mfa_policy|mfa_reset|user_delete):[0-9a-f-]{36}$/.test(purpose || '')) throw denied(purpose);
  const user=(await client.query('SELECT hash_senha_login,token_version FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
  if(typeof req.body.current_password!=='string' || !(await argon2.verify(user.hash_senha_login,req.body.current_password))) throw denied(purpose);
  const settings=(await client.query('SELECT enabled FROM user_mfa_settings WHERE user_id=$1',[req.user.id])).rows[0];
  if(settings?.enabled) await require('./sensitiveFactorService').consumeTotp(client,req.user.id,req.body.mfa_code);
  const token=crypto.randomBytes(32).toString('hex');
  await client.query('DELETE FROM sensitive_auth_grants WHERE expires_at<CURRENT_TIMESTAMP');
  await client.query("INSERT INTO sensitive_auth_grants(token_hash,user_id,session_id,token_version,purpose,action_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP+INTERVAL '5 minutes')",[hash(token),req.user.id,req.user.session_id,user.token_version,purpose,actionHash(req.body.action)]);
  await client.query('COMMIT');
  res.json({token});
 } catch(error) {
  await client.query('ROLLBACK').catch(()=>{});
  res.status(error.statusCode || 500).json({code:error.code || 'REAUTH_FAILED',error:'Não foi possível confirmar sua identidade. Use sua senha de login e um código MFA novo, se habilitado.'});
 } finally {client.release();}
};
const consume=async(client,req,purpose)=>{
 const result=await client.query(`UPDATE sensitive_auth_grants SET used_at=CURRENT_TIMESTAMP WHERE
 token_hash=$1 AND user_id=$2 AND session_id=$3 AND token_version=$4 AND purpose=$5 AND action_hash=$6
 AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP RETURNING token_hash`,
 [hash(req.body._reauth_token || ''),req.user.id,req.user.session_id,req.user.token_version,purpose,actionHash(req.body)]);
 if(!result.rowCount) throw denied(purpose);
};
const requestEmailChange=async(client,userId,oldEmail,newEmail)=>{
 const {isValidEmail}=require('./smtpSettingsService');
 if(!isValidEmail(newEmail)) throw Object.assign(new Error('E-mail inválido.'),{statusCode:400,code:'INVALID_EMAIL'});
 if((await client.query('SELECT id FROM users WHERE LOWER(email)=$1',[newEmail])).rowCount) throw Object.assign(new Error('E-mail já cadastrado.'),{statusCode:409,code:'EMAIL_IN_USE'});
 const token=crypto.randomBytes(32).toString('hex');
 await client.query('DELETE FROM email_change_requests WHERE user_id=$1',[userId]);
 await client.query("INSERT INTO email_change_requests(token_hash,user_id,old_email,new_email,expires_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP+INTERVAL '30 minutes')",[hash(token),userId,oldEmail,newEmail]);
 const {sendEmail}=require('./emailService');
 await sendEmail({to:newEmail,subject:'FullPassword: confirme o novo e-mail',text:'Cole este código em Meu Perfil para confirmar o novo e-mail (válido por 30 minutos): '+token},{queryable:client});
 await sendEmail({to:oldEmail,subject:'FullPassword: alteração de e-mail solicitada',text:'Foi solicitada uma alteração do endereço de e-mail da sua conta. Se não foi você, encerre suas sessões e contate o administrador. A alteração ainda depende de confirmação.'},{queryable:client});
};
const confirmEmail=async(req,res)=>{
 const client=await db.pool.connect();
 try {
  await client.query('BEGIN');
  const change=(await client.query('SELECT * FROM email_change_requests WHERE token_hash=$1 AND user_id=$2 AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP FOR UPDATE',[hash(req.body.token || ''),req.user.id])).rows[0];
  if(!change) throw Object.assign(new Error('Código inválido ou expirado.'),{statusCode:403});
  const result=await client.query('UPDATE users SET email=$1,token_version=token_version+1 WHERE id=$2 AND email=$3 RETURNING id',[change.new_email,req.user.id,change.old_email]);
  if(!result.rowCount) throw Object.assign(new Error('Conta alterada; solicite nova confirmação.'),{statusCode:409});
  await client.query("UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP,revoke_reason='email_changed' WHERE user_id=$1 AND revoked_at IS NULL",[req.user.id]);
  await client.query('DELETE FROM password_reset_tokens WHERE user_id=$1',[req.user.id]);
  await client.query('DELETE FROM sensitive_auth_grants WHERE user_id=$1',[req.user.id]);
  await client.query('UPDATE email_change_requests SET used_at=CURRENT_TIMESTAMP WHERE token_hash=$1',[change.token_hash]);
  await client.query('COMMIT');
  res.json({confirmed:true,session_invalidated:true});
 } catch(error) {await client.query('ROLLBACK').catch(()=>{});res.status(error.statusCode || 500).json({error:'Não foi possível confirmar o novo e-mail.'});}
 finally{client.release();}
};
const guard=kind=>async(req,res,next)=>{
 const client=await db.pool.connect();
 try {
  await client.query('BEGIN');await consume(client,req,kind+':'+req.params.id);await client.query('COMMIT');next();
 } catch(error) {
  await client.query('ROLLBACK').catch(()=>{});
  res.status(error.statusCode || 500).json({error:error.message,code:error.code,purpose:error.purpose});
 } finally {client.release();}
};
module.exports={guard,attemptLimit,SCHEMA_SQL,ensureSchema,issue,consume,requestEmailChange,confirmEmail};
