// Run as the separately provisioned schema owner, before starting the runtime role.
const db=require('../src/config/database');
require('../src/config/securitySchema').ensureSecuritySchema()
  .then(()=>console.log('Security schema migration complete.'))
  .catch(error=>{console.error('Schema migration failed.',{code:error.code || 'MIGRATION_FAILED'});process.exitCode=1;})
  .finally(()=>db.pool.end());
