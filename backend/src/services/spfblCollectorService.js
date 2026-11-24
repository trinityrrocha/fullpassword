const crypto = require('node:crypto');
const db = require('../config/database');
const repository = require('./spfblHistoryRepository');
const { normalizeRecord, emailDomain } = require('./spfblHistoryService');

// Crawls the Matrix history (newest first, like the original portal) and stores the rows of the REGISTERED domains.
// - One crawl at a time (the scheduler, "Coletar agora" and a period query share it); requests never wait for it.
// - Every run records how far it got (oldest/newest row, reached the end, capped, skipped rows): "complete" is only claimed
//   when the run reached the start of the wanted window (or the end of the provider history) without being capped.
// - The Matrix shows at most 1024 records per SERVER (all domains together). A crawl that ends with about that many rows, without
//   reaching the wanted window, hit the provider limit: records older than the oldest row are not recoverable. When that crawl does
//   not overlap the previous one (its oldest row is newer than the previous newest) records were LOST in between: `gap`.
// - A crash leaves a "running" row; it is marked failed (INTERRUPTED) instead of blocking the next run.
const DEFAULT_CAPS = Object.freeze({ maxPages: 300, maxRows: 100000, delayMs: 750, extraPagesAfterWindow: 2, staleRunMs: 30 * 60 * 1000, freshMs: 15 * 60 * 1000, providerLimit: 1024 });

const integrationOf = (credentials) => crypto.createHash('sha256').update(credentials.user).digest('hex');
const sleepFor = (ms) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); });

const createCollector = ({ fetchPage, credentials, catalogue, now = Date.now, sleep = sleepFor, caps = {}, queryable = db } = {}) => {
  const limits = { ...DEFAULT_CAPS, ...caps };
  let active = null; // { runId, done }


  const lastFinished = async (integration) => (await queryable.query(
    `SELECT trigger, status, started_at, finished_at, pages, rows_seen, rows_stored, newest_at, oldest_at, reached_end, skipped_rows, error_code, provider_limit, gap
     FROM spfbl_history_runs WHERE integration_hash = $1 AND status <> 'running' ORDER BY finished_at DESC NULLS LAST LIMIT 1`, [integration])).rows[0] || null;

  const markInterrupted = async () => queryable.query(
    "UPDATE spfbl_history_runs SET status = 'failed', error_code = 'INTERRUPTED', finished_at = CURRENT_TIMESTAMP WHERE status = 'running' AND started_at < to_timestamp($1)",
    [(now() - limits.staleRunMs) / 1000]);

  const run = async (runId, integration, creds, windowStartTs, retentionDays) => {
    const known = new Set(await catalogue());
    const previous = await lastFinished(integration);
    const previousNewest = previous?.newest_at ? new Date(previous.newest_at).getTime() / 1000 : null;
    const signatures = new Set();
    const cursors = new Set();
    const progress = { pages: 0, seen: 0, stored: 0, newest: null, oldest: null, reachedEnd: false, capped: false, skipped: false, extra: 0, error: null };
    let cursor = null;
    try {
      for (;;) {
        const page = await fetchPage(cursor, creds);
        progress.pages += 1;
        if (signatures.has(page.signature)) { progress.capped = true; break; } // the provider repeated a page: stop, coverage stays partial
        signatures.add(page.signature);
        const rows = [];
        for (const raw of page.messages) {
          const row = normalizeRecord(raw, integration);
          if (!row) { progress.skipped = true; continue; }
          progress.seen += 1;
          progress.newest = progress.newest === null ? row.timestamp : Math.max(progress.newest, row.timestamp);
          progress.oldest = progress.oldest === null ? row.timestamp : Math.min(progress.oldest, row.timestamp);
          if (known.has(emailDomain(row.recipient))) rows.push(row);
        }
        progress.stored += await repository.upsertRows(rows, integration, queryable);
        await queryable.query(`UPDATE spfbl_history_runs SET pages = $2, rows_seen = $3, rows_stored = $4, newest_at = to_timestamp($5), oldest_at = to_timestamp($6), skipped_rows = $7 WHERE id = $1`,
          [runId, progress.pages, progress.seen, progress.stored, progress.newest, progress.oldest, progress.skipped]);
        if (page.next === null) { progress.reachedEnd = true; break; }
        if (progress.oldest !== null && progress.oldest <= windowStartTs) { progress.extra += 1; if (progress.extra > limits.extraPagesAfterWindow) break; }
        if (progress.pages >= limits.maxPages || progress.seen >= limits.maxRows || cursors.has(page.next)) { progress.capped = true; break; }
        cursors.add(page.next); cursor = page.next;
        await sleep(limits.delayMs);
      }
    } catch (error) {
      progress.error = String(error?.code || error?.name || 'COLLECT_FAILED').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60);
    }
    const status = progress.error ? 'failed' : progress.capped ? 'capped' : 'done';
    const providerLimit = !progress.error && progress.reachedEnd && progress.seen >= limits.providerLimit * 0.95 && (progress.oldest === null || progress.oldest > windowStartTs);
    const gap = providerLimit && previousNewest !== null && progress.oldest !== null && progress.oldest > previousNewest;
    progress.providerLimit = providerLimit; progress.gap = gap;
    await queryable.query(`UPDATE spfbl_history_runs SET status = $2, finished_at = CURRENT_TIMESTAMP, reached_end = $3, error_code = $4, provider_limit = $5, gap = $6 WHERE id = $1`, [runId, status, progress.reachedEnd, progress.error, providerLimit, gap]);
    if (status !== 'failed' && retentionDays) await repository.prune(retentionDays, queryable).catch(() => {});
    return { runId, status, ...progress };
  };

  // Starts a crawl unless one is running. Returns immediately with {started, runId, done}; `done` resolves with the summary.
  let starting = null; // closes the gap between "decided to start" and "active is set": concurrent callers share one crawl
  const start = async (input) => {
    if (active) return { started: false, runId: active.runId, done: active.done };
    if (starting) return { ...(await starting), started: false };
    starting = begin(input).finally(() => { starting = null; });
    return starting;
  };
  const begin = async ({ trigger, windowStartTs, retentionDays = null }) => {
    const creds = await credentials();
    const integration = integrationOf(creds);
    await markInterrupted();
    const runId = (await queryable.query(`INSERT INTO spfbl_history_runs (integration_hash, trigger, window_start_at) VALUES ($1, $2, to_timestamp($3)) RETURNING id`, [integration, trigger, windowStartTs])).rows[0].id;
    const done = run(runId, integration, creds, windowStartTs, retentionDays).finally(() => { active = null; });
    active = { runId, done };
    return { started: true, runId, done };
  };

  // What the screens show about coverage, relative to the wanted window start.
  const state = async (integration, windowStartTs) => {
    const last = await lastFinished(integration);
    const edges = (await queryable.query(`SELECT MIN(started_at) FILTER (WHERE status IN ('done', 'capped')) AS since, MAX(oldest_at) FILTER (WHERE gap) AS gap_before
      FROM spfbl_history_runs WHERE integration_hash = $1`, [integration])).rows[0];
    const sinceTs = edges.since ? new Date(edges.since).getTime() / 1000 : null;
    // Records lost in a gap are OLDER than the oldest row of the crawl that detected it: everything newer than that is continuous.
    const gapTs = edges.gap_before ? new Date(edges.gap_before).getTime() / 1000 : null;
    const reachedBack = Boolean(last && ((last.reached_end && !last.provider_limit) || (last.oldest_at && new Date(last.oldest_at).getTime() / 1000 <= windowStartTs)));
    // Collected continuously since the first successful run: the window is covered when it starts after that and no gap happened inside it.
    const continuous = Boolean(sinceTs !== null && windowStartTs >= sinceTs && !(gapTs !== null && windowStartTs < gapTs));
    const usable = Boolean(last && last.status !== 'failed');
    return {
      loading: Boolean(active),
      complete: Boolean(usable && (reachedBack || continuous) && !last.skipped_rows && last.status === 'done'),
      since: sinceTs !== null ? new Date(sinceTs * 1000).toISOString() : null,
      gap_before: gapTs !== null ? new Date(gapTs * 1000).toISOString() : null,
      provider_limit: Boolean(last?.provider_limit),
      error: last?.status === 'failed' ? 'A última coleta do histórico falhou.' : '',
      updated_at: last?.finished_at ? new Date(last.finished_at).toISOString() : null,
      oldest_at: last?.oldest_at ? new Date(last.oldest_at).toISOString() : null,
      capped: last?.status === 'capped', skipped_rows: Boolean(last?.skipped_rows), last_run: last
    };
  };

  // Called by the screens: starts a background crawl when the stored history is stale or does not reach the wanted window.
  const ensure = async ({ windowStartTs, force = false }) => {
    const creds = await credentials();
    const integration = integrationOf(creds);
    if (!active) {
      const last = await lastFinished(integration);
      const age = last?.finished_at ? now() - new Date(last.finished_at).getTime() : Infinity;
      const short = last && last.status !== 'failed' && !last.reached_end && (!last.oldest_at || new Date(last.oldest_at).getTime() / 1000 > windowStartTs);
      if (force ? age > 60000 : (age > limits.freshMs || (short && age > 120000))) await start({ trigger: 'query', windowStartTs }).catch(() => {});
    }
    return { integration, state: await state(integration, windowStartTs) };
  };

  return { start, ensure, state, markInterrupted, isRunning: () => Boolean(active || starting), waitIdle: async () => { if (active) await active.done; } };
};

module.exports = { createCollector, integrationOf, DEFAULT_CAPS };
