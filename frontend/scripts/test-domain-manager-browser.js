/* global process */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The real Domain Manager page runs against the real api client (CSRF); only the network is simulated, on localhost.
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import DomainManager from '/src/pages/DomainManager.jsx';
import api from '/src/services/api.js';
import '/src/index.css';
api.defaults.baseURL='/api';
createRoot(document.getElementById('root')).render(<main className="p-4"><DomainManager/></main>);
`;
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, appType: 'custom', plugins: [{
  name: 'dm-isolated-fixture', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:dm-fixture') return '\0dm-fixture.jsx'; },
  load(id) { if (id === '\0dm-fixture.jsx') return fixture; },
  transform(code, id) { if (id === '\0dm-fixture.jsx') return transformWithOxc(code, 'dm-fixture.jsx'); },
  configureServer(server) {
    server.middlewares.use('/__dm_fixture', async (_req, res, next) => {
      try {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/__dm_fixture', '<html lang="pt-BR"><head><title>Domain Manager — teste isolado</title></head><body><div id="root"></div><script type="module">import "virtual:dm-fixture";</script></body></html>'));
      } catch (error) { next(error); }
    });
  }
}] });

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const snap = (extra = {}) => ({ checked_at: '2026-11-26T15:00:00Z', lookup_status: 'ok', error_code: null, registrar: 'Registrador Exemplo', expires_on: '2027-02-10', days_left: 76, registered_on: '2020-02-10', rdap_statuses: ['active'], nameservers: ['ns1.exemplo.net', 'ns2.exemplo.net'], dnssec: true, ssl: { state: 'valid', not_after: '2027-01-10T00:00:00Z', issuer: 'CA Exemplo', protocol: 'TLSv1.3', error: null }, ...extra });
const state = {
  calls: [], interval: 7, rateLimited: false, alerts: {}, role: 'super_admin', userIds: [],
  domains: [
    { id: uid(1), name: 'exemplo.com.br', source: 'manual', active: true, snapshot: snap() },
    { id: uid(2), name: 'vencido.com', source: 'spfbl', active: true, snapshot: snap({ expires_on: '2026-11-20', days_left: -6, ssl: { state: 'expired', not_after: null, issuer: null, protocol: null, error: null } }) },
    { id: uid(3), name: 'novo.org', source: 'manual', active: true, snapshot: null },
    ...Array.from({ length: 30 }, (_, i) => ({ id: uid(100 + i), name: `extra${String(i).padStart(2, '0')}.com`, source: 'manual', active: true, snapshot: null }))
  ]
};

let browser;
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  await context.addCookies([{ name: 'fp_csrf', value: 'SYNTHETIC_CSRF', url: origin }]);
  const pageErrors = []; page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    assert.equal(url.origin, origin, 'the fixture must never reach an external service');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const method = request.method(); const api = url.pathname.slice(4);
    const body = request.postData() ? request.postDataJSON() : {};
    state.calls.push({ method, api, body, query: Object.fromEntries(url.searchParams) });
    if (method !== 'GET') assert.equal(request.headers()['x-csrf-token'], 'SYNTHETIC_CSRF', `${method} ${api} carries the CSRF token`);
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (api === '/domain-manager/domains' && method === 'GET') {
      const size = Number(url.searchParams.get('size') || 20); const pageNo = Number(url.searchParams.get('page') || 1);
      const term = (url.searchParams.get('search') || '').toLowerCase();
      const all = state.domains.filter((d) => d.name.includes(term) && (state.role === 'super_admin' || state.userIds.includes(d.id)));
      const withAlerts = (d) => { const a = state.alerts[d.id]; return { ...d, alerts: a ? { enabled: a.enabled, notify_admins: a.notify_admins, emails: a.emails.length } : { enabled: false, notify_admins: false, emails: 0 } }; };
      if (state.role === 'user') return json({ domains: all.slice((pageNo - 1) * size, pageNo * size).map((d) => ({ ...d })), total: all.length, page: pageNo, size, role: 'user' });
      return json({ domains: all.slice((pageNo - 1) * size, pageNo * size).map(withAlerts), total: all.length, page: pageNo, size, role: 'super_admin', settings: { check_interval_days: state.interval } });
    }
    if (api === '/domain-manager/domains' && method === 'POST') {
      const domain = { id: uid(500), name: body.name, source: 'manual', active: true, snapshot: null };
      state.domains.unshift(domain); return json({ domain }, 201);
    }
    if (api === '/domain-manager/domains/import') return json({ added: body.names.length - 1, duplicates: 1, invalid: ['ruim'] });
    if (/^\/domain-manager\/domains\/[^/]+\/alerts$/.test(api)) {
      const id = api.split('/')[3];
      if (method === 'PUT') { state.alerts[id] = { enabled: body.enabled, notify_admins: body.notify_admins, emails: body.emails }; return json(state.alerts[id]); }
      return json(state.alerts[id] || { enabled: false, notify_admins: false, emails: [] });
    }
    if (/^\/domain-manager\/domains\/[^/]+\/check$/.test(api)) {
      if (state.rateLimited) return json({ code: 'DM_COOLDOWN', error: 'Este domínio foi consultado agora há pouco. Aguarde alguns segundos.' }, 429);
      const id = api.split('/')[3]; const domain = state.domains.find((d) => d.id === id);
      domain.snapshot = snap({ expires_on: '2026-12-09', days_left: 13 });
      return json({ domain, changes: [{ field: 'expires_on', old_value: '2026-12-01', new_value: '2026-12-09', detected_at: '2026-11-26T15:00:00Z' }] });
    }
    if (/^\/domain-manager\/domains\/[^/]+$/.test(api) && method === 'DELETE') { const id = api.split('/')[3]; state.domains = state.domains.filter((d) => d.id !== id); return json({ ok: true }); }
    if (/^\/domain-manager\/domains\/[^/]+$/.test(api)) { const domain = state.domains.find((d) => d.id === api.split('/')[3]); return json({ domain, changes: [] }); }
    if (api === '/domain-manager/settings' && method === 'PUT') { state.interval = body.check_interval_days; return json({ check_interval_days: state.interval }); }
    return json({ error: `unexpected ${method} ${api}` }, 404);
  });

  await page.goto(`${origin}/__dm_fixture`);
  const rows = page.getByRole('list', { name: 'Domínios' }).getByRole('listitem');
  await rows.first().waitFor();
  assert.equal(await rows.count(), 20, 'first page holds 20 rows');
  assert.match(await page.getByRole('status').first().innerText(), /33 domínios/);

  // Expiry text carries meaning without colour: days left, expired, and "waiting" rows.
  const first = rows.filter({ hasText: 'exemplo.com.br' });
  assert.match(await first.innerText(), /10\/02\/27/); assert.match(await first.innerText(), /em 76 dias/); assert.match(await first.innerText(), /Válido/);
  const expired = rows.filter({ hasText: 'vencido.com' });
  assert.match(await expired.innerText(), /venceu há 6 dias/); assert.match(await expired.innerText(), /Vencido/);
  assert.match(await rows.filter({ hasText: 'novo.org' }).innerText(), /Aguardando consulta/);

  // Pagination 20/40/100.
  await page.getByRole('button', { name: 'Próxima' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Domínios"] > li').length === 13);
  await page.getByLabel('Paginação de domínios: resultados por página').selectOption('40');
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Domínios"] > li').length === 33);

  // Search is sent to the server (debounced), page resets.
  await page.getByLabel('Buscar domínio').fill('vencido');
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Domínios"] > li').length === 1);
  assert.ok(state.calls.some((c) => c.method === 'GET' && c.query.search === 'vencido' && c.query.page === '1'));
  await page.getByLabel('Buscar domínio').fill('');
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Domínios"] > li').length === 33);

  // The lookup button runs the check and opens the details with the detected change.
  await page.getByRole('button', { name: 'Consultar exemplo.com.br agora' }).click();
  const dialog = page.getByRole('dialog', { name: 'exemplo.com.br' });
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /09\/12\/26/); assert.match(await dialog.innerText(), /Mudanças detectadas/); assert.match(await dialog.innerText(), /01\/12\/26 → 09\/12\/26/);
  assert.match(await dialog.innerText(), /Registrador Exemplo/); assert.match(await dialog.innerText(), /ns1\.exemplo\.net, ns2\.exemplo\.net/);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });

  // A cooldown answer is shown, not swallowed.
  state.rateLimited = true;
  await page.getByRole('button', { name: 'Consultar vencido.com agora' }).click();
  assert.match(await page.getByRole('alert').innerText(), /Aguarde alguns segundos/);
  state.rateLimited = false;

  // Detail of a never-checked domain explains itself.
  await page.getByRole('button', { name: 'novo.org', exact: true }).click();
  assert.match(await page.getByRole('dialog', { name: 'novo.org' }).innerText(), /ainda não foi consultado/);
  await page.keyboard.press('Escape');

  // Add one domain; import a list; spfbl rows cannot be removed from here; manual rows need a confirmation.
  await page.getByRole('button', { name: 'Adicionar domínios' }).click();
  await page.getByLabel('Domínio', { exact: true }).fill('meu-site.com.br');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.ok(state.calls.some((c) => c.method === 'POST' && c.api === '/domain-manager/domains' && c.body.name === 'meu-site.com.br'));
  await page.getByRole('button', { name: 'Adicionar domínios' }).click();
  await page.getByRole('button', { name: 'Colar lista' }).click();
  await page.getByLabel(/Lista de domínios/).fill('a.com\nb.com, ruim\na.com');
  assert.match(await page.getByRole('dialog').innerText(), /3 domínios na lista/);
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  assert.match(await page.getByRole('status').filter({ hasText: 'cadastrado' }).innerText(), /1 inválido\(s\): ruim/);
  assert.deepEqual(state.calls.find((c) => c.api === '/domain-manager/domains/import').body.names, ['a.com', 'b.com', 'ruim']);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Remover vencido.com' }).count(), 0, 'SPFBL domains are removed in SPFBL');
  await page.getByRole('button', { name: 'Remover exemplo.com.br' }).click();
  assert.equal(state.calls.filter((c) => c.method === 'DELETE').length, 0, 'removal needs a second click');
  await page.getByRole('button', { name: 'Remover', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('[aria-label="Domínios"] > li')].some((li) => li.innerText.includes('exemplo.com.br')));

  // Alerts (gear): switch, several e-mails, the administrators checkbox; saving needs a recipient.
  await page.getByRole('button', { name: 'Alertas de novo.org' }).click();
  const alertsDialog = page.getByRole('dialog', { name: 'Alertas — novo.org' });
  await alertsDialog.waitFor();
  const alertsSwitch = alertsDialog.getByRole('switch', { name: 'Alertas de vencimento' });
  await alertsSwitch.waitFor();
  assert.equal(await alertsSwitch.getAttribute('aria-checked'), 'false');
  assert.equal(await alertsDialog.getByLabel('E-mails para notificação').count(), 0, 'e-mail fields only appear when the alerts are on');
  await alertsSwitch.click();
  assert.equal(await alertsDialog.getByRole('button', { name: 'Salvar' }).isDisabled(), true, 'on without a recipient cannot be saved');
  assert.match(await alertsDialog.innerText(), /ao menos um e-mail ou marque/);
  const emailField = alertsDialog.getByLabel('E-mails para notificação');
  await emailField.fill('invalido'); await alertsDialog.getByRole('button', { name: 'Adicionar e-mail' }).click();
  assert.match(await alertsDialog.getByRole('alert').first().innerText(), /e-mail válido/);
  await emailField.fill('TI@Empresa.com'); await emailField.press('Enter');
  await emailField.fill('outro@empresa.com'); await alertsDialog.getByRole('button', { name: 'Adicionar e-mail' }).click();
  await emailField.fill('ti@empresa.com'); await alertsDialog.getByRole('button', { name: 'Adicionar e-mail' }).click();
  assert.match(await alertsDialog.getByRole('alert').first().innerText(), /já está na lista/);
  await alertsDialog.getByRole('checkbox', { name: /Notificar os administradores/ }).check();
  await alertsDialog.getByRole('button', { name: 'Salvar' }).click();
  await alertsDialog.waitFor({ state: 'detached' });
  const putAlerts = state.calls.find((c) => c.method === 'PUT' && c.api.endsWith('/alerts'));
  assert.deepEqual(putAlerts.body, { enabled: true, notify_admins: true, emails: ['ti@empresa.com', 'outro@empresa.com'] });
  await rows.filter({ hasText: 'novo.org' }).getByText('Alertas ativos (2 e-mails + administradores)').waitFor();
  // Reopen: the saved values come back; removing every recipient blocks saving; switching off clears the row indicator.
  await page.getByRole('button', { name: 'Alertas de novo.org' }).click();
  await alertsDialog.getByRole('list', { name: 'E-mails adicionados' }).waitFor();
  assert.equal(await alertsDialog.getByRole('list', { name: 'E-mails adicionados' }).getByRole('listitem').count(), 2);
  await alertsDialog.getByRole('button', { name: 'Remover ti@empresa.com' }).click();
  await alertsDialog.getByRole('button', { name: 'Remover outro@empresa.com' }).click();
  await alertsDialog.getByRole('checkbox', { name: /Notificar os administradores/ }).uncheck();
  assert.equal(await alertsDialog.getByRole('button', { name: 'Salvar' }).isDisabled(), true);
  await alertsDialog.getByRole('switch', { name: 'Alertas de vencimento' }).click();
  await alertsDialog.getByRole('button', { name: 'Salvar' }).click();
  await alertsDialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() => ![...document.querySelectorAll('[aria-label="Domínios"] > li')].some((li) => li.innerText.includes('Alertas ativos')));

  // An address typed but not added is kept when saving; an invalid one blocks saving and says why.
  await page.getByRole('button', { name: 'Alertas de extra00.com' }).click();
  const pendingDialog = page.getByRole('dialog', { name: 'Alertas — extra00.com' });
  await pendingDialog.getByRole('switch', { name: 'Alertas de vencimento' }).click();
  const pendingField = pendingDialog.getByLabel('E-mails para notificação');
  await pendingField.fill('digitado@empresa.com');
  assert.equal(await pendingDialog.getByRole('button', { name: 'Salvar' }).isDisabled(), false, 'a typed address counts as a recipient');
  await pendingDialog.getByRole('button', { name: 'Salvar' }).click();
  await pendingDialog.waitFor({ state: 'detached' });
  assert.deepEqual(state.calls.filter((c) => c.method === 'PUT' && c.api.endsWith('/alerts')).at(-1).body.emails, ['digitado@empresa.com']);
  await page.getByRole('button', { name: 'Alertas de extra01.com' }).click();
  const badDialog = page.getByRole('dialog', { name: 'Alertas — extra01.com' });
  await badDialog.getByRole('switch', { name: 'Alertas de vencimento' }).click();
  await badDialog.getByLabel('E-mails para notificação').fill('nao-e-email');
  await badDialog.getByRole('button', { name: 'Salvar' }).click();
  assert.match(await badDialog.getByRole('alert').first().innerText(), /e-mail válido/);
  assert.equal(await page.getByRole('dialog', { name: 'Alertas — extra01.com' }).count(), 1, 'the dialog stays open');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Descartar', exact: true }).click();
  await badDialog.waitFor({ state: 'detached' });

  // Interval setting.
  await page.getByRole('button', { name: 'Consultas automáticas' }).click();
  await page.getByLabel(/Intervalo entre consultas/).fill('14');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(state.interval, 14);

  // An account with a grant: read only. Sees just its domains, no administration control, and can still open details and look up.
  state.role = 'user'; state.userIds = [uid(2), uid(3)];
  await page.goto(`${origin}/__dm_fixture`);
  const userRows = page.getByRole('list', { name: 'Domínios' }).getByRole('listitem');
  await userRows.first().waitFor();
  assert.equal(await userRows.count(), 2, 'only the granted domains');
  assert.match(await page.getByText(/acesso somente leitura aos domínios liberados/).innerText(), /pode ver os detalhes e consultar/);
  for (const name of ['Adicionar domínios', 'Consultas automáticas']) assert.equal(await page.getByRole('button', { name }).count(), 0, `${name} is Super Admin only`);
  assert.equal(await page.getByRole('button', { name: /^Alertas de / }).count(), 0, 'no alert gear for an ordinary account');
  assert.equal(await page.getByRole('button', { name: /^Remover / }).count(), 0, 'no removal for an ordinary account');
  assert.equal(await page.getByText(/Alertas ativos/).count(), 0);
  await page.getByRole('button', { name: 'Consultar vencido.com agora' }).click();
  const userDialog = page.getByRole('dialog', { name: 'vencido.com' });
  await userDialog.waitFor();
  assert.match(await userDialog.innerText(), /Mudanças detectadas/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'vencido.com', exact: true }).click();
  await page.getByRole('dialog', { name: 'vencido.com' }).waitFor();
  await page.keyboard.press('Escape');
  state.userIds = [];
  await page.goto(`${origin}/__dm_fixture`);
  await page.getByText('Nenhum domínio foi liberado para a sua conta.').waitFor();

  assert.deepEqual(pageErrors, []);
  console.log('domain manager browser tests passed');
} finally {
  await browser?.close();
  await vite.close();
}
