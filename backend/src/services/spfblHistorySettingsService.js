const db = require('../config/database');
const repository = require('./spfblHistoryRepository');

// How long the collected history is kept and when the daily collection runs (hour of day, America/Sao_Paulo).
// Shortening the retention deletes data, so it needs an explicit confirmation that says how much will go.
const RETENTION_OPTIONS = Object.freeze([30, 60, 90]);
const TIMEZONE = 'America/Sao_Paulo';

class HistorySettingsError extends Error {
  constructor(message, code, statusCode = 422, extra = {}) { super(message); this.name = 'HistorySettingsError'; this.code = code; this.statusCode = statusCode; Object.assign(this, extra); }
}

const read = async (queryable = db) => (await queryable.query('SELECT history_retention_days, history_schedule_hour, history_last_run_date FROM spfbl_settings WHERE id = 1')).rows[0]
  || { history_retention_days: 30, history_schedule_hour: 3, history_last_run_date: null };

const get = async (integration, queryable = db) => {
  const row = await read(queryable);
  const stats = integration ? await repository.stats(integration, queryable) : { rows: 0, oldest_at: null, newest_at: null };
  return { retention_days: Number(row.history_retention_days), schedule_hour: Number(row.history_schedule_hour), retention_options: RETENTION_OPTIONS,
    timezone: TIMEZONE, last_run_date: row.history_last_run_date ? String(row.history_last_run_date).slice(0, 10) : null, stored: stats };
};

const update = async (input, integration, queryable = db) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HistorySettingsError('Dados inválidos.', 'SPFBL_HISTORY_SETTINGS_INVALID');
  const current = await read(queryable);
  const retention = input.retention_days === undefined ? Number(current.history_retention_days) : input.retention_days;
  const hour = input.schedule_hour === undefined ? Number(current.history_schedule_hour) : input.schedule_hour;
  if (!RETENTION_OPTIONS.includes(retention)) throw new HistorySettingsError('Escolha 30, 60 ou 90 dias de retenção.', 'SPFBL_HISTORY_RETENTION_INVALID');
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new HistorySettingsError('Escolha uma hora entre 0 e 23.', 'SPFBL_HISTORY_HOUR_INVALID');
  if (input.confirm_shrink !== undefined && typeof input.confirm_shrink !== 'boolean') throw new HistorySettingsError('Dados inválidos.', 'SPFBL_HISTORY_SETTINGS_INVALID');
  let toDelete = 0;
  if (retention < Number(current.history_retention_days)) {
    toDelete = Number((await queryable.query("SELECT COUNT(*)::integer AS n FROM spfbl_history_records WHERE arrival_at < CURRENT_TIMESTAMP - ($1::integer * INTERVAL '1 day')", [retention])).rows[0].n);
    if (toDelete > 0 && input.confirm_shrink !== true) {
      throw new HistorySettingsError(`Reduzir a retenção apagará ${toDelete} registros do histórico armazenado. Confirme para continuar.`, 'SPFBL_HISTORY_SHRINK_CONFIRM', 409, { rows_to_delete: toDelete });
    }
  }
  await queryable.query('UPDATE spfbl_settings SET history_retention_days = $1, history_schedule_hour = $2, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [retention, hour]);
  const deleted = toDelete > 0 ? await repository.prune(retention, queryable) : 0;
  return { ...(await get(integration, queryable)), deleted };
};

module.exports = { HistorySettingsError, RETENTION_OPTIONS, TIMEZONE, get, update, read };
