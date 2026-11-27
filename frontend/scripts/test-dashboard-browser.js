/* global process */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The real Dashboard page runs against the real api client (CSRF); only the network is simulated, on localhost.
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import Dashboard from '/src/pages/Dashboard.jsx';
import api from '/src/services/api.js';
import '/src/index.css';
api.defaults.baseURL='/api';
createRoot(document.getElementById('root')).render(<MemoryRouter><main className="p-4"><Dashboard/></main></MemoryRouter>);
`;
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, appType: 'custom', plugins: [{
  name: 'dashboard-isolated-fixture', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:dashboard-fixture') return '\0dashboard-fixture.jsx'; },
  load(id) { if (id === '\0dashboard-fixture.jsx') return fixture; },
  transform(code, id) { if (id === '\0dashboard-fixture.jsx') return transformWithOxc(code, 'dashboard-fixture.jsx'); },
  configureServer(server) {
    server.middlewares.use('/__dashboard_fixture', async (_req, res, next) => {
      try {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/__dashboard_fixture', '<html lang="pt-BR"><head><title>Dashboard — teste isolado</title></head><body><div id="root"></div><script type="module">import "virtual:dashboard-fixture";</script></body></html>'));
      } catch (error) { next(error); }
    });
  }
}] });

const IDS = ['domains_health', 'domain_expirations', 'security_alerts', 'unlock_requests', 'spam_senders', 'login_activity', 'recent_logins', 'last_backup'];
const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
const cards = () => ({
  domains_health: { available: true, data: { total: 10, expired: 1, expiring: 2, waiting: 0, ssl_problem: 1, healthy: 6, mail: { spf: { ok: 8, warning: 1, fail: 1 }, dkim: { ok: 6, not_found: 3, warning: 1 }, dmarc: { ok: 7, absent: 2 } } } },
  domain_expirations: { available: true, data: { items: [{ name: 'vencido.com.br', expires_on: '2026-11-20', days_left: -6 }, { name: 'logo.com', expires_on: '2026-12-06', days_left: 10 }, { name: 'meio.com', expires_on: '2026-12-16', days_left: 20 }, { name: 'longe.org', expires_on: '2027-11-20', days_left: 359 }] } },
  security_alerts: { available: true, data: { total: 3, window_days: 7, items: [{ id: 1, title: 'Login bloqueado', summary: 'Muitas tentativas do IP 203.0.113.7', created_at: iso(2), severity: 'warning', status_label: 'Bloqueado', target_url: '/settings?section=audit' }] } },
  unlock_requests: { available: true, data: { pending: 2, oldest_at: iso(72), items: [{ domain: 'a.com', sender: 'x@spam.example', requested_at: iso(72), reopened: false }, { domain: 'b.com', sender: 'y@spam.example', requested_at: iso(5), reopened: true }] } },
  spam_senders: { available: true, data: { window_days: 30, items: [{ sender_domain: 'spam.example', blocked: 40, targets: 3, first_at: iso(24 * 12), last_at: iso(1) }, { sender_domain: 'other.example', blocked: 10, targets: 1, first_at: iso(48), last_at: iso(2) }] } },
  login_activity: { available: true, data: { window_hours: 24, failed: 7, failed_ips: 3, success: 12, auto_blocks: 1, active_blocks: 2 } },
  recent_logins: { available: true, data: { items: [{ user_email: 'ana@empresa.com.br', ip_address: '198.51.100.4', created_at: iso(1) }, { user_email: 'bruno@empresa.com.br', ip_address: '198.51.100.9', created_at: iso(30) }] } },
  last_backup: { available: true, data: { last_success: { provider: 'google_drive', status: 'success', trigger: 'scheduled', size_bytes: 5 * 1024 * 1024, at: iso(5) }, last_run: { provider: 'ftp', status: 'failed', trigger: 'scheduled', size_bytes: null, at: iso(1) } } }
});
const state = { calls: [], layout: { order: IDS, hidden: [] }, cards: cards(), fail: false, saveFails: false };

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
    state.calls.push({ method, api, body });
    if (method !== 'GET') assert.equal(request.headers()['x-csrf-token'], 'SYNTHETIC_CSRF', `${method} ${api} carries the CSRF token`);
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (api === '/dashboard' && method === 'GET') return state.fail ? json({ error: 'falha simulada' }, 500) : json({ generated_at: new Date().toISOString(), layout: state.layout, cards: state.cards });
    if (api === '/dashboard/layout' && method === 'PUT') {
      if (state.saveFails) return json({ error: 'falha simulada' }, 500);
      state.layout = { order: [...body.order, ...IDS.filter((id) => !body.order.includes(id))], hidden: body.hidden }; return json({ layout: state.layout });
    }
    if (api === '/dashboard/layout' && method === 'DELETE') { state.layout = { order: IDS, hidden: [] }; return json({ layout: state.layout }); }
    return json({ error: `unexpected ${method} ${api}` }, 404);
  });

  await page.goto(`${origin}/__dashboard_fixture`);
  const cardEls = page.locator('[data-dashboard-card]');
  await cardEls.first().waitFor();
  const order = () => cardEls.evaluateAll((items) => items.map((item) => item.dataset.dashboardCard));
  assert.deepEqual(await order(), IDS, 'every card, in the default order');
  const text = (id) => page.locator(`[data-dashboard-card="${id}"]`).innerText();

  // The cards say things in words, not only in colours.
  assert.match(await text('domains_health'), /60%/); assert.match(await text('domains_health'), /6 de 10 domínios estão saudáveis/); assert.match(await text('domains_health'), /Vencidos/);
  const expirations = page.locator('[data-dashboard-card="domain_expirations"]');
  assert.deepEqual((await expirations.locator('div.uppercase > span').allTextContents()), ['Domínio', 'Vencimento', 'Restam'], 'the card has column titles');
  assert.match(await text('domain_expirations'), /06\/12\/26/);
  assert.equal(await expirations.locator('[aria-label="venceu há 6 dias"]').innerText(), '-6', 'the days column is only the number');
  assert.equal(await expirations.locator('[aria-label="faltam 10 dias"]').innerText(), '10');
  assert.equal(await expirations.getByText(/dias/).count(), 0, 'no words in the days column');
  assert.equal(await expirations.locator('.ring-1').count(), 0, 'the days are plain numbers, not badges');
  const tone = (label) => expirations.locator(`[aria-label="${label}"]`).getAttribute('class');
  assert.match(await tone('venceu há 6 dias'), /text-red-/); assert.match(await tone('faltam 10 dias'), /text-red-/, 'below 15 days is red');
  assert.match(await tone('faltam 20 dias'), /text-orange-/, 'up to 30 days is orange'); assert.match(await tone('faltam 359 dias'), /text-emerald-/, 'beyond is green');
  const barRadius = await page.locator('[data-dashboard-card="domains_health"] svg').last().evaluate((node) => parseFloat(getComputedStyle(node.parentElement).borderTopLeftRadius));
  assert.ok(barRadius > 0 && barRadius <= 4, `the health bars are rectangles with slightly rounded corners (${barRadius}px)`);
  const cardColor = await page.locator('[data-dashboard-card="domains_health"]').evaluate((node) => getComputedStyle(node).backgroundColor);
  assert.match(cardColor, /rgba\(.*, 0\.\d+\)|oklab|color\(/, 'the cards are translucent');
  const columns = await expirations.locator('li').evaluateAll((items) => items.map((item) => [...item.children].map((child) => Math.round(child.getBoundingClientRect().left))));
  assert.ok(columns.every((row) => JSON.stringify(row) === JSON.stringify(columns[0])), 'every row aligns its columns');
  assert.match(await text('security_alerts'), /3 ocorrências nos últimos 7 dias/); assert.match(await text('security_alerts'), /Login bloqueado/);
  assert.match(await text('unlock_requests'), /2 solicitações aguardando/); assert.match(await text('unlock_requests'), /reaberta/); assert.match(await text('unlock_requests'), /a mais antiga: há 3 dias/);
  assert.match(await text('spam_senders'), /spam\.example[\s\S]*40 bloqueios/); assert.match(await text('spam_senders'), /há 12 dias · 3 domínios/); assert.match(await text('spam_senders'), /não informa o país/);
  assert.match(await text('login_activity'), /Falhas de login \(24 h\)/); assert.match(await text('login_activity'), /Bloqueios ativos/);
  assert.match(await text('recent_logins'), /ana@empresa\.com\.br[\s\S]*198\.51\.100\.4[\s\S]*há 1 h/);
  assert.match(await text('last_backup'), /há 5 h/); assert.match(await text('last_backup'), /Google Drive/); assert.match(await text('last_backup'), /5,0 MB/); assert.match(await text('last_backup'), /A última tentativa \(FTP, há 1 h\) falhou/);
  assert.equal(await page.locator('h1 + p').count(), 0, 'no description under the title: it is the tooltip');

  // Phone width: one column, no horizontal scroll. Wide: three columns.
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[aria-label="Cartões do dashboard"]')).gridTemplateColumns.split(' ').length), 3);
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll on a phone');
  await page.setViewportSize({ width: 1280, height: 900 });

  // Drag and drop: the card moves, the layout is saved once with the final order.
  const putsBefore = state.calls.filter((c) => c.method === 'PUT').length;
  await page.locator('[data-dashboard-card="last_backup"] [draggable="true"]').dragTo(page.locator('[data-dashboard-card="domains_health"]'));
  assert.deepEqual((await order()).slice(0, 2), ['last_backup', 'domains_health']);
  await page.waitForFunction(() => true); await page.waitForTimeout(900);
  const puts = state.calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length - putsBefore, 1, 'one save for the drag');
  assert.deepEqual(puts.at(-1).body.order.slice(0, 2), ['last_backup', 'domains_health']);

  // Keyboard: arrows on the handle move the card and announce it.
  const handle = page.getByRole('button', { name: /^Mover Alertas de segurança/ });
  await handle.focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  assert.deepEqual((await order()).slice(0, 3), ['last_backup', 'security_alerts', 'domains_health']);
  assert.match(await page.getByRole('status').filter({ hasText: 'movido para a posição' }).innerText(), /Alertas de segurança movido para a posição 2 de 8/);
  assert.equal(await handle.evaluate((node) => node === document.activeElement), true, 'focus stays on the handle');
  await page.waitForTimeout(900);
  assert.deepEqual(state.calls.filter((c) => c.method === 'PUT').at(-1).body.order.slice(0, 3), ['last_backup', 'security_alerts', 'domains_health']);

  // The settings dialog: hide cards, reorder with the arrows, save; reset restores the default and calls DELETE.
  await page.getByRole('button', { name: 'Configurar dashboard' }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurar dashboard' });
  await dialog.waitFor();
  await dialog.getByRole('checkbox', { name: /Remetentes mais bloqueados/ }).uncheck();
  await dialog.getByRole('checkbox', { name: /Último backup/ }).uncheck();
  await dialog.getByRole('button', { name: 'Mover Logins e bloqueios para cima' }).click();
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await dialog.waitFor({ state: 'detached' });
  const saved = state.calls.filter((c) => c.method === 'PUT').at(-1).body;
  assert.deepEqual(saved.hidden.sort(), ['last_backup', 'spam_senders']);
  assert.equal(await cardEls.count(), 6);
  assert.equal(await page.locator('[data-dashboard-card="spam_senders"]').count(), 0, 'a hidden card is not drawn');
  await page.reload(); await cardEls.first().waitFor();
  assert.equal(await cardEls.count(), 6, 'the saved layout survives a reload');
  await page.getByRole('button', { name: 'Configurar dashboard' }).click();
  await dialog.getByRole('button', { name: 'Restaurar padrão' }).click();
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.ok(state.calls.some((c) => c.method === 'DELETE' && c.api === '/dashboard/layout'), 'the default layout is restored with DELETE');
  assert.deepEqual(await order(), IDS);

  // All hidden: an explanation, not a blank page.
  state.layout = { order: IDS, hidden: IDS }; await page.reload();
  await page.getByText('Nenhum cartão visível').waitFor();
  state.layout = { order: IDS, hidden: [] };

  // A module that is off, and a card that failed, say so and leave the others alone.
  state.cards = { ...cards(), domains_health: { available: false }, spam_senders: { available: true, error: true } };
  await page.reload(); await cardEls.first().waitFor();
  assert.match(await text('domains_health'), /Ative o módulo Domain Manager/);
  assert.match(await text('spam_senders'), /Não foi possível carregar este cartão/);
  assert.match(await text('last_backup'), /há 5 h/);
  state.cards = cards();

  // A failed save is announced and the page keeps working.
  state.saveFails = true;
  await page.locator('[data-dashboard-card="login_activity"] [draggable="true"]').dragTo(page.locator('[data-dashboard-card="domains_health"]'));
  await page.getByText(/Não foi possível salvar a nova ordem/).waitFor();
  state.saveFails = false;

  // Whole-page failure.
  state.fail = true; await page.reload();
  assert.match(await page.getByRole('alert').innerText(), /falha simulada/);
  state.fail = false;
  assert.deepEqual(pageErrors, []);
  console.log('dashboard browser tests passed');
} finally {
  await browser?.close();
  await vite.close();
}
