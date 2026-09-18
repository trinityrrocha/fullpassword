import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canInstallUpdate, combineUpdateNotification, describeUpdateStatus, isUpdateSuperAdmin, requestUpdateCheck } from '../src/utils/updateNotifications.js';

const available = { state: 'update_available', update_available: true, notification_unread: true, available_commit: 'a'.repeat(40), commits_behind: 5, discovered_at: '2026-09-14T00:00:00Z' };
const security = { unread_count: 2, items: [{ id: 'security:1' }] };
assert.equal(combineUpdateNotification(security, available, true).unread_count, 3);
assert.equal(combineUpdateNotification(security, available, false).unread_count, 2);
assert.equal(combineUpdateNotification(security, { ...available, notification_unread: false }, true).unread_count, 2);
assert.equal(canInstallUpdate({ ...available, notification_unread: false }), true);
assert.equal(combineUpdateNotification(security, available, true).items[0].id, `update:${available.available_commit}`);
assert.equal(combineUpdateNotification(security, available, true).items[0].target_url, '/settings?section=update');
assert.equal(isUpdateSuperAdmin({ role: 'admin', is_super_admin: true }), true);
assert.equal(isUpdateSuperAdmin({ role: 'user', is_super_admin: true }), false);
for (const state of ['up_to_date', 'check_failed', 'local_ahead', 'diverged', 'unknown', 'checking', 'updating']) {
  assert.equal(canInstallUpdate({ ...available, state }), false);
  assert.ok(describeUpdateStatus({ state }).length > 10);
}
let time = 0;
let polls = 0;
const requests = [];
const api = { post: async (url) => { requests.push(url); return { data: { request_id: 'request1' } }; },
  get: async (url) => { requests.push(url); return { data: { ...available, last_check_request_id: ++polls > 1 ? 'request1' : null } }; } };
assert.equal((await requestUpdateCheck(api, { now: () => time, wait: async (ms) => { time += ms; } })).state, 'update_available');
assert.ok(requests.every((url) => url.startsWith('/system/update/')));
time = 0;
await assert.rejects(() => requestUpdateCheck({ ...api, get: async () => ({ data: { state: 'checking' } }) }, { now: () => time, wait: async (ms) => { time += ms; } }));
assert.equal(time, 30000);
const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const panel = read('../src/components/UpdateStatusPanel.jsx');
assert.doesNotMatch(panel, /api\.post|onUpdate|<button/);
assert.match(panel, /Atualização web indisponível/);
assert.match(panel, /version\.json/);
assert.match(panel, /versions.backend !== versions.frontend/);
assert.match(panel, /dark:/);
const settings = read('../src/pages/Settings.jsx');
assert.match(settings, /searchParams.get\('section'\) === 'update' \? 'system-update'/);
assert.doesNotMatch(settings, /v1\.0\.1/);
assert.doesNotMatch(settings, /setUpdateCountdown|sincroniza o código fonte/);
const layout = read('../src/layouts/DashboardLayout.jsx');
assert.match(layout, /if \(!canSeeUpdates\) return undefined/);
assert.match(layout, /\/system\/update\/mark-seen/);
assert.match(layout, /addEventListener\('focus', refresh\)/);
assert.match(layout, /canSeeUpdates && \(/);
assert.match(layout, /navigate\(targetUrl\)/);
console.log('Update notifications frontend: states, badge, viewed update, polling deadline and integration checks passed.');
