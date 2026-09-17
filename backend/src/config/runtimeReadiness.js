const SCHEMA_VERSION = 'navigation-preferences-v1';
const isReadyResponse = (body, expectedCommit) => body?.status === 'ok'
  && body.schema_ready === true && body.schema_version === SCHEMA_VERSION
  && (!expectedCommit || body.commit === expectedCommit);
module.exports = { SCHEMA_VERSION, isReadyResponse };
