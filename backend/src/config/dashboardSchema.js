const DASHBOARD_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS user_dashboard_layouts (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    layout JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`
];
const ensureDashboardSchema = async (client) => { for (const statement of DASHBOARD_STATEMENTS) await client.query(statement); };
module.exports = { DASHBOARD_STATEMENTS, ensureDashboardSchema };
