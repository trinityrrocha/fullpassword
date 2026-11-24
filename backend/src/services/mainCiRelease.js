// Deployment authority: the exact protected main SHA and its successful push workflow,
// never a PR, dispatch, release tag, tenant URL or mutable image tag.
const crypto = require('node:crypto');
const repo = 'trinityrrocha/fullpassword';
const workflow = 361010180;
const sha = /^[a-f0-9]{40}$/;
const TTL = 15 * 60000;
async function discover(installed, fetcher = fetch, now = Date.now()) {
  const checkedAt = new Date(now).toISOString();
  const result = (state, release = null, hash = null) => ({ state, release, hash, checkedAt });
  if (!sha.test(installed || '')) return result('unidentified');
  async function api(path) {
    const response = await fetcher('https://api.github.com/repos/' + repo + '/' + path,
      { redirect: 'error', signal: AbortSignal.timeout(7000), headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw Error('GITHUB_UNAVAILABLE');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) throw Error('RESPONSE_TOO_LARGE');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  const head = (await api('git/ref/heads/main')).object;
  if (head?.type !== 'commit' || !sha.test(head.sha)) throw Error('INVALID_MAIN');
  const revision = head.sha;
  if (revision === installed) return result('current');
  const {workflow_runs: runs} = await api('actions/workflows/' + workflow + '/runs?branch=main&event=push&head_sha=' + revision + '&per_page=1');
  const r = runs?.[0];
  if (!r || r.status !== 'completed' || r.conclusion !== 'success') return result('unavailable');
  if (r.workflow_id !== workflow || r.path !== '.github/workflows/security-regression.yml' ||
    r.event !== 'push' || r.head_branch !== 'main' || r.head_sha !== revision ||
    r.repository?.full_name !== repo || r.head_repository?.full_name !== repo ||
    !Number.isSafeInteger(r.id) || !Number.isSafeInteger(r.run_attempt)) throw Error('INVALID_RUN');
  const {jobs} = await api('actions/runs/' + r.id + '/attempts/' + r.run_attempt + '/jobs?per_page=100');
  const job = name => {
    const found = jobs.filter(j => j.name === name);
    if (found.length !== 1 || found[0].head_sha !== revision || found[0].conclusion !== 'success') throw Error('INVALID_JOB');
    return found[0];
  };
  job('regression'); job('images');
  const build = job('release-candidate / candidate');
  const image = service => {
    const prefix = 'WebUpdate ' + service + ' ';
    const steps = build.steps.filter(s => s.name.startsWith(prefix));
    const ref = steps[0]?.name.slice(prefix.length);
    if (steps.length !== 1 || steps[0].conclusion !== 'success' ||
        !new RegExp('^ghcr\\.io/trinityrrocha/fullpassword-' + service + '@sha256:[a-f0-9]{64}$').test(ref)) throw Error('INVALID_IMAGE');
    return ref;
  };
  const backend = image('backend'), frontend = image('frontend');
  const diff = await api('compare/' + installed + '...' + revision + '?per_page=1');
  if (diff.status !== 'ahead' || diff.merge_base_commit?.sha !== installed) return result('unrecognized');
  const hash = crypto.createHash('sha256').update(JSON.stringify([repo, revision, backend, frontend])).digest('hex');
  return result('available', { revision, backend, frontend, publishedAt: build.completed_at,
    expiresAt: new Date(now + 2 * TTL).toISOString(), changes: [{ type: 'release', title: 'Atualização da main validada pela CI: ' + revision.slice(0, 8) }] }, hash);
}
function cachedDiscovery() {
  let cached, pending, lastSha, until = 0;
  return async installed => {
    if (lastSha === installed && Date.now() < until) return cached;
    if (pending) { await pending; if (lastSha === installed) return cached; }
    pending = discover(installed).catch(() => ({ state: 'unavailable', release: null, checkedAt: new Date().toISOString() }))
      .then(value => { cached = value; lastSha = installed; until = Date.now() + (value.state === 'unavailable' ? 300000 : TTL); })
      .finally(() => { pending = null; });
    await pending; return cached;
  };
}
module.exports = { discover, cachedDiscovery, TTL };
