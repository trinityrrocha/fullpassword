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
import {AuthContext} from '/src/context/AuthContext.jsx';
import '/src/index.css';
api.defaults.baseURL='/api';
createRoot(document.getElementById('root')).render(<AuthContext.Provider value={{registerVaultLockCleanup:()=>()=>{}}}><main className="p-4"><DomainManager/></main></AuthContext.Provider>);
`;
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, appType: 'custom', plugins: [{
  name: 'dm-isolated-fixture', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:dm-fixture') return '\0dm-fixture.jsx'; },
  load(id) { if (id === '\0dm-fixture.jsx') return fixture; },
  transform(code, id) {
    if (id === '\0dm-fixture.jsx') return transformWithOxc(code, 'dm-fixture.jsx');
    if (id.endsWith('/AuthContext.jsx')) return code + '\nexport { AuthContext };';
  },
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
const MAIL_FULL = {
  checked_at: '2026-11-26T15:00:00Z', name_exists: true,
  spf: { status: 'ok', record: 'v=spf1 -all', all: '-all', lookups: 0, void_lookups: 0, ip_count: 0, includes: [], errors: [], warnings: [], notes: [], as_of: '2026-11-26T15:00:00Z' },
  dmarc: { status: 'warning', record: 'v=DMARC1; p=none; rua=mailto:r@exemplo.com.br', policy: 'none', subdomain_policy: null, pct: 100, rua: ['r@exemplo.com.br'], ruf: [], adkim: 'r', aspf: 's', errors: [], warnings: ['DMARC_POLICY_NONE'], as_of: '2026-11-26T15:00:00Z' },
  dkim: { status: 'not_found', wildcard: false, tested: 15, found: [], warnings: [], notes: [], unreachable: 0, as_of: '2026-11-26T15:00:00Z' }
};
const MAIL_SUMMARY = { checked_at: '2026-11-26T15:00:00Z', name_exists: true, spf: { status: 'ok', all: '-all' }, dmarc: { status: 'warning', policy: 'none' }, dkim: { status: 'not_found', found: 0 } };
const MAIL_BAD = { checked_at: '2026-11-26T15:00:00Z', name_exists: true, spf: { status: 'fail', all: '+all' }, dmarc: { status: 'absent', policy: null }, dkim: { status: 'ok', found: 2 } };
const DEFAULT_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1'];
const state = {
  calls: [], sslOn: true, reportWarn: true, interval: 7, mailOn: true, mailDays: 7, selectors: [...DEFAULT_SELECTORS], servers: [], domainMail: {}, failMailSave: false, rateLimited: false, alerts: {}, role: 'super_admin', userIds: [],
  domains: [
    { id: uid(1), name: 'exemplo.com.br', source: 'manual', active: true, snapshot: snap(), mail: MAIL_SUMMARY },
    { id: uid(2), name: 'vencido.com', source: 'spfbl', active: true, snapshot: snap({ expires_on: '2026-11-20', days_left: -6, ssl: { state: 'expired', not_after: null, issuer: null, protocol: null, error: null } }), mail: MAIL_BAD },
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
      return json({ domains: all.slice((pageNo - 1) * size, pageNo * size).map(withAlerts), total: all.length, page: pageNo, size, role: 'super_admin', settings: { ssl_check_enabled: state.sslOn, dmarc_no_report_warning: state.reportWarn, check_interval_days: state.interval, mail_check_enabled: state.mailOn, mail_check_interval_days: state.mailDays, dkim_selectors: state.selectors, dns_servers: state.servers, default_dkim_selectors: DEFAULT_SELECTORS } });
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
      return json({ domain, changes: [{ field: 'expires_on', old_value: '2026-12-01', new_value: '2026-12-09', detected_at: '2026-11-26T15:00:00Z' }, { field: 'dmarc_policy', old_value: 'reject', new_value: 'none', detected_at: '2026-11-25T15:00:00Z' }], mail: domain.mail ? MAIL_FULL : null });
    }
    if (/^\/domain-manager\/domains\/[^/]+$/.test(api) && method === 'DELETE') { const id = api.split('/')[3]; state.domains = state.domains.filter((d) => d.id !== id); return json({ ok: true }); }
    if (/^\/domain-manager\/domains\/[^/]+$/.test(api)) { const domain = state.domains.find((d) => d.id === api.split('/')[3]); return json({ domain, changes: domain.mail ? [{ field: 'dmarc_policy', old_value: 'reject', new_value: 'none', detected_at: '2026-11-25T15:00:00Z' }] : [], mail: domain.mail ? MAIL_FULL : null }); }
    if (api === '/domain-manager/settings' && method === 'PUT') {
      state.sslOn = body.ssl_check_enabled; state.reportWarn = body.dmarc_no_report_warning; state.interval = body.check_interval_days; state.mailOn = body.mail_check_enabled; state.mailDays = body.mail_check_interval_days; state.selectors = body.dkim_selectors; state.servers = body.dns_servers;
      return json({ check_interval_days: state.interval });
    }
    if (/^\/domain-manager\/domains\/[^/]+\/mail-settings$/.test(api)) {
      const id = api.split('/')[3];
      if (method === 'PUT') { if (state.failMailSave) return json({ error: 'Falha simulada' }, 500); state.domainMail[id] = { enabled: body.enabled, extra_selectors: body.extra_selectors }; return json(state.domainMail[id]); }
      return json(state.domainMail[id] || { enabled: true, extra_selectors: [] });
    }
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
  assert.match(await rows.filter({ hasText: 'novo.org' }).innerText(), /Aguardando/);

  // Layout: single-line rows of 40px with aligned columns, a short search box beside the buttons, and sorting in the column headers.
  const box = await rows.first().boundingBox();
  assert.ok(Math.abs(box.height - 40) < 1, `rows are 40px high (got ${box.height})`);
  const xs = await rows.evaluateAll((items) => items.slice(0, 5).map((item) => [...item.children].map((child) => Math.round(child.getBoundingClientRect().left))));
  assert.ok(xs.every((row) => JSON.stringify(row) === JSON.stringify(xs[0])), 'every row starts its columns at the same x');
  assert.equal(await page.getByLabel('Ordenar por').count(), 0, 'the sort select is gone');
  assert.ok((await page.getByLabel('Buscar domínio').boundingBox()).width <= 200, 'the search box is short');
  assert.ok((await page.getByLabel('Buscar domínio').boundingBox()).height === 40, 'inputs are 40px high');
  await page.getByRole('button', { name: 'Vencimento', exact: true }).click();
  await page.waitForFunction(() => true);
  assert.ok(state.calls.some((c) => c.method === 'GET' && c.query.sort === 'expiry'), 'a column header sorts on the server');
  await page.getByRole('button', { name: 'Domínio', exact: true }).click();
  const tip = page.getByRole('tooltip');
  assert.match(await tip.textContent(), /consultados automaticamente por RDAP/, 'the description lives in the title tooltip');
  assert.equal(await page.locator('h1 + p').count(), 0, 'no description line under the title');

  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll on a phone');
  await page.setViewportSize({ width: 1280, height: 900 });

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
  await page.getByRole('button', { name: 'Configurações de novo.org' }).click();
  const alertsDialog = page.getByRole('dialog', { name: 'Configurações — novo.org' });
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
  await page.getByRole('button', { name: 'Configurações de novo.org' }).click();
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
  await page.getByRole('button', { name: 'Configurações de extra00.com' }).click();
  const pendingDialog = page.getByRole('dialog', { name: 'Configurações — extra00.com' });
  await pendingDialog.getByRole('switch', { name: 'Alertas de vencimento' }).click();
  const pendingField = pendingDialog.getByLabel('E-mails para notificação');
  await pendingField.fill('digitado@empresa.com');
  assert.equal(await pendingDialog.getByRole('button', { name: 'Salvar' }).isDisabled(), false, 'a typed address counts as a recipient');
  await pendingDialog.getByRole('button', { name: 'Salvar' }).click();
  await pendingDialog.waitFor({ state: 'detached' });
  assert.deepEqual(state.calls.filter((c) => c.method === 'PUT' && c.api.endsWith('/alerts')).at(-1).body.emails, ['digitado@empresa.com']);
  await page.getByRole('button', { name: 'Configurações de extra01.com' }).click();
  const badDialog = page.getByRole('dialog', { name: 'Configurações — extra01.com' });
  await badDialog.getByRole('switch', { name: 'Alertas de vencimento' }).click();
  await badDialog.getByLabel('E-mails para notificação').fill('nao-e-email');
  await badDialog.getByRole('button', { name: 'Salvar' }).click();
  assert.match(await badDialog.getByRole('alert').first().innerText(), /e-mail válido/);
  assert.equal(await page.getByRole('dialog', { name: 'Configurações — extra01.com' }).count(), 1, 'the dialog stays open');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Descartar', exact: true }).click();
  await badDialog.waitFor({ state: 'detached' });

  // E-mail checks: compact markers in the list (glyph AND words), full results in the details.
  const mailRow = (name) => page.getByRole('list', { name: 'Domínios' }).getByRole('listitem').filter({ hasText: name }).locator('[data-mail-cell]');
  const good = await mailRow('vencido.com').innerText();
  assert.match(good, /Falha/, 'the spoken status is part of the marker');
  assert.match(good, /SPF[\s\S]*\+all/); assert.match(good, /DMARC[\s\S]*ausente/); assert.match(good, /DKIM[\s\S]*2 seletores/);
  assert.equal(await mailRow('vencido.com').locator('span[title^="SPF"]').getAttribute('title'), 'SPF: Falha (+all)');
  assert.match(await mailRow('novo.org').innerText(), /SPF[\s\S]*não verificado/);
  await page.getByRole('button', { name: 'vencido.com', exact: true }).click();
  const mailDialog = page.getByRole('dialog', { name: 'vencido.com' });
  await mailDialog.getByRole('heading', { name: /E-mail \(SPF, DKIM e DMARC\)/ }).waitFor();
  const mailText = await mailDialog.innerText();
  assert.match(mailText, /v=spf1 -all/); assert.match(mailText, /0 de 10/); assert.match(mailText, /p=none só monitora/);
  assert.match(mailText, /Nenhum entre os seletores testados/); assert.match(mailText, /não prova que o domínio não usa DKIM/);
  assert.match(mailText, /Política DMARC[\s\S]*reject → none/, 'a DMARC change is listed with readable values');
  assert.match(mailText, /DKIM rígido|SPF rígido/, 'alignment is spelled out');
  await page.keyboard.press('Escape');

  // The settings card (icon in the header): e-mail parameters, validated before saving.
  await page.getByRole('button', { name: 'Configurações do Domain Manager' }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Configurações do Domain Manager' });
  await settingsDialog.waitFor();
  const mailSwitch = settingsDialog.getByRole('switch', { name: /Autenticação de e-mail/ });
  assert.equal(await mailSwitch.getAttribute('aria-checked'), 'true');
  await mailSwitch.click();
  assert.equal(await settingsDialog.getByLabel(/Seletores DKIM testados/).count(), 0, 'e-mail fields hide when the check is off');
  await mailSwitch.click();
  await settingsDialog.getByLabel(/Seletores DKIM testados/).fill('Default\nmeu$sel');
  await settingsDialog.getByRole('button', { name: 'Salvar' }).click();
  assert.match(await settingsDialog.getByRole('alert').innerText(), /Seletor inválido: "meu\$sel"/);
  await settingsDialog.getByLabel(/Seletores DKIM testados/).fill('Default\nmarketing\ndefault');
  await settingsDialog.getByRole('textbox', { name: /Servidores DNS/ }).fill('dns.google');
  await settingsDialog.getByRole('button', { name: 'Salvar' }).click();
  assert.match(await settingsDialog.getByRole('alert').innerText(), /Endereço IP inválido: "dns\.google"/);
  await settingsDialog.getByRole('textbox', { name: /Servidores DNS/ }).fill('10.0.0.9\n1.1.1.1');
  await settingsDialog.getByLabel(/Intervalo entre verificações/).fill('0');
  await settingsDialog.getByRole('button', { name: 'Salvar' }).click();
  assert.match(await settingsDialog.getByRole('alert').innerText(), /verificação de e-mail de 1 a 30 dias/);
  await settingsDialog.getByLabel(/Intervalo entre verificações/).fill('3');
  await settingsDialog.getByRole('button', { name: 'Restaurar a lista padrão' }).click();
  assert.equal(await settingsDialog.getByLabel(/Seletores DKIM testados/).inputValue(), DEFAULT_SELECTORS.join('\n'));
  await settingsDialog.getByLabel(/Seletores DKIM testados/).fill('Default\nmarketing\ndefault');
  await settingsDialog.getByRole('button', { name: 'Salvar' }).click();
  await settingsDialog.waitFor({ state: 'detached' });
  assert.deepEqual([state.mailOn, state.mailDays, state.selectors, state.servers], [true, 3, ['default', 'marketing'], ['10.0.0.9', '1.1.1.1']], 'selectors are lower-cased and de-duplicated, servers kept');

  // Turning the e-mail check off is never blocked by a draft in a field you cannot see; the saved values are kept.
  await page.getByRole('button', { name: 'Configurações do Domain Manager' }).click();
  const offDialog = page.getByRole('dialog', { name: 'Configurações do Domain Manager' });
  await offDialog.getByLabel(/Seletores DKIM testados/).fill('lixo$');
  await offDialog.getByRole('switch', { name: /Autenticação de e-mail/ }).click();
  assert.equal(await offDialog.getByRole('textbox', { name: /Servidores DNS/ }).count(), 1, 'the DNS servers stay visible: they serve every DNS check');
  await offDialog.getByRole('button', { name: 'Salvar' }).click();
  await offDialog.waitFor({ state: 'detached' });
  assert.deepEqual([state.mailOn, state.selectors, state.mailDays], [false, ['default', 'marketing'], 3], 'hidden, invalid drafts are neither blocking nor saved');
  await page.getByRole('button', { name: 'Configurações do Domain Manager' }).click();
  await offDialog.getByRole('switch', { name: /Autenticação de e-mail/ }).click();
  await offDialog.getByLabel(/Seletores DKIM testados/).fill('');
  await offDialog.getByRole('button', { name: 'Salvar' }).click();
  assert.match(await offDialog.getByRole('alert').innerText(), /ao menos um seletor/);
  await offDialog.getByLabel(/Seletores DKIM testados/).fill('default');
  await offDialog.getByRole('button', { name: 'Salvar' }).click();
  await offDialog.waitFor({ state: 'detached' });
  assert.deepEqual([state.mailOn, state.selectors], [true, ['default']]);

  // Per-domain card: e-mail check switch and extra selectors next to the alerts; a failed e-mail save is named.
  await page.getByRole('button', { name: 'Configurações de novo.org' }).click();
  const domainCard = page.getByRole('dialog', { name: 'Configurações — novo.org' });
  await domainCard.getByRole('switch', { name: /Verificar SPF, DKIM e DMARC deste domínio/ }).waitFor();
  assert.equal(await domainCard.getByRole('switch', { name: /Verificar SPF, DKIM e DMARC deste domínio/ }).getAttribute('aria-checked'), 'true');
  await domainCard.getByLabel(/Seletores DKIM extras/).fill('Marketing\nloja');
  await domainCard.getByRole('button', { name: 'Salvar' }).click();
  await domainCard.waitFor({ state: 'detached' });
  assert.deepEqual(state.domainMail[uid(3)], { enabled: true, extra_selectors: ['marketing', 'loja'] });
  await page.getByRole('button', { name: 'Configurações de novo.org' }).click();
  assert.equal(await domainCard.getByLabel(/Seletores DKIM extras/).inputValue(), 'marketing\nloja', 'the saved selectors come back');
  state.failMailSave = true;
  await domainCard.getByLabel(/Seletores DKIM extras/).fill('outro');
  const listCallsBefore = state.calls.filter((c) => c.method === 'GET' && c.api === '/domain-manager/domains').length;
  await domainCard.getByRole('button', { name: 'Salvar' }).click();
  assert.match(await domainCard.getByRole('alert').first().innerText(), /alertas foram salvos, mas a verificação de e-mail NÃO foi/);
  await page.waitForFunction((before) => true, listCallsBefore);
  assert.ok(state.calls.filter((c) => c.method === 'GET' && c.api === '/domain-manager/domains').length > listCallsBefore, 'the list is refreshed even when only the first half was saved');
  state.failMailSave = false;
  await domainCard.getByLabel(/Seletores DKIM extras/).fill('bad$name');
  await domainCard.getByRole('button', { name: 'Salvar' }).click();
  assert.match(await domainCard.getByRole('alert').first().innerText(), /Seletor inválido: "bad\$name"/);
  await domainCard.getByRole('switch', { name: /Verificar SPF, DKIM e DMARC deste domínio/ }).click();
  await domainCard.getByRole('button', { name: 'Salvar' }).click();
  await domainCard.waitFor({ state: 'detached' });
  assert.deepEqual(state.domainMail[uid(3)], { enabled: false, extra_selectors: ['marketing', 'loja'] }, 'with the check off the invalid draft is ignored and the saved selectors stay');

  // Two opt-outs in the settings card: certificate check and the DMARC report warning.
  await page.getByRole('button', { name: 'Configurações do Domain Manager' }).click();
  const optDialog = page.getByRole('dialog', { name: 'Configurações do Domain Manager' });
  const sslSwitch = optDialog.getByRole('switch', { name: /Verificar o vencimento do certificado SSL/ });
  const ruaSwitch = optDialog.getByRole('switch', { name: /Avisar quando o DMARC não pede relatórios/ });
  assert.deepEqual([await sslSwitch.getAttribute('aria-checked'), await ruaSwitch.getAttribute('aria-checked')], ['true', 'true']);
  await sslSwitch.click(); await ruaSwitch.click();
  await optDialog.getByRole('button', { name: 'Salvar' }).click();
  await optDialog.waitFor({ state: 'detached' });
  assert.deepEqual([state.sslOn, state.reportWarn], [false, false]);
  await page.getByText('SSL', { exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Configurações do Domain Manager' }).click();
  await optDialog.getByRole('switch', { name: /Verificar o vencimento do certificado SSL/ }).click();
  await optDialog.getByRole('switch', { name: /Avisar quando o DMARC não pede relatórios/ }).click();
  await optDialog.getByRole('button', { name: 'Salvar' }).click();
  await optDialog.waitFor({ state: 'detached' });
  assert.deepEqual([state.sslOn, state.reportWarn], [true, true]);

  // Record generator (DMARC and SPF): the default result is the strict DMARC, every choice changes the record.
  await page.getByRole('button', { name: 'Gerador de registros' }).click();
  const gen = page.getByRole('dialog', { name: 'Gerador de registros' });
  await gen.waitFor();
  const record = () => gen.locator('[data-generator-record]').innerText();
  assert.equal(await record(), 'v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s');
  await gen.getByText('Quarentena', { exact: true }).first().click();
  await gen.getByText('Relaxado', { exact: true }).first().click();
  assert.equal(await record(), 'v=DMARC1; p=quarantine; sp=reject; aspf=s');
  await gen.getByLabel(/Receber relatórios agregados/).fill('dmarc@exemplo.com.br');
  assert.equal(await record(), 'v=DMARC1; p=quarantine; sp=reject; aspf=s; rua=mailto:dmarc@exemplo.com.br');
  await gen.getByLabel(/Receber relatórios agregados/).fill('nao-e-email');
  assert.match(await gen.innerText(), /não é um e-mail válido/);
  await gen.getByRole('tab', { name: 'SPF' }).click();
  assert.equal(await record(), 'v=spf1 mx -all');
  await gen.getByLabel('Google Workspace').check();
  await gen.getByLabel(/Endereços IP/).fill('203.0.113.10, 2001:db8::/32');
  assert.equal(await record(), 'v=spf1 mx ip4:203.0.113.10 ip6:2001:db8::/32 include:_spf.google.com -all');
  await gen.getByText('Suspeito (~all)').click();
  assert.match(await gen.innerText(), /Recomendamos -all/);
  assert.match(await gen.innerText(), /Consultas DNS contadas: 2 de 10/);
  await page.keyboard.press('Escape'); await gen.waitFor({ state: 'detached' });

  // Interval setting.
  await page.getByRole('button', { name: 'Configurações do Domain Manager' }).click();
  await page.getByLabel(/Intervalo entre consultas \(dias\)/).fill('14');
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
  for (const name of ['Adicionar domínios', 'Configurações do Domain Manager']) assert.equal(await page.getByRole('button', { name }).count(), 0, `${name} is Super Admin only`);
  assert.equal(await page.getByRole('button', { name: /^Configurações de / }).count(), 0, 'no alert gear for an ordinary account');
  assert.equal(await page.getByRole('button', { name: /^Remover / }).count(), 0, 'no removal for an ordinary account');
  assert.equal(await page.getByText(/Alertas ativos/).count(), 0);
  assert.match(await userRows.filter({ hasText: 'vencido.com' }).locator('[data-mail-cell]').innerText(), /SPF[\s\S]*DKIM[\s\S]*DMARC/, 'a granted account reads the e-mail results of its domains');
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
