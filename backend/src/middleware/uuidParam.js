// Malformed IDs reach PostgreSQL's uuid cast and surface as 500; answer like a missing resource.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const requireUuidParam = (req, res, next, value) => (
  UUID.test(String(value)) ? next() : res.status(404).json({ error: 'Recurso não encontrado' })
);

module.exports = { UUID, requireUuidParam };
