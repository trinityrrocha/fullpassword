/* global process */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = process.env.SPFBL_UI_EVIDENCE_DIR;
if (evidence) fs.mkdirSync(evidence, { recursive: true });

// The real Modules card, SPFBL page and menu hook run against the real api client (CSRF + reauthentication
// retry); only the network is simulated. Nothing here can reach a real installation or any external service.
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import ModulesCard from '/src/components/ModulesCard.jsx';
import Spfbl from '/src/pages/Spfbl.jsx';
import {SHELL_ROOT,SHELL_MAIN,SHELL_SCROLLER} from '/src/layouts/shellClasses.js';
import {Routes,Route} from 'react-router-dom';
import {AuthProvider} from '/src/context/AuthContext.jsx';
import {ThemeProvider} from '/src/context/ThemeContext.jsx';
import DashboardLayout from '/src/layouts/DashboardLayout.jsx';
import useModulesMenu from '/src/hooks/useModulesMenu.js';
import api from '/src/services/api.js';
import '/src/index.css';
api.defaults.baseURL='/api';
window.__reauth=[];
window.addEventListener('fullpassword:reauth',event=>{window.__reauth.push({purpose:event.detail.purpose,action:event.detail.action});event.detail.resolve(window.__refuseReauth?null:'SYNTHETIC_GRANT');});
function MenuProbe(){const {modules}=useModulesMenu('user-1');return <nav aria-label="Menu de teste">{modules.spfbl===true&&<a href="/spfbl" data-menu-spfbl>SPFBL</a>}</nav>;}
const view=new URLSearchParams(location.search).get('view');
const shellView=view==='shell'||view==='shellbug';
const appView=view==='app';
createRoot(document.getElementById('root')).render(appView?<MemoryRouter initialEntries={['/spfbl']}><ThemeProvider><AuthProvider><Routes><Route element={<DashboardLayout/>}><Route path="/spfbl" element={<Spfbl/>}/></Route></Routes></AuthProvider></ThemeProvider></MemoryRouter>:<MemoryRouter>{shellView?<div className={SHELL_ROOT}><main className={view==='shell'?SHELL_MAIN:SHELL_MAIN.replace('relative ','')}><div className={view==='shell'?SHELL_SCROLLER:SHELL_SCROLLER.replace('relative ','')}><Spfbl/></div></main></div>:<main className="mx-auto max-w-5xl p-4">{view==='settings'?<><MenuProbe/><ModulesCard/></>:<Spfbl/>}</main>}</MemoryRouter>);
`;
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, appType: 'custom', plugins: [{
  name: 'spfbl-isolated-fixture', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:spfbl-fixture') return '\0spfbl-fixture.jsx'; },
  load(id) { if (id === '\0spfbl-fixture.jsx') return fixture; },
  transform(code, id) { if (id === '\0spfbl-fixture.jsx') return transformWithOxc(code, 'spfbl-fixture.jsx'); },
  configureServer(server) {
    server.middlewares.use('/__spfbl_fixture', async (_req, res, next) => {
      try {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/__spfbl_fixture', '<html lang="pt-BR"><head><title>SPFBL — teste isolado</title></head><body><div id="root"></div><script type="module">import "virtual:spfbl-fixture";</script></body></html>'));
      } catch (error) { next(error); }
    });
  }
}] });

const SECRETS = ['MATRIX_PASSWORD_SENTINEL_x1', 'WHMTOKENSENTINEL0123456789ABCDEF'];
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const newState = () => ({
  history: { retention_days: 30, interval_minutes: 60, retention_options: [30, 60, 90], interval_options: [5, 10, 15, 30, 60, 120, 180], timezone: 'America/Sao_Paulo', servers: [{ id: uid(1), name: 'Servidor Principal', matrix: true, last_run_at: '2026-11-24T09:00:00Z' }], stored: { rows: 4321, oldest_at: '2026-10-25T10:00:00Z', newest_at: '2026-11-24T10:00:00Z' }, running: false },
  enabled: false, role: 'super_admin', failToggle: false, calls: [], whmCooldown: false,
  servers: [{ id: uid(1), name: 'Servidor Principal', kind: 'cpanel', host: 'srv.example.com', whm_user: 'root', has_token: true, matrix_user: 'ops@example.com', has_matrix_password: true, matrix_configured: true, sync_at: null, sync_status: null, history_last_run_at: null, domains_total: 120, domains_active: 108, updated_at: '2026-11-21T00:00:00Z' }],
  domains: [
    ...Array.from({ length: 120 }, (_, i) => ({ id: uid(100 + i), name: `site${String(i).padStart(3, '0')}.example.com`, source: 'whm', server_id: uid(1), server_name: 'Servidor Principal', no_server: false, cpanel_user: `acct${i % 7}`, suspended: i % 10 === 0, active: i % 10 !== 0, last_seen_at: null, created_at: '2026-11-20T00:00:00Z' })),
    { id: uid(900), name: 'manual.example.org', source: 'manual', cpanel_user: null, suspended: false, active: true, last_seen_at: null, created_at: '2026-11-20T00:00:00Z' }
  ],
  users: [
    { id: uid(1), name: 'Root Admin', email: 'root@example.com', is_active: true, is_super_admin: true, role: 'admin' },
    { id: uid(2), name: 'Ana Souza', email: 'ana@example.com', is_active: true, is_super_admin: false, role: 'user' },
    { id: uid(3), name: 'Bruno Lima', email: 'bruno@example.com', is_active: true, is_super_admin: false, role: 'user' },
    { id: uid(4), name: 'Carla Inativa', email: 'carla@example.com', is_active: false, is_super_admin: false, role: 'user' },
    { id: uid(5), name: 'Davi Granted', email: 'davi@example.com', is_active: true, is_super_admin: false, role: 'user' }
  ],
  grants: [{ user_id: uid(5), name: 'Davi Granted', email: 'davi@example.com', role: 'user', user_active: true, unlock_mode: 'direct', created_at: '', updated_at: '', domains: [{ id: uid(900), name: 'manual.example.org', active: true }] }],
  ownScope: { role: 'user', unlock_mode: 'review', domains: [{ id: uid(900), name: 'manual.example.org', active: true }] }
});
let state = newState();

let browser;
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  await context.addCookies([{ name: 'fp_csrf', value: 'SYNTHETIC_CSRF', url: origin }]);
  const pageErrors = []; page.on('pageerror', (error) => pageErrors.push(error.message));
  const consoleErrors = []; page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  const overview = () => (state.role === 'user' ? state.ownScope : {
    role: 'super_admin', matrix_configured: state.servers.some((v) => v.matrix_configured), whm_configured: state.servers.length > 0,
    servers: { total: state.servers.length, with_matrix: state.servers.filter((v) => v.matrix_configured).length },
    domains: { total: state.domains.length, active: state.domains.filter((d) => d.active).length, without_server: state.domains.filter((d) => d.no_server).length }, users_with_access: state.grants.length
  });
  const reauthGate = (route, body, purpose) => {
    if (body._reauth_token === undefined) { route.fulfill({ status: 403, json: { error: 'Confirme sua identidade para esta alteração.', code: 'REAUTH_REQUIRED', purpose } }); return false; }
    assert.equal(body._reauth_token, 'SYNTHETIC_GRANT', 'the retry carries the grant the dialog returned');
    return true;
  };

  await page.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    assert.equal(url.origin, origin, 'the fixture must never reach a real installation or external service');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const method = request.method(); const api = url.pathname.slice(4);
    const body = request.postData() ? request.postDataJSON() : {};
    state.calls.push({ method, api, body });
    if (method !== 'GET') assert.equal(request.headers()['x-csrf-token'], 'SYNTHETIC_CSRF', `${method} ${api} carries the CSRF token`);
    const json = (data, status = 200) => route.fulfill({ status, json: data });

    if (api === '/system/modules/menu') return json({ modules: { spfbl: state.enabled } });
    if (api === '/system/modules' && method === 'GET') return json({ modules: [{ key: 'spfbl', name: 'SPFBL', description: 'Consulta e gestão de bloqueios de e-mail do Matrix SPFBL.', enabled: state.enabled }] });
    if (api === '/system/modules/spfbl' && method === 'PUT') {
      if (!reauthGate(route, body, 'modules_settings:spfbl')) return;
      if (state.failToggle) return json({ error: 'Não foi possível alterar o módulo.' }, 500);
      state.enabled = body.enabled; return json({ module: { key: 'spfbl', name: 'SPFBL', description: 'x', enabled: state.enabled, updated_at: '' } });
    }
    if (api === '/spfbl/overview') return state.enabled ? json(overview()) : json({ error: 'Módulo não está ativo.', code: 'MODULE_DISABLED' }, 404);
    if (api === '/spfbl/history-settings' && method === 'GET') return json(state.history);
    if (api === '/spfbl/history-settings' && method === 'PUT') {
      if (!reauthGate(route, body, 'spfbl_settings')) return;
      if (![30, 60, 90].includes(body.retention_days)) return json({ code: 'SPFBL_HISTORY_RETENTION_INVALID', error: 'Escolha 30, 60 ou 90 dias de retenção.' }, 422);
      if (body.retention_days < state.history.retention_days && !body.confirm_shrink) return json({ code: 'SPFBL_HISTORY_SHRINK_CONFIRM', error: 'x', rows_to_delete: 1234 }, 409);
      const deleted = body.retention_days < state.history.retention_days ? 1234 : 0;
      state.history = { ...state.history, retention_days: body.retention_days, interval_minutes: body.interval_minutes };
      return json({ ...state.history, deleted });
    }
    if (api === '/spfbl/history/collect' && method === 'POST') { state.history.running = true; return json({ started: true }, 202); }
    if (api === '/spfbl/whm-servers' && method === 'GET') return json({ servers: state.servers, limit: 50 });
    if (api === '/spfbl/whm-servers' && method === 'POST') {
      if (!reauthGate(route, body, 'spfbl_settings')) return;
      if (state.servers.some((v) => v.name.toLowerCase() === String(body.name).toLowerCase())) return json({ code: 'SPFBL_SERVER_NAME_EXISTS', error: 'Já existe um servidor com este nome.' }, 409);
      const server = { id: uid(10 + state.servers.length), name: body.name, kind: body.kind, host: body.host, whm_user: body.whm_user, has_token: Boolean(body.token), matrix_user: body.matrix_user || '', has_matrix_password: Boolean(body.matrix_password),
        matrix_configured: Boolean(body.matrix_user && body.matrix_password), sync_at: null, sync_status: null, history_last_run_at: null, domains_total: 0, domains_active: 0, updated_at: null };
      state.servers.push(server); return json({ server }, 201);
    }
    if (api === '/spfbl/whm-servers/validate/whm' && method === 'POST') {
      state.validations = [...(state.validations || []), { kind: 'whm', body }];
      const saved = body.id && state.servers.find((v) => v.id === body.id);
      if (!body.token && !(saved && saved.host === body.host && saved.whm_user === body.whm_user)) return json({ code: 'SPFBL_WHM_TOKEN_INVALID', error: 'Informe o token WHM.' }, 400);
      if (body.token === 'WHMTOKENBADTOKEN0123456789') return json({ code: 'WHM_AUTH_REFUSED', error: 'O WHM recusou o token.' }, 422);
      return json({ accounts: 7, domains: 121, active: 109, suspended: 12, skipped: 0 });
    }
    if (api === '/spfbl/whm-servers/validate/matrix' && method === 'POST') {
      state.validations = [...(state.validations || []), { kind: 'matrix', body }];
      const saved = body.id && state.servers.find((v) => v.id === body.id);
      if (!body.matrix_password && !(saved && saved.matrix_user === body.matrix_user && saved.has_matrix_password)) return json({ code: 'SPFBL_SECRET_REENTRY_REQUIRED', error: 'Informe novamente a senha do Matrix ao alterar o usuário.' }, 400);
      if (body.matrix_password === 'WRONG') return json({ code: 'MATRIX_AUTH_REFUSED', error: 'O Matrix recusou a autenticação. Revise o usuário e a senha.' }, 422);
      return json({ ok: true, message: 'Conexão com o Matrix confirmada.' });
    }
    const serverRoute = /^\/spfbl\/whm-servers\/([0-9a-f-]+)(?:\/(test|sync|matrix\/test))?$/.exec(api);
    if (serverRoute) {
      const target = state.servers.find((v) => v.id === serverRoute[1]);
      if (!target) return json({ code: 'SPFBL_SERVER_NOT_FOUND', error: 'Servidor não encontrado.' }, 404);
      if (method === 'PUT') {
        if (!reauthGate(route, body, 'spfbl_settings')) return;
        const reentry = (body.host !== undefined && body.host !== target.host && !body.token) || (body.matrix_user !== undefined && body.matrix_user !== target.matrix_user && target.has_matrix_password && !body.matrix_password && !body.remove_matrix);
        if (reentry) return json({ code: 'SPFBL_SECRET_REENTRY_REQUIRED', error: 'Informe novamente a senha.' }, 400);
        for (const key of ['name', 'host', 'whm_user']) if (body[key] !== undefined) target[key === 'whm_user' ? 'whm_user' : key] = body[key];
        if (body.token) target.has_token = true;
        if (body.remove_matrix) Object.assign(target, { matrix_user: '', has_matrix_password: false, matrix_configured: false });
        else { if (body.matrix_user !== undefined) target.matrix_user = body.matrix_user; if (body.matrix_password) target.has_matrix_password = true; target.matrix_configured = Boolean(target.matrix_user && target.has_matrix_password); }
        return json({ server: target });
      }
      if (method === 'DELETE') {
        if (!reauthGate(route, body, 'spfbl_settings')) return;
        if (typeof body.remove_domains !== 'boolean') return json({ code: 'SPFBL_REMOVE_CHOICE_REQUIRED', error: 'Informe se os domínios vinculados também devem ser removidos.' }, 422);
        const linked = state.domains.filter((d) => d.server_id === target.id);
        if (body.remove_domains) state.domains = state.domains.filter((d) => d.server_id !== target.id || d.source !== 'whm');
        state.domains = state.domains.map((d) => (d.server_id === target.id ? { ...d, server_id: null, server_name: null, no_server: d.source === 'whm' } : d));
        state.servers = state.servers.filter((v) => v.id !== target.id);
        return json({ name: target.name, domains_removed: body.remove_domains ? linked.filter((d) => d.source === 'whm').length : 0, domains_kept: body.remove_domains ? linked.filter((d) => d.source !== 'whm').length : linked.length });
      }
      if (serverRoute[2] === 'matrix/test') return json({ ok: true, message: 'Conexão com o Matrix confirmada.' });
      if (serverRoute[2] === 'test') return json({ accounts: 7, domains: 121, active: 109, suspended: 12, skipped: 0 });
      if (serverRoute[2] === 'sync') {
        if (state.whmCooldown) return json({ code: 'SPFBL_WHM_COOLDOWN', error: 'Aguarde 30 segundos entre consultas ao WHM.', retry_after_seconds: 21 }, 429);
        state.whmCooldown = true; target.sync_at = '2026-11-21T12:00:00Z'; target.sync_status = 'ok';
        return json({ accounts: 7, domains: 121, active: 109, suspended: 12, skipped: 1, added: 0, updated: 121, deactivated: 0 });
      }
    }
    if (api === '/spfbl/domains/sync') return json({ servers: state.servers.map((v) => ({ server_id: v.id, name: v.name, ok: v.name !== 'Servidor Falho', ...(v.name !== 'Servidor Falho' ? { domains: 1 } : { code: 'WHM_CONNECTION' }) })), ok: state.servers.filter((v) => v.name !== 'Servidor Falho').length, failed: state.servers.filter((v) => v.name === 'Servidor Falho').length, domains: 1 });
    if (api === '/spfbl/domains' && method === 'GET') return json({ domains: state.domains });
    if (api === '/spfbl/domains' && method === 'POST') {
      if (state.domains.some((d) => d.name === body.name.toLowerCase())) return json({ code: 'SPFBL_DOMAIN_EXISTS', error: 'Este domínio já está cadastrado.' }, 409);
      const domain = { id: uid(950 + state.domains.length), name: body.name.toLowerCase(), source: 'manual', cpanel_user: null, suspended: false, active: true };
      state.domains.push(domain); return json({ domain }, 201);
    }
    const removal = /^\/spfbl\/domains\/([0-9a-f-]+)$/.exec(api);
    if (removal && method === 'DELETE') { state.domains = state.domains.filter((d) => d.id !== removal[1]); return json({ removed: true }); }
    if (api === '/spfbl/access' && method === 'GET') return json({ access: state.grants });
    if (api === '/users') return json(state.users);
    const access = /^\/spfbl\/access\/([0-9a-f-]+)$/.exec(api);
    if (access && method === 'PUT') {
      if (!reauthGate(route, body, `spfbl_access:${access[1]}`)) return;
      const target = state.users.find((u) => u.id === access[1]);
      const domains = body.domain_ids.map((id) => state.domains.find((d) => d.id === id)).filter(Boolean).map((d) => ({ id: d.id, name: d.name, active: d.active }));
      state.grants = [...state.grants.filter((g) => g.user_id !== access[1]), { user_id: target.id, name: target.name, email: target.email, role: 'user', user_active: true, unlock_mode: body.unlock_mode, domains }];
      return json({ access: state.grants.find((g) => g.user_id === access[1]) });
    }
    if (access && method === 'DELETE') {
      if (!reauthGate(route, body, `spfbl_access:${access[1]}`)) return;
      state.grants = state.grants.filter((g) => g.user_id !== access[1]); return json({ revoked: true });
    }
    if (api === '/auth/me') return json({ user: { id: uid(1), name: 'Root Admin', email: 'root@example.com', role: 'admin', is_super_admin: true, is_active: true, must_change_password: false, menu_position: 'side', menu_display: 'icons', crypto_identity: { version: 2 } } });
    if (api === '/system/security-notifications') return json({ unread_count: 0, items: [] });
    if (api === '/crypto/identity') return json({ identity: null });
    if (api === '/system/update/status') return json({ error: 'n/a' }, 404);
    if (api === '/spfbl/dashboard/domains') {
      return json({ domains: [{ domain: 'manual.example.org', active: true, source: 'manual', total: 40, blocked: 9, banimento: 4, 'segurança': 5, 'inexistência': 0, unlocked: 1, pending: 2 },
        { domain: 'quiet.example.org', active: true, source: 'whm', total: 0, blocked: 0, banimento: 0, 'segurança': 0, 'inexistência': 0, unlocked: 0, pending: 0 },
        { domain: 'old.example.org', active: false, source: 'whm', total: 3, blocked: 0, banimento: 0, 'segurança': 0, 'inexistência': 0, unlocked: 0, pending: 0 }],
        totals: { total: 43, blocked: 9 }, period: { start: '2026-11-17', end: '2026-11-23', timezone: 'America/Sao_Paulo' }, state: { loading: false, pages: 1, partial: true, error: '', updated_at: '2026-11-23T23:15:31Z', rows: 43 } });
    }
    if (api === '/spfbl/audit' && method === 'GET') {
      const q = Object.fromEntries(url.searchParams); state.auditQueries = [...(state.auditQueries || []), q];
      if (q.start === 'bad') return json({ code: 'SPFBL_AUDIT_FILTER', error: 'Informe uma data válida.' }, 422);
      const all = [{ id: 'e1', at: '2026-11-23T21:17:03Z', action: 'spfbl_unlock_done', label: 'Desbloqueio', status: 'success', status_label: 'Sucesso', user: 'ana@example.com', details: { domain: 'manual.example.org', mode: 'direct' } },
        { id: 'e2', at: '2026-11-23T22:07:26Z', action: 'spfbl_review_requested', label: 'Revisão solicitada', status: 'success', status_label: 'Sucesso', user: 'davi@example.com', details: { domain: 'manual.example.org', notification: 'smtp_skipped' } },
        { id: 'e3', at: '2026-11-23T23:00:00Z', action: 'spfbl_unlock_done', label: 'Desbloqueio', status: 'failed', status_label: 'Falha', user: 'ana@example.com', details: { domain: 'manual.example.org', reason: 'SPFBL_UNCERTAIN', diagnostic: 'white HTTP=200 result=FAIL' } }];
      const events = all.filter((e) => (!q.status || e.status === q.status) && (!q.action || e.action === q.action));
      return json({ events, total: events.length, page: 1, pages: 1, actions: [{ value: 'spfbl_unlock_done', label: 'Desbloqueio' }, { value: 'spfbl_review_requested', label: 'Revisão solicitada' }] });
    }
    if (api === '/spfbl/dashboard') {
      state.dashboardCalls = (state.dashboardCalls || 0) + 1;
      return json({ categories: { banimento: 37, 'segurança': 24, 'inexistência': 33 }, domains: [{ name: 'manual.example.org', count: 94 }], recipients: [{ name: 'daniel@manual.example.org', count: 22 }, { name: 'ana@manual.example.org', count: 15 }],
        total: 1044, blocked: 94, latest_unlocks: [{ created_at: '2026-09-30T21:02:17Z', domain: 'manual.example.org', recipient: 'daniel@manual.example.org', sender: 'cobranca@tufaonet.com.br' }], period: { start: '2026-11-17', end: '2026-11-23', timezone: 'America/Sao_Paulo' }, domains_scope: ['manual.example.org', 'two.example.org'],
        state: { loading: state.dashboardCalls < 2, pages: 1, partial: true, error: '', updated_at: '2026-11-23T23:15:31Z', rows: 1044 } });
    }
    if (api === '/spfbl/history' && method === 'GET') {
      const q = Object.fromEntries(url.searchParams);
      state.historyQueries = [...(state.historyQueries || []), q];
      if (q.start === 'garbage') return json({ code: 'SPFBL_FILTER_DATE', error: 'Informe uma data válida.' }, 422);
      const all = Array.from({ length: 60 }, (_, i) => ({ id: String(i).padStart(64, '0'), timestamp: 1795476025 - i * 600, sender: `s${i}@out.example`, from: '', replyto: '', recipient: `u${i}@${q.domain || 'manual.example.org'}`,
        release: i === 1 ? { state: 'unlocked', at: '2026-11-24T01:10:00Z', by: 'Ana Souza' } : null, status: i % 5 === 0 ? 'Livres' : 'Bloqueados', reason: i % 5 === 0 ? 'Aceita pelo filtro' : (i % 2 ? 'Rejeitada por segurança' : 'Rejeitada por inexistência'), icon: i % 5 === 0 ? '' : (i % 2 ? 'security' : 'inexistent'), result: i % 2 ? 'BLOCK' : 'INEXISTENT' }));
      const wanted = all.filter((r) => (q.status || 'Bloqueados') === 'Todos' || r.status === (q.status || 'Bloqueados'));
      const page = Math.max(1, Number(q.page) || 1); const size = Number(q.page_size) || 20;
      return json({ domain_no_server: q.domain === 'two.example.org', page_size: size, domain: q.domain || 'manual.example.org', domains_scope: ['manual.example.org', 'two.example.org'], filters: { status: q.status || 'Bloqueados', by: q.by || 'sender', email: q.email || '', start: q.start || '2026-11-17', end: q.end || '2026-11-23' },
        rows: wanted.slice((page - 1) * size, page * size), period_total: 60, filtered_total: wanted.length, page, pages: Math.ceil(wanted.length / size), state: { loading: false, pages: 2, partial: true, error: '', updated_at: '2026-11-23T23:14:51Z', rows: 60 } });
    }
    if (api === '/spfbl/history/refresh') return json({ state: { loading: false, pages: 1, partial: false, error: '', updated_at: '2026-11-23T23:20:00Z', rows: 60 } });
    const recordMatch = /^\/spfbl\/records\/([0-9a-f]{64})(\/status)?$/.exec(api);
    const stateOfRecord = () => ({ operation: { status: state.opStatus || null, uncertain: state.opStatus === 'uncertain', done: state.opStatus === 'done' }, request: state.myRequest || null,
      release: state.opStatus === 'done' ? { state: 'unlocked', at: '2026-11-24T01:10:00Z', by: 'Ana Souza', unlocked_at: '2026-11-24T01:10:00Z', unlocked_by: 'Ana Souza' } : (state.blockedAgain ? { state: 'blocked', at: '2026-11-24T02:00:00Z', by: 'Ana Souza', unlocked_at: '2026-11-24T01:10:00Z', unlocked_by: 'Ana Souza' } : null),
      events: state.opStatus === 'done' ? [{ action: 'unlocked', at: '2026-11-24T01:10:00Z', by: 'Ana Souza' }] : [],
      can_block: (state.role === 'super_admin' || state.mode === 'direct') && !state.blockedAgain && !state.opStatus || (state.opStatus === 'done' && state.mode === 'direct'),
      can_request: state.role === 'user' && state.mode !== 'direct' && !state.myRequest && !state.opStatus, can_unlock: (state.role === 'super_admin' || state.mode === 'direct') && !state.opStatus, confirmation: 'a'.repeat(64) });
    if (recordMatch && !recordMatch[2] && state.readOnlyRecord) return json({ domain: 'two.example.org', record: { id: recordMatch[1], timestamp: 1795476025, sender: 'x@out.example', from: '', replyto: '', recipient: 'a@two.example.org', status: 'Bloqueados', reason: 'Rejeitada por segurança', icon: 'security', result: 'BLOCK' }, ...stateOfRecord(), can_request: false, can_unlock: false, can_block: false, read_only: true, read_only_reason: 'no_server', read_only_message: 'Este domínio está sem servidor de consulta: só o histórico fica disponível.' });
    if (recordMatch && !recordMatch[2]) return json({ domain: 'manual.example.org', record: { id: recordMatch[1], timestamp: 1795476025, sender: 'mirandacredito@out.example', from: '', replyto: '', recipient: 'daniel@manual.example.org', status: 'Bloqueados', reason: 'Rejeitada por segurança', icon: 'security', result: 'BLOCK' }, ...stateOfRecord() });
    if (recordMatch && recordMatch[2]) { state.statusChecks = (state.statusChecks || 0) + 1; return state.statusChecks === 1 ? json({ code: 'SPFBL_STATUS_COOLDOWN', error: 'Aguarde alguns segundos antes de consultar de novo.' }, 429) : json({ provider_status: 'NONE', label: 'Sem regra no SPFBL', changed_reason: false }); }
    const recordAction = /^\/spfbl\/records\/([0-9a-f]{64})\/(request|unlock|block)$/.exec(api);
    if (recordAction && method === 'POST') {
      if (body.confirm !== true) return json({ code: 'SPFBL_CONFIRM_REQUIRED', error: 'Confirme a solicitação antes de enviar.' }, 422);
      if (recordAction[2] === 'request') { state.myRequest = { id: uid(700), status: 'pending', status_label: 'Aguardando revisão' }; state.requestCalls = (state.requestCalls || 0) + 1; return json({ request: state.myRequest }, 201); }
      if (recordAction[2] === 'block') { state.blockBodies = [...(state.blockBodies || []), body]; state.blockedAgain = true; state.opStatus = null; return json({ request: { id: uid(702), status: 'reblocked' } }); }
      state.unlockBodies = [...(state.unlockBodies || []), body];
      if (state.failUnlock) { state.opStatus = 'uncertain'; return json({ code: 'SPFBL_UNCERTAIN', error: 'O SPFBL não confirmou o resultado. A tentativa foi registrada e não será repetida automaticamente. Consulte o administrador.' }, 503); }
      state.opStatus = 'done'; return json({ request: { id: uid(701), status: 'unlocked' } });
    }
    if (api === '/spfbl/requests' && method === 'GET') {
      state.requestList = state.requestList || [{ id: uid(710), domain: 'manual.example.org', recipient: 'ana@manual.example.org', sender: 'spam@out.example', reason: 'Rejeitada por segurança', icon: 'security', status: 'pending', status_label: 'Aguardando revisão', source: 'review', revision: 0, result_info: '',
        requested_at: '2026-11-23T20:00:00Z', reviewed_at: null, actor_name: 'Davi Granted', reviewer_name: null, can_keep: true, can_release: true, can_block: false }];
      return json({ requests: state.requestList, is_admin: state.role === 'super_admin' });
    }
    const requestRoute = /^\/spfbl\/requests\/([0-9a-f-]+)(?:\/(keep|release|block))?$/.exec(api);
    if (requestRoute && !requestRoute[2]) return json({ request: state.requestList.find((r) => r.id === requestRoute[1]), confirmation: 'b'.repeat(64), events: [{ action: 'kept', created_at: '2026-11-23T21:00:00Z', actor_name: 'Root Admin' }] });
    if (requestRoute && requestRoute[2] && method === 'POST') {
      state.decisions = [...(state.decisions || []), { action: requestRoute[2], body }];
      const target = state.requestList.find((r) => r.id === requestRoute[1]);
      if (state.failDecision) return json({ code: 'SPFBL_REVISION_CHANGED', error: 'Esta decisão mudou desde que a página foi aberta. Recarregue antes de continuar.' }, 409);
      Object.assign(target, requestRoute[2] === 'keep' ? { status: 'kept', status_label: 'Bloqueio mantido', can_keep: false, can_release: false, can_block: true }
        : requestRoute[2] === 'release' ? { status: 'unlocked', status_label: 'Desbloqueado pelo SPFBL', can_keep: false, can_release: false, can_block: true } : { status: 'reblocked', status_label: 'Bloqueado novamente pelo administrador', can_block: false }, { revision: target.revision + 1 });
      return json({ request: target, notification: body.notify ? 'skipped' : 'none' });
    }
    return json({ error: `Unexpected ${method} ${api}` }, 500);
  });

  const open = async (view) => { await page.goto(`${origin}/__spfbl_fixture?view=${view}`); };
  const reauthSeen = () => page.evaluate(() => window.__reauth);
  const noOverflow = async (label) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no horizontal scroll`);
  const shot = async (name) => { if (evidence) await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true }); };

  // ================= 1. Settings > Módulos: keyboard toggle, reauthentication, pessimistic update, menu refresh =================
  await open('settings');
  assert.equal(await page.locator('[data-menu-spfbl]').count(), 0, 'module off: no icon in the menu');
  await page.getByRole('button', { name: /Módulos/ }).click();
  const toggle = page.getByRole('switch', { name: 'SPFBL' });
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  assert.match(await toggle.getAttribute('aria-describedby'), /description/);
  state.failToggle = true;
  await toggle.focus(); await page.keyboard.press('Space');
  await page.getByRole('alert').filter({ hasText: 'Não foi possível alterar o módulo' }).waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false', 'a refused change never moves the switch');
  assert.equal(await page.locator('[data-menu-spfbl]').count(), 0);
  state.failToggle = false; state.calls.length = 0;
  await toggle.press('Space');
  await page.getByRole('status').filter({ hasText: 'SPFBL ativado' }).waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  const reauth = await reauthSeen();
  assert.deepEqual(reauth.at(-1), { purpose: 'modules_settings:spfbl', action: { enabled: true } }, 'the grant is requested for exactly this action and module');
  assert.deepEqual(state.calls.filter((c) => c.method === 'PUT').map((c) => [c.body.enabled, c.body._reauth_token]), [[true, undefined], [true, 'SYNTHETIC_GRANT']], 'first attempt is refused with REAUTH_REQUIRED, the retry carries the grant');
  await page.locator('[data-menu-spfbl]').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Abrir o SPFBL' }).getAttribute('href'), '/spfbl');
  await shot('modules-card-light');
  await page.evaluate(() => { window.__refuseReauth = true; });
  await toggle.press('Space');
  await page.getByRole('alert').filter({ hasText: /Confirme sua identidade/ }).waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true', 'cancelling the reauthentication changes nothing');
  await page.evaluate(() => { window.__refuseReauth = false; });
  await toggle.press('Space');
  await page.getByRole('status').filter({ hasText: 'SPFBL desativado' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-menu-spfbl]'));

  // ================= 2. Module off: the page explains instead of failing silently =================
  state.enabled = false;
  await open('page');
  await page.getByRole('alert').filter({ hasText: 'Configurações → Módulos' }).waitFor();
  assert.equal(await page.getByText('Conexão Matrix SPFBL').count(), 0);

  // ================= 3. Super Admin page =================
  state = newState(); state.enabled = true;
  await open('page');
  await page.getByRole('heading', { level: 1, name: 'SPFBL Report' }).waitFor();
  assert.equal(await page.getByText('Conexão Matrix SPFBL').count(), 0, 'connection settings are hidden until a gear is used');
  assert.equal(await page.getByRole('button', { name: 'Configurações do SPFBL Report', exact: true }).count(), 1, 'one tab, no gear in the header');
  await page.getByRole('button', { name: 'Configurações do SPFBL Report', exact: true }).click();
  const cards = page.getByRole('list').filter({ has: page.getByRole('button', { name: 'Configurar Servidores' }) }).getByRole('listitem');
  assert.equal(await cards.count(), 3, 'three cards: Servidores, Retenção do histórico, Domínios');
  assert.match(await cards.nth(2).innerText(), /109 ativos de 121/);
  await shot('settings-tab-1280');

  assert.match(await cards.nth(0).innerText(), /Servidores[\s\S]*1 servidor · 1 com Matrix/);
  assert.match(await cards.nth(1).innerText(), /Retenção do histórico/);
  assert.equal(await page.getByRole('button', { name: 'Configurar Conexão Matrix' }).count(), 0, 'the Matrix modal is gone: it lives inside each server');
  assert.equal(await page.getByRole('button', { name: 'Configurar Servidor WHM' }).count(), 0, 'one Servidores card replaces the two old ones');
  await shot('settings-tab-1280');

  // ---- Retenção do histórico: global parameters for every server ----
  await page.getByRole('button', { name: 'Configurar Retenção do histórico' }).click();
  const retention = page.getByRole('dialog', { name: 'Retenção do histórico' });
  await retention.waitFor();
  await retention.getByText('Parâmetros globais: valem para todos os servidores.').waitFor();
  assert.equal(await retention.getByLabel('Usuário Matrix').count(), 0, 'no server fields here');
  await shot('settings-dialog-1280');
  assert.deepEqual(await page.getByLabel('Guardar por').locator('option').allInnerTexts(), ['30 dias', '60 dias', '90 dias']);
  await page.getByLabel('Guardar por').selectOption('90');
  assert.deepEqual(await page.getByLabel('Coletar a cada').locator('option').allInnerTexts(), ['5 minutos', '10 minutos', '15 minutos', '30 minutos', '1 hora', '2 horas', '3 horas']);
  await page.getByLabel('Coletar a cada').selectOption('120');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Configuração do histórico salva.' }).waitFor();
  assert.deepEqual([state.history.retention_days, state.history.interval_minutes], [90, 120]);
  await page.getByLabel('Guardar por').selectOption('30');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'apagará 1.234 registros' }).waitFor();
  assert.equal(state.history.retention_days, 90, 'nothing changes before the confirmation');
  await page.getByRole('button', { name: 'Confirmar e apagar' }).click();
  await page.getByRole('status').filter({ hasText: '1.234 registros antigos foram apagados.' }).waitFor();
  assert.equal(state.history.retention_days, 30);
  await page.getByRole('button', { name: 'Coletar agora' }).click();
  await page.getByRole('status').filter({ hasText: 'Coleta iniciada em segundo plano' }).waitFor();
  await page.getByText(/Servidor Principal: recebidos coletados em/).waitFor();
  await page.keyboard.press('Escape');
  await retention.waitFor({ state: 'detached' });

  // ---- Servidores: ONE dialog for the server and its Matrix connection ----
  await page.getByRole('button', { name: 'Configurar Servidores' }).click();
  await page.getByRole('dialog', { name: 'Servidores' }).waitFor();
  const serverList = page.getByRole('list', { name: 'Servidores cadastrados' });
  await serverList.getByText('Servidor Principal').waitFor();
  await serverList.getByText(/cPanel \(WHM\) · root@srv.example.com · 120 domínios · Matrix: ops@example.com/).waitFor();
  assert.equal(await serverList.getByRole('button', { name: 'Sincronizar domínios de Servidor Principal' }).count(), 1, 'the list has the sync-domains button');
  await page.getByRole('button', { name: 'Adicionar servidor', exact: true }).click();
  const addDialog = page.getByRole('dialog', { name: 'Adicionar servidor' });
  await addDialog.waitFor();
  assert.deepEqual(await addDialog.getByLabel('Tipo de servidor').locator('option').allInnerTexts(), ['cPanel (WHM)'], 'the type select starts with cPanel');
  for (const label of [/^Nome do servidor/, /^Tipo de servidor/, /^Endereço \(hostname\)/, /^Usuário$/, /^Token/, /^Usuário Matrix/, /^Senha Matrix/]) await addDialog.getByLabel(label).waitFor();
  await shot('server-dialog-1280');
  // each credential has its own validation button; nothing is saved by validating
  await addDialog.getByLabel('Nome do servidor').fill('Servidor Filial');
  await addDialog.getByLabel('Endereço (hostname)').fill('filial.example.com');
  await addDialog.getByRole('button', { name: 'Validar credenciais do servidor' }).click();
  await addDialog.getByRole('alert').filter({ hasText: 'Informe o token WHM.' }).waitFor();
  await addDialog.getByLabel(/^Token/).fill('WHMTOKENBADTOKEN0123456789');
  await addDialog.getByRole('button', { name: 'Validar credenciais do servidor' }).click();
  await addDialog.getByRole('alert').filter({ hasText: 'O WHM recusou o token.' }).waitFor();
  await addDialog.getByLabel(/^Token/).fill(SECRETS[1]);
  assert.equal(await addDialog.getByText('O WHM recusou o token.').count(), 0, 'typing clears the earlier answer');
  state.calls.length = 0;
  await addDialog.getByRole('button', { name: 'Validar credenciais do servidor' }).click();
  await addDialog.getByRole('status').filter({ hasText: 'Credenciais validadas: 7 contas, 121 domínios (109 ativos). Nada foi gravado.' }).waitFor();
  assert.equal(state.calls.some((c) => c.method === 'POST' && c.api === '/spfbl/whm-servers'), false, 'validating stores nothing');
  await addDialog.getByLabel('Usuário Matrix').fill('filial@example.com');
  await addDialog.getByLabel('Senha Matrix').fill('WRONG');
  await addDialog.getByRole('button', { name: 'Validar credenciais do Matrix' }).click();
  await addDialog.getByRole('alert').filter({ hasText: 'O Matrix recusou a autenticação.' }).waitFor();
  await addDialog.getByLabel('Senha Matrix').fill(SECRETS[0]);
  await addDialog.getByRole('button', { name: 'Validar credenciais do Matrix' }).click();
  await addDialog.getByRole('status').filter({ hasText: 'Credenciais validadas. Conexão com o Matrix confirmada.' }).waitFor();
  const lastValidation = state.validations.at(-1);
  assert.deepEqual(Object.keys(lastValidation.body).sort(), ['matrix_password', 'matrix_user'], 'the Matrix check sends only the Matrix fields');
  state.calls.length = 0;
  await addDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await addDialog.waitFor({ state: 'detached' });
  await serverList.getByText('Servidor Filial').waitFor();
  const created = state.calls.filter((c) => c.method === 'POST' && c.api === '/spfbl/whm-servers').at(-1).body;
  assert.deepEqual(Object.keys(created).sort(), ['_reauth_token', 'host', 'kind', 'matrix_password', 'matrix_user', 'name', 'token', 'whm_user'], 'one record carries the WHM and the Matrix data');
  assert.equal(created.kind, 'cpanel'); assert.equal((await reauthSeen()).at(-1).purpose, 'spfbl_settings');
  // a duplicate name is refused by the server and explained
  await page.getByRole('button', { name: 'Adicionar servidor', exact: true }).click();
  await addDialog.waitFor();
  await addDialog.getByLabel('Nome do servidor').fill('servidor filial'); await addDialog.getByLabel('Endereço (hostname)').fill('dup.example.com'); await addDialog.getByLabel(/^Token/).fill(SECRETS[1]);
  await addDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await addDialog.getByRole('alert').filter({ hasText: 'Já existe um servidor com este nome.' }).waitFor();
  await addDialog.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('button', { name: 'Descartar', exact: true }).last().click().catch(() => {});
  await addDialog.waitFor({ state: 'detached' });
  // edit: a blank secret validates with the SAVED one (same target); changing the host/user asks for it again
  await page.getByRole('button', { name: 'Editar Servidor Principal' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Editar servidor Servidor Principal' });
  await editDialog.waitFor();
  assert.equal(await editDialog.getByLabel(/^Token/).inputValue(), '', 'the saved token is never shown');
  assert.equal(await editDialog.getByLabel('Senha Matrix').inputValue(), '', 'the saved password is never shown');
  await editDialog.getByText('Há um token salvo. Deixe em branco para mantê-lo.').waitFor();
  await editDialog.getByRole('button', { name: 'Validar credenciais do servidor' }).click();
  await editDialog.getByRole('status').filter({ hasText: 'Credenciais validadas: 7 contas' }).waitFor();
  assert.equal(state.validations.at(-1).body.id, uid(1), 'the saved secret is used for the same target');
  await editDialog.getByRole('button', { name: 'Validar credenciais do Matrix' }).click();
  await editDialog.getByRole('status').filter({ hasText: 'Credenciais validadas. Conexão com o Matrix confirmada.' }).waitFor();
  await editDialog.getByLabel('Endereço (hostname)').fill('outro.example.com');
  await editDialog.getByText('digite o token novamente').waitFor();
  assert.equal(await editDialog.getByText('Credenciais validadas: 7 contas').count(), 0, 'editing a credential field makes the earlier answer stale');
  await editDialog.getByRole('button', { name: 'Validar credenciais do servidor' }).click();
  await editDialog.getByRole('alert').filter({ hasText: 'Informe o token WHM.' }).waitFor();
  await editDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await editDialog.getByRole('alert').filter({ hasText: 'digite novamente a senha ou o token' }).waitFor();
  await editDialog.getByLabel('Endereço (hostname)').fill('srv.example.com');
  await editDialog.getByLabel('Usuário Matrix').fill('other@example.com');
  await editDialog.getByRole('button', { name: 'Validar credenciais do Matrix' }).click();
  await editDialog.getByRole('alert').filter({ hasText: 'digite novamente a senha ou o token' }).waitFor();
  await editDialog.getByLabel('Usuário Matrix').fill('ops@example.com');
  await editDialog.getByLabel('Nome do servidor').fill('Matriz');
  await editDialog.getByLabel('Senha Matrix').fill(SECRETS[0]);
  state.calls.length = 0;
  await editDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await editDialog.waitFor({ state: 'detached' });
  await serverList.getByText('Matriz').waitFor();
  const edit = state.calls.filter((c) => c.method === 'PUT').at(-1).body;
  assert.equal(edit.matrix_password, SECRETS[0]); assert.equal('token' in edit, false, 'a blank token is not sent: the saved one is kept');
  // sync domains: one server, then all; the cool-down message
  await page.getByRole('button', { name: 'Sincronizar domínios de Matriz' }).click();
  await page.getByRole('status').filter({ hasText: /Matriz: sincronizado\. 121 domínios \(109 ativos, 12 de contas suspensas\); 0 novos, 121 atualizados, 0 desativados; 1 registros ignorados/ }).waitFor();
  await serverList.getByText(/Última sincronização bem-sucedida em/).first().waitFor();
  await page.getByRole('button', { name: 'Sincronizar domínios de Matriz' }).click();
  await page.getByRole('alert').filter({ hasText: 'Aguarde 21 segundos antes de tentar de novo.' }).waitFor();
  await page.getByRole('button', { name: 'Sincronizar todos os servidores' }).click();
  await page.getByRole('status').filter({ hasText: '2 servidor(es) sincronizado(s).' }).waitFor();
  // remove: the choice about the domains is mandatory and there is no default
  state.domains.push({ id: uid(901), name: 'filial.example.org', source: 'whm', server_id: uid(11), server_name: 'Servidor Filial', no_server: false, cpanel_user: 'x', suspended: false, active: true, last_seen_at: null, created_at: '2026-11-20T00:00:00Z' });
  state.servers.find((v) => v.name === 'Servidor Filial').domains_total = 1;
  await page.getByRole('button', { name: 'Sincronizar todos os servidores' }).click(); // reloads the list with the new count
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Remover Servidor Filial' }).click();
  const removeDialog = page.getByRole('dialog', { name: 'Remover o servidor Servidor Filial?' });
  await removeDialog.waitFor();
  await removeDialog.getByText(/Este servidor tem 1 domínio vinculado\. Deseja remover os domínios vinculados a ele\?/).waitFor();
  assert.equal(await removeDialog.getByRole('button', { name: 'Remover servidor' }).isDisabled(), true, 'no answer yet: nothing can be removed');
  assert.equal(await removeDialog.getByRole('radio', { checked: true }).count(), 0, 'there is no default choice');
  await removeDialog.getByRole('radio', { name: /Não, manter/ }).check();
  state.calls.length = 0;
  await removeDialog.getByRole('button', { name: 'Remover servidor' }).click();
  await removeDialog.waitFor({ state: 'detached' });
  await page.getByRole('status').filter({ hasText: 'Servidor Servidor Filial removido. 0 domínios removidos; 1 mantidos sem servidor de consulta.' }).waitFor();
  const removeCall = state.calls.filter((c) => c.method === 'DELETE' && c.api.startsWith('/spfbl/whm-servers/')).at(-1);
  assert.equal(removeCall.body.remove_domains, false); assert.equal((await reauthSeen()).at(-1).purpose, 'spfbl_settings');
  const kept = state.domains.find((d) => d.name === 'filial.example.org');
  assert.deepEqual([kept.server_id, kept.no_server, kept.active], [null, true, true], 'kept domains stay, without a query server');
  assert.equal(await serverList.getByText('Servidor Filial').count(), 0);
  // remove the other way: the imported domains go with the server
  await page.getByRole('button', { name: 'Adicionar servidor', exact: true }).click();
  await addDialog.waitFor();
  await addDialog.getByLabel('Nome do servidor').fill('Servidor Falho'); await addDialog.getByLabel('Endereço (hostname)').fill('falho.example.com'); await addDialog.getByLabel(/^Token/).fill(SECRETS[1]);
  await addDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await addDialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Sincronizar todos os servidores' }).click();
  await page.getByRole('alert').filter({ hasText: 'falhou: Servidor Falho (WHM_CONNECTION)' }).waitFor();
  state.domains.push({ id: uid(902), name: 'falho.example.org', source: 'whm', server_id: state.servers.find((v) => v.name === 'Servidor Falho').id, server_name: 'Servidor Falho', no_server: false, cpanel_user: 'y', suspended: false, active: true, last_seen_at: null, created_at: '2026-11-20T00:00:00Z' });
  state.servers.find((v) => v.name === 'Servidor Falho').domains_total = 1;
  await page.getByRole('button', { name: 'Remover Servidor Falho' }).click();
  const removeFalho = page.getByRole('dialog', { name: 'Remover o servidor Servidor Falho?' });
  await removeFalho.waitFor();
  await removeFalho.getByRole('radio', { name: /Sim, remover/ }).check();
  await removeFalho.getByRole('button', { name: 'Remover servidor' }).click();
  await removeFalho.waitFor({ state: 'detached' });
  assert.equal(state.domains.some((d) => d.name === 'falho.example.org'), false, 'the imported domain went with its server');
  // Nothing secret anywhere in the page or in browser storage.
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  for (const secret of SECRETS) assert.equal(html.includes(secret), false, 'a secret must not appear in the DOM');
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);

  // ================= 4. Domains: 121 rows, filtered and paginated =================
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Servidores' }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Configurar Domínios' }).click();
  await page.getByRole('dialog', { name: 'Domínios' }).waitFor();
  const list = page.getByRole('list', { name: 'Domínios do catálogo' });
  assert.equal(await list.getByRole('listitem').count(), 20, 'at most 20 domains per page');
  await page.getByText(/122 de 122 domínios · página 1 de 7/).waitFor();
  await page.getByRole('navigation', { name: 'Paginação de domínios' }).getByRole('button', { name: 'Próxima' }).click();
  await page.getByText(/página 2 de 7/).waitFor();
  assert.equal(await list.getByRole('listitem').first().getByText('site020.example.com').count(), 1);
  // each imported domain names its server; a kept domain says it has no query server and can be filtered
  await list.getByRole('listitem').first().getByText(/Servidor Servidor Principal/).waitFor();
  await page.getByLabel('Situação').selectOption('no_server');
  await page.getByText(/1 de 122 domínios/).waitFor();
  await list.getByRole('listitem').first().getByText('Sem servidor de consulta').first().waitFor();
  await list.getByRole('listitem').first().getByRole('button', { name: 'Remover filial.example.org' }).waitFor();
  await page.getByLabel('Situação').selectOption('all');
  await page.getByLabel('Buscar por domínio ou conta cPanel').fill('acct3');
  await page.getByText(/página 1 de 1|de 122 domínios\./).first().waitFor();
  const filtered = await list.getByRole('listitem').count();
  assert.ok(filtered > 0 && filtered <= 20, `filter result ${filtered}`);
  await page.getByLabel('Buscar por domínio ou conta cPanel').fill('');
  await page.getByLabel('Situação').selectOption('inactive');
  await page.getByText(/12 de 122 domínios/).waitFor();
  assert.ok((await list.innerText()).includes('Conta suspensa'), 'the state is written out, not only coloured');
  await page.getByLabel('Situação').selectOption('all');
  await page.getByLabel('Cadastrar domínio à mão').fill('Novo.Example.com');
  await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'novo.example.com cadastrado.' }).waitFor();
  await page.getByLabel('Cadastrar domínio à mão').fill('novo.example.com');
  await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Este domínio já está cadastrado.' }).waitFor();
  await page.getByLabel('Buscar por domínio ou conta cPanel').fill('novo.example');
  await page.getByRole('button', { name: 'Remover novo.example.com' }).click();
  await page.getByText('Remover novo.example.com?').waitFor();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('status').filter({ hasText: 'novo.example.com removido.' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Remover site001.example.com' }).count(), 0, 'imported domains are not removable by hand');

  // ================= 5. Access: dialog, keyboard, scoped candidates, reauthentication per target =================
  await page.getByLabel('Buscar por domínio ou conta cPanel').fill('');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Domínios' }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Configurar Domínios', 'focus returns to the gear');
  await page.getByRole('button', { name: 'Acessos' }).click();
  const give = page.getByRole('button', { name: 'Dar acesso' });
  await give.click();
  const dialog = page.getByRole('dialog', { name: 'Dar acesso ao SPFBL' });
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), true, 'focus moves into the dialog');
  const options = await dialog.getByLabel('Usuário').locator('option').allInnerTexts();
  assert.deepEqual(options, ['Selecione um usuário', 'Ana Souza (ana@example.com)', 'Bruno Lima (bruno@example.com)'], 'no Super Admin, no inactive account, no account that already has access');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Dar acesso', 'focus returns to the trigger');
  await give.click(); await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Salvar acesso' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Escolha o usuário, o modo e de 1 a 100 domínios.' }).waitFor();
  await dialog.getByLabel('Usuário').selectOption(uid(2));
  await dialog.getByRole('radio', { name: 'Desbloqueio direto' }).check();
  await dialog.getByPlaceholder('Filtrar domínios').fill('site00');
  await dialog.getByText(/0 domínios selecionados/).waitFor();
  const checkboxes = dialog.getByRole('checkbox');
  assert.equal(await checkboxes.count(), 10);
  await checkboxes.nth(1).check(); await checkboxes.nth(2).check();
  await dialog.getByText(/2 domínios selecionados/).waitFor();
  assert.equal(await dialog.getByText('(inativo)').count(), 1, 'the first row (suspended account) is flagged inactive');
  state.calls.length = 0;
  await dialog.getByRole('button', { name: 'Salvar acesso' }).click();
  await page.getByRole('status').filter({ hasText: 'Acesso de Ana Souza salvo.' }).waitFor();
  const put = state.calls.filter((c) => c.method === 'PUT' && c.api === `/spfbl/access/${uid(2)}`).at(-1);
  assert.deepEqual([put.body.unlock_mode, put.body.domain_ids, put.body._reauth_token], ['direct', [uid(101), uid(102)], 'SYNTHETIC_GRANT']);
  assert.equal((await reauthSeen()).at(-1).purpose, `spfbl_access:${uid(2)}`, 'the grant is bound to the target account');
  const grants = page.getByRole('list', { name: 'Usuários com acesso ao SPFBL' });
  await grants.getByText('Ana Souza').waitFor();
  assert.equal(await grants.getByRole('listitem').filter({ hasText: 'Ana Souza' }).getByText('Desbloqueio direto').count(), 1);
  const anaRow = grants.getByRole('listitem').filter({ hasText: 'Ana Souza' }).first();
  assert.equal(Math.round((await anaRow.boundingBox()).height), 45, 'one compact row of 45px per account');
  await page.getByRole('button', { name: 'Editar acesso de Ana Souza' }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Editar acesso ao SPFBL' }).getByLabel('Usuário').isDisabled(), true, 'the account cannot be switched while editing');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Revogar acesso de Ana Souza' }).click();
  await page.getByText('Revogar?', { exact: true }).waitFor();
  state.calls.length = 0;
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('status').filter({ hasText: 'Acesso de Ana Souza revogado.' }).waitFor();
  const revoke = state.calls.filter((c) => c.method === 'DELETE' && c.api === `/spfbl/access/${uid(2)}`).at(-1);
  assert.equal(revoke.body._reauth_token, 'SYNTHETIC_GRANT'); assert.equal((await reauthSeen()).at(-1).purpose, `spfbl_access:${uid(2)}`);
  assert.equal(await grants.getByText('Ana Souza').count(), 0);
  await shot('page-admin-light-1280');

  // ================= 6. Responsive + dark theme, no horizontal scroll =================
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const dark of [false, true]) {
      await page.evaluate((value) => document.documentElement.classList.toggle('dark', value), dark);
      await noOverflow(`admin ${width}px ${dark ? 'dark' : 'light'}`);
      await shot(`page-admin-${width}-${dark ? 'dark' : 'light'}`);
    }
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.setViewportSize({ width: 1280, height: 900 });

  // ================= 7. A granted account: its own scope only, never configuration =================
  state = newState(); state.enabled = true; state.role = 'user';
  state.ownScope = { role: 'user', unlock_mode: 'review', domains: [{ id: uid(900), name: 'manual.example.org', active: true }, { id: uid(901), name: 'inativo.example.org', active: false }] };
  state.calls.length = 0;
  await open('page');
  await page.getByRole('button', { name: 'Meu acesso' }).click();
  await page.getByRole('heading', { name: 'Seus domínios' }).waitFor();
  await page.getByText('Solicitar revisão ao administrador').first().waitFor();
  assert.equal(await page.getByText('manual.example.org').count(), 1);
  assert.equal(await page.getByText('Conexão Matrix SPFBL').count(), 0); assert.equal(await page.getByText('Acessos de usuários').count(), 0);
  assert.deepEqual([...new Set(state.calls.map((c) => c.api))].filter((api) => !['/spfbl/overview', '/spfbl/dashboard'].includes(api)), [], 'a granted account never even requests configuration, domains or grants');
  for (const dark of [false, true]) { await page.evaluate((value) => document.documentElement.classList.toggle('dark', value), dark); await shot(`page-user-${dark ? 'dark' : 'light'}`); }
  await page.setViewportSize({ width: 390, height: 800 }); await noOverflow('granted user 390px');

  // ================= 8. Dashboard, history and record detail (Phase 2) =================
  await page.setViewportSize({ width: 1280, height: 900 });
  state = newState(); state.enabled = true; state.role = 'user'; state.mode = 'review';
  await open('page');
  await page.getByText('Coletando histórico do Matrix').waitFor();
  await page.getByText('Cobertura parcial').waitFor({ timeout: 8000 });
  await page.getByText('1.044').waitFor(); await page.getByText('94').first().waitFor();
  assert.equal(await page.getByRole('progressbar').count(), 3, 'one bar per reason');
  await page.getByText('Top 10 destinatários').waitFor();
  await shot('dashboard-1280');
  await page.getByRole('button', { name: 'Histórico' }).click();
  await page.getByRole('heading', { name: 'Registros do domínio' }).waitFor();
  assert.deepEqual(await page.getByLabel('Domínio autorizado').locator('option').allInnerTexts(), ['manual.example.org', 'two.example.org']);
  assert.equal(await page.locator('tbody tr').count(), 20, '20 rows per page by default');
  assert.equal(await page.getByText(/48 registros\/tentativas com os filtros/).count(), 1);
  await page.getByRole('button', { name: 'Próxima' }).click();
  await page.getByText(/Página 2 de 3/).waitFor();
  await page.getByLabel('Paginação do histórico: resultados por página').selectOption('40');
  await page.getByText(/Página 1 de 2/).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 40, 'the page size can be 40');
  assert.equal(state.historyQueries.at(-1).page_size, '40');
  await page.getByLabel('Paginação do histórico: resultados por página').selectOption('20');
  await page.getByText(/Página 1 de 3/).waitFor();
  await page.getByLabel('Situação').selectOption('Todos');
  await page.getByLabel('Até').fill('2026-11-22');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await page.getByText(/60 registros\/tentativas com os filtros/).waitFor();
  assert.equal(state.historyQueries.at(-1).status, 'Todos'); assert.equal(state.historyQueries.at(-1).end, '2026-11-22');
  await page.getByLabel('De').fill('garbage').catch(() => {});
  await page.getByLabel('E-mail completo').fill('mirandacredito@out.example');
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await page.getByText(/48 registros\/tentativas com os filtros/).waitFor();
  await shot('history-1280');
  // a domain without a query server: the history is there, the actions are not
  await page.getByLabel('Domínio autorizado').selectOption('two.example.org');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await page.getByText(/Este domínio está sem servidor de consulta: só o histórico já coletado fica disponível/).waitFor();
  state.readOnlyRecord = true;
  await page.getByRole('button', { name: /Detalhes de u1@two.example.org/ }).click();
  await page.getByRole('heading', { name: 'Detalhes do registro' }).waitFor();
  await page.getByText('Este domínio está sem servidor de consulta: só o histórico fica disponível.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Consultar status atual' }).isDisabled(), true, 'no Matrix lookup without a server');
  assert.equal(await page.getByRole('button', { name: /Desbloquear|Solicitar|Bloquear remetente/ }).count(), 0, 'no unlock, request or block');
  state.readOnlyRecord = false;
  await page.getByRole('button', { name: /Voltar ao histórico/ }).click();
  await page.getByLabel('Domínio autorizado').selectOption('manual.example.org');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await page.getByText(/48 registros\/tentativas com os filtros/).waitFor();
  await page.getByRole('button', { name: /Detalhes de u1@manual.example.org/ }).click();
  await page.getByRole('heading', { name: 'Detalhes do registro' }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.includes('Voltar ao histórico')), true, 'focus moves to the back control');
  await page.getByText('Resultado original').waitFor();
  await page.getByRole('button', { name: 'Consultar status atual' }).click();
  await page.getByRole('alert').filter({ hasText: 'Aguarde alguns segundos' }).waitFor();
  await page.getByRole('button', { name: 'Consultar status atual' }).click();
  await page.getByText('Sem regra no SPFBL.').waitFor();
  await shot('record-1280');
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await noOverflow(`record ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole('button', { name: '← Voltar ao histórico' }).click();
  await page.getByRole('heading', { name: 'Registros do domínio' }).waitFor();
  await noOverflow('history 390px');
  await page.getByRole('button', { name: 'Dashboard' }).click(); await page.getByText('Top 10 destinatários').waitFor(); await noOverflow('dashboard 390px');
  await page.evaluate(() => document.documentElement.classList.add('dark')); await shot('dashboard-390-dark'); await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.setViewportSize({ width: 1280, height: 900 });

  // ================= 9. Requests and decisions (Phase 2B) =================
  // 9a. A review-mode account: checkbox required, double submit sends once, then the request is shown instead of the form.
  await page.getByRole('button', { name: 'Histórico' }).click();
  await page.getByRole('button', { name: /Detalhes de u1@manual.example.org/ }).click();
  await page.getByRole('heading', { name: 'Solicitar revisão do bloqueio' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Desbloquear remetente' }).count(), 0, 'a review-mode account never sees the direct unlock');
  await page.getByRole('button', { name: 'Registrar solicitação' }).click();
  await page.getByRole('alert').filter({ hasText: 'Marque a confirmação' }).waitFor();
  assert.equal(state.requestCalls || 0, 0, 'nothing is sent without the confirmation');
  await page.getByLabel('Confirmo que desejo solicitar a revisão deste registro.').check();
  await page.getByRole('button', { name: 'Registrar solicitação' }).dblclick();
  await page.getByText('Solicitação registrada. O administrador foi avisado.').waitFor().catch(() => {});
  await page.getByRole('heading', { name: 'Sua solicitação' }).waitFor();
  assert.equal(state.requestCalls, 1, 'a double click sends one request');
  await shot('record-requested-1280');
  await page.getByRole('button', { name: '← Voltar ao histórico' }).click();
  await page.getByRole('button', { name: 'Solicitações' }).click();
  await page.getByRole('heading', { name: 'Minhas solicitações' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Revisar/ }).count(), 0, 'an ordinary account cannot review');

  // 9b. A direct-mode account: scope warning, confirmation required, proof from the server, uncertain result locks the record.
  state = newState(); state.enabled = true; state.role = 'user'; state.mode = 'direct';
  await open('page');
  await page.getByRole('button', { name: 'Histórico' }).click();
  await page.getByRole('button', { name: /Detalhes de u1@manual.example.org/ }).click();
  await page.getByRole('heading', { name: 'Desbloquear remetente' }).waitFor();
  await page.getByText(/pode afetar outros destinatários da mesma integração/).first().waitFor();
  state.failUnlock = true;
  await page.getByLabel('Entendo o alcance e confirmo o desbloqueio deste remetente.').check();
  await page.getByRole('button', { name: 'Desbloquear', exact: true }).click();
  await page.getByRole('heading', { name: 'Resultado não confirmado' }).waitFor();
  assert.equal(state.unlockBodies.length, 1); assert.equal(state.unlockBodies[0].proof, 'a'.repeat(64), 'the server-issued proof travels with the action'); assert.equal(state.unlockBodies[0].confirm, true);
  assert.equal(await page.getByRole('heading', { name: 'Desbloquear remetente' }).count(), 0, 'an uncertain record cannot be unlocked again from the screen');
  await shot('record-uncertain-1280');
  state.failUnlock = false; state.opStatus = null;
  await page.getByRole('button', { name: 'Consultar status atual' }).click().catch(() => {});
  // success path: the same screen immediately shows "was blocked, now unlocked", who and when, and offers blocking again
  await page.getByRole('button', { name: '← Voltar ao histórico' }).click();
  await page.getByRole('button', { name: /Detalhes de u1@manual.example.org/ }).click();
  await page.getByLabel('Entendo o alcance e confirmo o desbloqueio deste remetente.').check();
  await page.getByRole('button', { name: 'Desbloquear', exact: true }).click();
  await page.getByRole('heading', { name: 'Remetente desbloqueado' }).waitFor();
  await page.getByText('agora está desbloqueado').waitFor(); await page.getByText(/por Ana Souza/).first().waitFor();
  await page.getByRole('heading', { name: 'Histórico de ações' }).waitFor();
  await shot('record-unlocked-1280');
  await page.getByLabel('Entendo o alcance e confirmo o bloqueio deste remetente.').check();
  await page.getByRole('button', { name: 'Bloquear remetente' }).click();
  await page.getByRole('heading', { name: 'Remetente bloqueado novamente' }).waitFor();
  assert.deepEqual(state.blockBodies.map((b) => [b.proof, b.confirm]), [['a'.repeat(64), true]], 'the block carries the server proof and the confirmation');
  assert.equal(await page.getByRole('heading', { name: 'Bloquear remetente', exact: true }).count(), 0, 'no second block offered');
  await page.getByRole('button', { name: '← Voltar ao histórico' }).click();
  await page.locator('tbody').getByText(/Ana Souza/).first().waitFor();
  assert.ok((await page.getByLabel('Situação').locator('option').allInnerTexts()).includes('Desbloqueados'), 'filter option for released records');
  await shot('history-unlocked-1280');

  // 9c. The Super Admin queue: review, keep, release, block again, stale decision refused with a clear message.
  state = newState(); state.enabled = true; state.role = 'super_admin';
  await open('page');
  await page.getByRole('button', { name: 'Solicitações' }).click();
  await page.getByRole('heading', { name: 'Solicitações de revisão' }).waitFor();
  await page.getByRole('button', { name: /Revisar ana@manual.example.org/ }).click();
  const panel = page.getByRole('region', { name: 'Revisão da solicitação' });
  await panel.getByText('Davi Granted').waitFor();
  await shot('requests-admin-1280');
  await panel.getByRole('button', { name: 'Manter bloqueio' }).click();
  await panel.getByText('Bloqueio mantido. Nada foi enviado ao SPFBL.').waitFor();
  assert.deepEqual(state.decisions.map((d) => [d.action, d.body.revision, d.body.notify]), [['keep', 0, false]]);
  await panel.getByRole('button', { name: 'Bloquear novamente' }).waitFor();
  await panel.getByRole('button', { name: 'Bloquear novamente' }).click();
  await panel.getByRole('alert').filter({ hasText: 'Marque a confirmação' }).waitFor();
  assert.equal(state.decisions.length, 1, 'block-again needs its confirmation');
  await panel.getByLabel(/Entendo o alcance/).check(); await panel.getByLabel(/Avisar o solicitante/).check();
  state.failDecision = true;
  await panel.getByRole('button', { name: 'Bloquear novamente' }).click();
  await panel.getByRole('alert').filter({ hasText: 'Esta decisão mudou desde que a página foi aberta' }).waitFor();
  state.failDecision = false;
  await panel.getByRole('button', { name: 'Bloquear novamente' }).click();
  await panel.getByText('Bloqueio enviado e confirmado pelo SPFBL.').waitFor();
  const last = state.decisions.at(-1); assert.equal(last.action, 'block'); assert.equal(last.body.proof, 'b'.repeat(64)); assert.equal(last.body.notify, true);
  await page.getByRole('combobox', { name: 'Situação' }).selectOption('pending');
  await page.setViewportSize({ width: 390, height: 800 }); await noOverflow('requests admin 390px'); await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.getByText('Últimos 10 desbloqueios').waitFor(); await page.getByText('cobranca@tufaonet.com.br').waitFor();

  // ================= 10. Phase 3: admin overview of every domain, audit page, compact one-line rows, short dates =================
  state = newState(); state.enabled = true; state.role = 'super_admin';
  await page.setViewportSize({ width: 1280, height: 900 });
  await open('page');
  await page.getByRole('heading', { name: 'Todos os domínios cadastrados' }).waitFor();
  const overviewRows = page.getByRole('table', { name: 'Resultados por domínio cadastrado' }).locator('tbody tr');
  assert.equal(await overviewRows.count(), 3, 'every registered domain is listed, including one without records and an inactive one');
  await page.getByText('quiet.example.org').waitFor(); await page.getByText('inativo', { exact: true }).waitFor();
  await page.getByPlaceholder('Buscar domínio').fill('quiet'); assert.equal(await overviewRows.count(), 1);
  await page.getByPlaceholder('Buscar domínio').fill(''); await page.getByLabel('Só com bloqueios').check(); assert.equal(await overviewRows.count(), 1); await page.getByLabel('Só com bloqueios').uncheck();
  await shot('admin-overview-1280');
  // history rows are one line each
  await page.getByRole('button', { name: 'Histórico' }).click();
  await page.getByRole('heading', { name: 'Registros do domínio' }).waitFor();
  const heights = await page.locator('tbody tr').evaluateAll((rowsEls) => rowsEls.map((el) => Math.round(el.getBoundingClientRect().height)));
  assert.ok(heights.length >= 20 && Math.max(...heights) <= 44, `history rows stay on one line (max ${Math.max(...heights)}px)`);
  const firstDate = await page.locator('tbody tr td').first().innerText();
  assert.match(firstDate, /^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/, 'dates are dd/mm/aa hh:mm');
  await noOverflow('history 1280 compact');
  assert.equal(await page.locator('table').first().evaluate((table) => table.parentElement.scrollWidth <= table.parentElement.clientWidth), true, 'no horizontal scrollbar on the history table at 1280 px');
  assert.match(await page.locator('tbody tr td:nth-child(3)').first().innerText(), /^[^@\s]+@…$/, 'the recipient is shown as local@…');
  await shot('history-compact-1280');
  // audit page
  await page.getByRole('button', { name: 'Auditoria' }).click();
  await page.getByText('3 eventos').waitFor();
  assert.equal(await page.getByRole('table', { name: 'Auditoria do SPFBL' }).locator('tbody tr').count(), 3);
  await page.getByRole('table', { name: 'Auditoria do SPFBL' }).getByText(/white HTTP=200 result=FAIL/).waitFor();
  assert.equal(await page.getByText(/MATRIX_PASSWORD_SENTINEL|WHMTOKENSENTINEL/).count(), 0, 'no secrets on the audit page');
  await page.getByLabel('Situação').selectOption('failed'); await page.getByRole('button', { name: 'Filtrar' }).click();
  await page.getByText('1 eventos').waitFor();
  assert.equal(state.auditQueries.at(-1).status, 'failed');
  await page.getByLabel('Situação').selectOption(''); await page.getByRole('button', { name: 'Limpar' }).click(); await page.getByText('3 eventos').waitFor();
  await shot('audit-1280');
  await page.setViewportSize({ width: 390, height: 800 }); await noOverflow('audit 390px'); await page.setViewportSize({ width: 1280, height: 900 });
  // deep link from the bell: ?tab=requests opens the queue directly, ?tab=audit the audit page
  await page.goto(`${origin}/__spfbl_fixture?view=page&tab=requests`);
  await page.getByRole('heading', { name: 'Solicitações de revisão' }).waitFor();
  await page.goto(`${origin}/__spfbl_fixture?view=page&tab=audit`);
  await page.getByRole('table', { name: 'Auditoria do SPFBL' }).waitFor();
  // an ordinary account never gets the audit tab nor the all-domains table
  state = newState(); state.enabled = true; state.role = 'user'; state.mode = 'review';
  await page.goto(`${origin}/__spfbl_fixture?view=page&tab=audit`);
  await page.getByRole('button', { name: 'Dashboard' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Auditoria' }).count(), 0, 'no audit tab for ordinary accounts');
  assert.equal(await page.getByRole('heading', { name: 'Todos os domínios cadastrados' }).count(), 0);

  // ================= 11. Layout regression: one scrollbar, the menu never moves with the wheel =================
  state = newState(); state.enabled = true; state.role = 'user'; state.mode = 'review';
  await page.setViewportSize({ width: 1280, height: 600 });
  const extraDocumentScroll = async (view) => {
    await page.goto(`${origin}/__spfbl_fixture?view=${view}&tab=history`);
    await page.getByRole('heading', { name: 'Registros do domínio' }).waitFor();
    // Measured at the top of the content area (where the user starts scrolling) and again after scrolling it to the end.
    const gap = () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const atTop = await gap();
    await page.locator('div.overflow-y-auto').first().evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.mouse.move(640, 300); await page.mouse.wheel(0, 4000);
    return Math.max(atTop, await gap());
  };
  assert.equal(await extraDocumentScroll('shell'), 0, 'the page itself never scrolls: only the content area does (no second scrollbar)');
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.setViewportSize({ width: 1280, height: 900 });

  // ================= 12. The REAL app layout (menu + content): wheel scrolling must not move the page or add a scrollbar =================
  state = newState(); state.enabled = true; state.role = 'super_admin';
  await page.setViewportSize({ width: 1600, height: 740 });
  const appGap = async (strip) => {
    await page.goto(`${origin}/__spfbl_fixture?view=app`);
    await page.getByRole('button', { name: 'Histórico' }).click();
    await page.getByRole('heading', { name: 'Registros do domínio' }).waitFor();
    if (strip) await page.evaluate(() => document.querySelectorAll('[data-app-shell]').forEach((el) => el.classList.remove('relative')));
    const gap = () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const top = await gap();
    await page.mouse.move(800, 400); await page.mouse.wheel(0, 3000);
    return { top, after: await gap(), scrollY: await page.evaluate(() => window.scrollY), menuTop: await page.evaluate(() => Math.round(document.querySelector('nav, aside')?.getBoundingClientRect().top ?? 0)) };
  };
  const fixed = await appGap(false);
  assert.deepEqual([fixed.top, fixed.after, fixed.scrollY, fixed.menuTop], [0, 0, 0, 0], 'the real layout never scrolls the page; the menu stays put');
  // Whatever leaks out of the shell (simulated: an absolutely positioned element far below), the document must not scroll.
  const leak = async (active) => {
    await page.goto(`${origin}/__spfbl_fixture?view=app`);
    await page.getByRole('button', { name: 'Histórico' }).click();
    await page.getByRole('heading', { name: 'Registros do domínio' }).waitFor();
    await page.evaluate((on) => {
      if (!on) document.documentElement.classList.remove('app-shell-active');
      const stray = document.createElement('div'); stray.style.cssText = 'position:absolute;top:3000px;left:0;width:10px;height:10px'; document.body.appendChild(stray);
    }, active);
    await page.mouse.move(800, 400);
    for (let n = 0; n < 4; n += 1) { await page.mouse.wheel(0, 3000); await page.waitForTimeout(700); } // separate gestures: the first scrolls the content area, later ones chain to the page
    await page.keyboard.press('PageDown');
    return page.evaluate(() => ({ scrollY: window.scrollY, menuTop: Math.round(document.querySelector('aside')?.getBoundingClientRect().top ?? 0) }));
  };
  assert.deepEqual(await leak(true), { scrollY: 0, menuTop: 0 }, 'a stray element cannot make the page scroll or move the menu');
  assert.ok((await leak(false)).scrollY > 0, 'negative control: without the shell lock the same stray element makes the page scroll');
  await page.setViewportSize({ width: 1280, height: 900 });

  assert.deepEqual(pageErrors, [], 'no uncaught page errors');
  console.log(JSON.stringify({ spfblUi: 'PASS', moduleSwitch: 'keyboard + reauth bound to the action, pessimistic, menu refreshed', secrets: 'never prefilled, cleared after save, absent from DOM/storage', domains: '121 rows paginated 25/page, filter, manual add/remove', access: 'dialog focus/Escape/return, candidates scoped, reauth bound to target, revoke', responsive: [1280, 768, 390, 320], themes: ['light', 'dark'], grantedUser: 'own scope only' }));
} finally {
  await browser?.close();
  await vite.close();
}
