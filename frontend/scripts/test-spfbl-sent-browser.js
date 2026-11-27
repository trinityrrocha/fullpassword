/* global process */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The real history sub-tabs run against the real api client (CSRF); only the network is simulated, on localhost. All data is invented.
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import SpfblHistoryTabs from '/src/components/spfbl/SpfblHistoryTabs.jsx';
import api from '/src/services/api.js';
import '/src/index.css';
api.defaults.baseURL='/api';
createRoot(document.getElementById('root')).render(<main className="p-4"><SpfblHistoryTabs/></main>);
`;
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, appType: 'custom', plugins: [{
  name: 'sent-isolated-fixture', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:sent-fixture') return '\0sent-fixture.jsx'; },
  load(id) { if (id === '\0sent-fixture.jsx') return fixture; },
  transform(code, id) { if (id === '\0sent-fixture.jsx') return transformWithOxc(code, 'sent-fixture.jsx'); },
  configureServer(server) {
    server.middlewares.use('/__sent_fixture', async (_req, res, next) => {
      try {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/__sent_fixture', '<html lang="pt-BR"><head><title>Enviados — teste isolado</title></head><body><div id="root"></div><script type="module">import "virtual:sent-fixture";</script></body></html>'));
      } catch (error) { next(error); }
    });
  }
}] });

const at = (iso) => iso;
const row = (n, extra = {}) => ({
  id: `m${n}|r${n}|1|success`, type: 'success', event: 'Entrega', sent_at: at(`2026-11-27T12:${String(n).padStart(2, "0")}:05Z`), sent_unix: 1795000000 + n, sender: `ana${n}@exemplo.test`, recipient: `cliente${n}@destino.example`, delivered_to: `cliente${n}@destino.example`,
  result: { key: 'sent', label: 'Enviado', tone: 'ok', code: null },
  detail: { type: 'success', msgid: `1aaa-${n}`, message: 'Accepted', email: `ana${n}@exemplo.test`, sender: `ana${n}@exemplo.test`, domain: 'exemplo.test', user: 'exemplo01', senderauth: 'dovecot_plain', senderip: '198.51.100.7', recipient: `cliente${n}@destino.example`, deliveredto: `cliente${n}@destino.example`, host: 'mx.destino.example', ip: '203.0.113.10', sendunixtime: '1795000000', actionunixtime: '1795000002', router: 'dkim_lookuphost', transport: 'dkim_remote_smtp', transport_is_remote: '1', size: '17039' },
  ...extra
});
const state = {
  calls: [], partial: false, failedServers: [], diagnostics: null, fail: null, scope: ['exemplo.test', 'outro.test'], truncated: false,
  rows: [
    row(1),
    row(2, { type: 'failure', event: 'Falha na entrega', result: { key: 'mailbox_full', label: 'Caixa cheia', tone: 'danger', code: '552 5.2.2' }, detail: { ...row(2).detail, type: 'failure', message: '552 5.2.2 Mailbox full' } }),
    row(3, { type: 'defer', event: 'Tentativa adiada', result: { key: 'unreachable', label: 'Adiado: servidor de destino sem resposta', tone: 'warning', code: null }, detail: { ...row(3).detail, type: 'defer', message: 'Connection timed out' } }),
    ...Array.from({ length: 27 }, (_, i) => row(10 + i))
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
    const api = url.pathname.slice(4); const query = Object.fromEntries(url.searchParams);
    state.calls.push({ method: request.method(), api, query });
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (api === '/spfbl/history') return json({ domain: 'exemplo.test', domains_scope: state.scope, filters: { status: 'Bloqueados', by: 'sender', email: '', start: '2026-11-21', end: '2026-11-27' }, rows: [], period_total: 0, filtered_total: 0, page: 1, pages: 1, page_size: 20, domain_no_server: false, state: { loading: false, partial: false } });
    if (api === '/spfbl/sent') {
      if (state.fail) return json(state.fail.body, state.fail.status);
      if (state.scope.length === 0) return json({ domain: null, domains_scope: [], rows: [], filtered_total: 0, period_total: 0, page: 1, pages: 1, page_size: 20, filters: {}, truncated: false });
      const size = Number(query.page_size || 20); const pageNo = Number(query.page || 1);
      let rows = state.rows;
      if (query.status === 'failed') rows = rows.filter((r) => r.type === 'failure');
      if (query.q) rows = rows.filter((r) => r.sender.includes(query.q) || r.recipient.includes(query.q));
      return json({ domain: query.domain || 'all', domains_scope: state.scope, servers_failed: state.failedServers.length, partial: state.partial, ...(state.failedServers.length ? { servers_failed_names: state.failedServers } : {}), filters: { period: query.period || '24h', status: query.status || 'all', by: query.by || 'any', q: query.q || '' },
        rows: rows.slice((pageNo - 1) * size, pageNo * size), filtered_total: rows.length, period_total: state.rows.length, page: pageNo, pages: Math.max(1, Math.ceil(rows.length / size)), page_size: size, truncated: state.truncated, fetched_at: '2026-11-27T12:10:00Z', cached: false, ...(state.diagnostics ? { diagnostics: state.diagnostics } : {}) });
    }
    return json({ error: `unexpected ${api}` }, 404);
  });

  await page.goto(`${origin}/__sent_fixture`);
  const tabs = page.getByRole('tablist', { name: 'Tipo de histórico' });
  await tabs.waitFor();
  assert.equal(await tabs.getByRole('tab', { name: 'Recebidos' }).getAttribute('aria-selected'), 'true', 'Recebidos is the first sub-tab and the current page');
  await page.getByRole('form', { name: 'Filtros do histórico' }).waitFor();
  assert.equal(state.calls.filter((c) => c.api === '/spfbl/sent').length, 0, 'nothing is asked of the WHM until Enviados is opened');

  // Sub-tab by click.
  await tabs.getByRole('tab', { name: 'Enviados' }).click();
  await page.getByRole('form', { name: 'Filtros dos e-mails enviados' }).waitFor();
  const table = page.getByRole('table', { name: 'E-mails enviados por todos os domínios' });
  assert.equal(await page.getByRole('combobox', { name: 'Domínio', exact: true }).inputValue(), 'all', 'all domains is the default');
  assert.deepEqual(await page.getByRole('combobox', { name: 'Domínio', exact: true }).locator('option').allTextContents(), ['Todos os domínios', 'exemplo.test', 'outro.test']);
  await table.waitFor();
  assert.deepEqual(await table.locator('thead th').evaluateAll((items) => items.map((item) => item.textContent.trim())), ['Evento', 'Remetente', 'Destinatário', 'Data', 'Hora', 'Resultado', 'Ações']);
  assert.equal(await table.locator('tbody tr').count(), 20, 'first page holds 20 rows');
  const first = table.locator('tbody tr').first();
  assert.match(await first.innerText(), /Entrega/); assert.match(await first.innerText(), /ana1@exemplo\.test/); assert.match(await first.innerText(), /cliente1@destino\.example/);
  assert.match(await first.locator('td').nth(3).innerText(), /^\d{2}\/\d{2}\/\d{2}$/, 'Data is dd/mm/aa'); assert.match(await first.locator('td').nth(4).innerText(), /^\d{2}:\d{2}:\d{2}$/, 'Hora is HH:mm:ss');
  assert.equal(await first.locator('td').nth(5).innerText(), 'Enviado');
  assert.equal(await table.getByText('Caixa cheia', { exact: true }).count(), 1);
  assert.equal(await table.getByText('Adiado: servidor de destino sem resposta').count(), 1);
  assert.match(await page.getByText(/registros com os filtros/).innerText(), /30 registros com os filtros · 30 do domínio no período/);
  const lastSentCall = () => state.calls.filter((c) => c.api === '/spfbl/sent').at(-1).query;
  assert.deepEqual([lastSentCall().page, lastSentCall().page_size], ['1', '20']);

  // Details: every field of the log, in groups.
  await table.getByRole('row').filter({ hasText: 'Caixa cheia' }).getByRole('button', { name: /Detalhes/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Detalhes do envio' });
  await dialog.waitFor();
  const text = (await dialog.innerText()).toLowerCase();
  for (const expected of ['Mensagem', 'Remetente', 'Destinatário', 'Entrega', 'Identificador', '1aaa-2', 'Resposta do servidor', '552 5.2.2 Mailbox full', 'Falha', 'ana2@exemplo.test', 'Conta cPanel', 'exemplo01', 'IP de origem', '198.51.100.7', 'Servidor que recebeu', 'mx.destino.example', 'Tamanho', '16,6 KB', 'Entrega remota', 'Sim']) {
    assert.ok(text.includes(expected.toLowerCase()), `details show "${expected}"`);
  }
  assert.match(text, /enviado em\s*\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });

  // Filters are sent to the server.
  await page.getByRole('combobox', { name: 'Resultado', exact: true }).selectOption('failed');
  await page.getByRole('combobox', { name: 'Período', exact: true }).selectOption('7d');
  await page.getByRole('combobox', { name: 'Pesquisar por', exact: true }).selectOption('sender');
  await page.getByRole('searchbox', { name: 'Texto' }).fill('ana2');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  assert.deepEqual([lastSentCall().status, lastSentCall().period, lastSentCall().by, lastSentCall().q, lastSentCall().domain, lastSentCall().page], ['failed', '7d', 'sender', 'ana2', 'all', '1']);
  await page.getByRole('button', { name: 'Limpar' }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 20);
  assert.equal(lastSentCall().status, undefined, 'cleared filters are not sent');
  await page.getByRole('combobox', { name: 'Domínio', exact: true }).selectOption('outro.test'); await page.getByRole('button', { name: 'Consultar' }).click();
  await page.waitForFunction(() => document.querySelector('caption')?.textContent.includes('outro.test') || true);
  assert.equal(lastSentCall().domain, 'outro.test', 'the domain is part of the query (the server checks the scope)');
  await page.getByRole('combobox', { name: 'Domínio', exact: true }).selectOption('exemplo.test'); await page.getByRole('button', { name: 'Consultar' }).click();

  // Pagination 20/40/100.
  await page.getByRole('button', { name: 'Próxima' }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 10);
  await page.getByLabel('Paginação dos e-mails enviados: resultados por página').selectOption('40');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 30);

  // The Super Admin sees why records may be missing (counts only); other accounts never get the line.
  assert.equal(await page.locator('[data-sent-diagnostics]').count(), 0, 'no diagnostics for an ordinary account');
  state.diagnostics = { returned: { success: 10, defer: 2, failure: 3, rejected: 4 }, other_type: 4, other_domain: 7, out_of_period: 1, calls: [{ kind: 'delivered', chunks: 1, records: 353, ms: 820, error: null }, { kind: 'problems', chunks: 0, records: 0, ms: 20000, error: 'WHM_TIMEOUT' }], sources: { 'a.test': 5, 'b.test': 9 } };
  await page.getByRole('button', { name: 'Atualizar' }).click();
  const diagnostics = page.locator('[data-sent-diagnostics]');
  await diagnostics.waitFor();
  assert.match(await diagnostics.innerText(), /o WHM devolveu 10 entregues, 2 adiados, 3 falhas e 4 recusados na chegada\. Ficaram de fora 7 de outros domínios, 1 fora do período e 4 que não são envios\./);
  assert.match(await page.locator('[data-sent-calls]').innerText(), /Consultas ao WHM: entregues: 353 registros em 1 parte, 820 ms · adiados e falhas: 0 registros em 0 partes, 20\.000 ms \(erro WHM_TIMEOUT\)\./);
  assert.match(await page.locator('[data-sent-sources]').innerText(), /Domínios no retorno: b\.test \(9\), a\.test \(5\)\./, 'the busiest domains come first');
  state.partial = true; await page.getByRole('button', { name: 'Atualizar' }).click();
  assert.match(await page.locator('[data-sent-partial]').innerText(), /Uma das consultas ao WHM falhou/);
  state.partial = false;
  state.diagnostics = null; await page.getByRole('button', { name: 'Atualizar' }).click(); await diagnostics.waitFor({ state: 'detached' });

  // A WHM server that did not answer is named for the Super Admin, so a missing domain is explained.
  state.failedServers = [{ name: 'Servidor B', code: 'WHM_TIMEOUT' }];
  await page.getByRole('button', { name: 'Atualizar' }).click();
  const failedNote = page.locator('[data-sent-servers-failed]');
  await failedNote.waitFor();
  assert.match(await failedNote.innerText(), /1 servidor WHM não respondeu: os e-mails dele não aparecem nesta lista\. Servidor: Servidor B \(WHM_TIMEOUT\)\./);
  state.failedServers = []; await page.getByRole('button', { name: 'Atualizar' }).click(); await failedNote.waitFor({ state: 'detached' });

  // The truncation notice, an error from the server and an empty scope are each said plainly.
  state.truncated = true; await page.getByRole('button', { name: 'Atualizar' }).click();
  await page.getByText(/O servidor devolveu o limite de registros/).waitFor();
  state.truncated = false;
  state.fail = { status: 409, body: { code: 'SPFBL_SENT_NO_SERVER', error: 'Este domínio está sem servidor WHM cadastrado: não há como consultar os e-mails enviados.' } };
  await page.getByRole('button', { name: 'Consultar' }).click();
  assert.match(await page.getByRole('alert').innerText(), /sem servidor WHM cadastrado/);
  state.fail = null;

  // Keyboard on the sub-tabs, and the other view still works.
  await tabs.getByRole('tab', { name: 'Enviados' }).focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await tabs.getByRole('tab', { name: 'Recebidos' }).getAttribute('aria-selected'), 'true');
  await page.getByRole('form', { name: 'Filtros do histórico' }).waitFor();
  await page.keyboard.press('ArrowRight');
  assert.equal(await tabs.getByRole('tab', { name: 'Enviados' }).getAttribute('aria-selected'), 'true');

  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal page scroll on a phone: the table scrolls inside its box');
  await page.setViewportSize({ width: 1280, height: 900 });

  state.scope = []; await tabs.getByRole('tab', { name: 'Recebidos' }).click(); await tabs.getByRole('tab', { name: 'Enviados' }).click();
  await page.getByText('Nenhum domínio ativo liberado para você ainda.').waitFor();
  assert.deepEqual(pageErrors, []);
  console.log('spfbl sent browser tests passed');
} finally {
  await browser?.close();
  await vite.close();
}
