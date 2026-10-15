const db = require('../config/database');
const { isSuperAdmin } = require('../config/security');
const { getPasswordPolicy, publicPolicy, MIN_LENGTH_OPTIONS, ROTATION_OPTIONS } = require('../services/passwordPolicyService');
const { recordAuditEvent } = require('../services/auditService');
const fields = ['login_min_length','login_rotation_months','vault_min_length','vault_rotation_months'];
const getPolicy = async (req,res) => {
  if (!isSuperAdmin(req.user)) return res.status(403).json({error:'Apenas o Super Admin pode consultar a configuração de senha'});
  res.json(await getPasswordPolicy());
};
// Public requirements support bootstrap/reset; no actor IDs or audit metadata.
const getPublicPolicy = async (_req,res) => res.json(publicPolicy(await getPasswordPolicy()));
const updatePolicy = async (req,res) => {
  if (!isSuperAdmin(req.user)) return res.status(403).json({error:'Apenas o Super Admin pode alterar a política de senha'});
  if (!req.body || Array.isArray(req.body) || Object.keys(req.body).sort().join(',') !== [...fields].sort().join(',')
    || fields.some(key => !(key.endsWith('min_length') ? MIN_LENGTH_OPTIONS : ROTATION_OPTIONS).includes(req.body[key]))) {
    return res.status(400).json({error:'Selecione tamanhos de 8, 12, 16 ou 20 caracteres e períodos de 6, 12 ou 18 meses.'});
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result=await client.query(`UPDATE password_policy_settings SET min_length=GREATEST(12,$1),password_change_notice_months=$2,login_min_length=$1,login_rotation_months=$2,
      vault_min_length=$3,vault_rotation_months=$4,updated_by=$5,updated_at=CURRENT_TIMESTAMP WHERE id=1 RETURNING *`,[...fields.map(key=>req.body[key]),req.user.id]);
    await recordAuditEvent({queryable:client,throwOnError:true,user:req.user,req,action:'password_policy_updated',status:'success',metadata:Object.fromEntries(fields.map(key=>[key,req.body[key]]))});
    await client.query('COMMIT');res.json(result.rows[0]);
  } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;} finally {client.release();}
};
module.exports={getPolicy,getPublicPolicy,updatePolicy};
