const db = require('../config/database');
const repository = require('./spfblHistoryRepository');
const sentStore = require('./spfblSentStore');

// How long the collected history is kept and when the daily collection runs (hour of day, America/Sao_Paulo).
// Shortening the retention deletes data, so it needs an explicit confirmation that says how much will go.
const RETENTION_OPTIONS = Object.freeze([30, 60, 90]);
// In minutes. The older column in hours is kept in step (anything under 2 hours counts as 1 hour there, 3 hours as 4) so the one-time conversion in the schema never runs again.
const INTERVAL_OPTIONS = Object.freeze([5, 10, 15, 30, 60, 120, 180]);
const TIMEZONE = 'America/Sao_Paulo';

class HistorySettingsError extends Error {
  constructor(message, code, statusCode = 422, extra = {}) { super(message); this.name = 'HistorySettingsError'; this.code = code; this.statusCode = statusCode; Object.assign(this, extra); }
}

const read = async (queryable = db) => (await queryable.query('SELECT history_retention_days, history_interval_minutes FROM spfbl_settings WHERE id = 1')).rows[0]
  || { history_retention_days: 30, history_interval_minutes: 60 };

const get = async (queryable = db) => {
  const row = await read(queryable);
  const stats = await repository.stats(null, queryable);
  return { retention_days: Number(row.history_retention_days), interval_minutes: Number(row.history_interval_minutes), retention_options: RETENTION_OPTIONS, interval_options: INTERVAL_OPTIONS,
    timezone: TIMEZONE, servers: (await queryable.query("SELECT id, name, matrix_user <> '' AS matrix, history_last_run_at, sent_last_run_at FROM spfbl_whm_servers ORDER BY lower(name)")).rows
      .map((r) => ({ id: r.id, name: r.name, matrix: r.matrix, last_run_at: r.history_last_run_at ? new Date(r.history_last_run_at).toISOString() : null, sent_last_run_at: r.sent_last_run_at ? new Date(r.sent_last_run_at).toISOString() : null })), stored: stats };
};

const update = async (input, queryable = db) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HistorySettingsError('Dados inválidos.', 'SPFBL_HISTORY_SETTINGS_INVALID');
  const current = await read(queryable);
  const retention = input.retention_days === undefined ? Number(current.history_retention_days) : input.retention_days;
  const interval = input.interval_minutes === undefined ? Number(current.history_interval_minutes) : input.interval_minutes;
  if (!RETENTION_OPTIONS.includes(retention)) throw new HistorySettingsError('Escolha 30, 60 ou 90 dias de retenção.', 'SPFBL_HISTORY_RETENTION_INVALID');
  if (!INTERVAL_OPTIONS.includes(interval)) throw new HistorySettingsError('Escolha coletar a cada 5, 10, 15 ou 30 minutos, ou a cada 1, 2 ou 3 horas.', 'SPFBL_HISTORY_INTERVAL_INVALID');
  if (input.confirm_shrink !== undefined && typeof input.confirm_shrink !== 'boolean') throw new HistorySettingsError('Dados inválidos.', 'SPFBL_HISTORY_SETTINGS_INVALID');
  let toDelete = 0;
  if (retention < Number(current.history_retention_days)) {
    toDelete = Number((await queryable.query("SELECT COUNT(*)::integer AS n FROM spfbl_history_records WHERE arrival_at < CURRENT_TIMESTAMP - ($1::integer * INTERVAL '1 day')", [retention])).rows[0].n);
    if (toDelete > 0 && input.confirm_shrink !== true) {
      throw new HistorySettingsError(`Reduzir a retenção apagará ${toDelete} registros do histórico armazenado. Confirme para continuar.`, 'SPFBL_HISTORY_SHRINK_CONFIRM', 409, { rows_to_delete: toDelete });
    }
  }
  await queryable.query('UPDATE spfbl_settings SET history_retention_days = $1, history_interval_minutes = $2, history_interval_hours = $3, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [retention, interval, interval <= 60 ? 1 : interval <= 120 ? 2 : 4]);
  const deleted = toDelete > 0 ? await repository.prune(retention, queryable) : 0;
  if (retention < Number(current.history_retention_days)) await sentStore.prune(retention, queryable);
  return { ...(await get(queryable)), deleted };
};

module.exports = { HistorySettingsError, RETENTION_OPTIONS, INTERVAL_OPTIONS, TIMEZONE, get, update, read };
