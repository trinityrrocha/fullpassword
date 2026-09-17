/* global process */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import DashboardLayout from '/src/layouts/DashboardLayout.jsx';
import { AuthContext } from '/src/context/AuthContext.jsx';
import { ThemeProvider } from '/src/context/ThemeContext.jsx';
import ActiveSessionsCard from '/src/components/ActiveSessionsCard.jsx';
import api from '/src/services/api.js';
import '/src/index.css';
api.defaults.baseURL = '/api';
function Fixture() {
  const [user, setUser] = useState(null);
  window.selectTestUser = async id => setUser((await api.get('/auth/me', { params: { test_user: id } })).data.user);
  window.setTestPreferences = values => setUser(current => ({ ...current, ...values }));
  useEffect(() => { api.get('/auth/me').then(({data}) => setUser(data.user)); }, []);
  if (!user) return null;
  return <AuthContext.Provider value={{ user, registerVaultLockCleanup: () => () => {}, logout: async () => { window.loggedOut = true; } }}>
    <ThemeProvider><MemoryRouter><Routes><Route element={<DashboardLayout />}><Route path="*" element={<div><h1>Conteúdo de teste</h1>{location.search.includes('admin') && <ActiveSessionsCard allUsers />}</div>} /></Route></Routes></MemoryRouter></ThemeProvider>
  </AuthContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, appType: 'custom', plugins: [{
  name: 'profile-navigation-fixture', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:profile-fixture') return '\0profile-fixture.jsx'; },
  load(id) { if (id === '\0profile-fixture.jsx') return fixture; },
  transform(code, id) {
    if (id === '\0profile-fixture.jsx') return transformWithOxc(code, 'profile-fixture.jsx');
    if (id.endsWith('/AuthContext.jsx')) return code + '\nexport { AuthContext };';
  },
  configureServer(server) { server.middlewares.use('/__profile_flows', async (_req, res, next) => {
    try { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__profile_flows', '<html><body><div id="root"></div><script type="module">import "virtual:profile-fixture";</script></body></html>')); } catch (error) { next(error); }
  }); }
}] });
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const users = {
    a: { id: 'a', name: 'Pessoa A', email: 'a@example.com', role: 'admin', is_super_admin: true, public_key: 'fixture', encrypted_private_key: 'fixture', menu_position: 'side', menu_display: 'icons' },
    b: { id: 'b', name: 'Pessoa B', email: 'b@example.com', role: 'user', public_key: 'fixture', encrypted_private_key: 'fixture', menu_position: 'top', menu_display: 'labels' }
  };
  let currentUser = 'a';
  let sessionIds = Array.from({ length: 45 }, (_, i) => i + 1);
  const requests = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const endpoint = url.pathname.slice(4);
    requests.push({ endpoint, method: request.method(), params: Object.fromEntries(url.searchParams) });
    let data = {};
    if (endpoint === '/auth/me') { currentUser = url.searchParams.get('test_user') || currentUser; data = { user: users[currentUser] }; }
    else if (endpoint === '/system/screen-protection') data = { enabled: false };
    else if (endpoint === '/system/security-notifications') data = { unread_count: 0, items: [] };
    else if (endpoint === '/users/profile/mfa') data = { mfa_enabled: false };
    else if (endpoint === '/users/profile' && request.method() === 'PUT') {
      const body = request.postDataJSON(); assert.equal(body.current_password, '');
      assert.ok(['side', 'top'].includes(body.menu_position)); assert.ok(['labels', 'icons'].includes(body.menu_display));
      Object.assign(users[currentUser], { menu_position: body.menu_position, menu_display: body.menu_display }); data = { user: users[currentUser], session_invalidated: false };
    } else if (endpoint.startsWith('/auth/sessions') && request.method() === 'DELETE') {
      if (endpoint === '/auth/sessions') sessionIds = sessionIds.filter(id => id === 1);
      else { const id = Number(endpoint.split('/').at(-1)); sessionIds = sessionIds.filter(value => value !== id); data = { current_session_revoked: id === 1 }; }
    } else if (endpoint === '/auth/sessions' || endpoint === '/system/sessions') {
      const admin = endpoint.startsWith('/system');
      assert.equal(url.searchParams.get('limit'), admin ? null : '5');
      const total = admin ? 80 : Math.min(30, sessionIds.length);
      const limit = admin ? 10 : 5;
      const totalPages = Math.ceil(total / limit);
      const currentPage = Math.min(Number(url.searchParams.get('page')), Math.max(1, totalPages));
      const ids = admin ? Array.from({ length: 80 }, (_, i) => i + 1) : sessionIds;
      data = { sessions: ids.slice((currentPage - 1) * limit, currentPage * limit).map(id => ({ id: String(id), status: 'active', is_current: id === 1, ip_address: '192.168.1.' + id, last_seen_at: new Date(Date.now() - id * 60000).toISOString(), browser: 'Fixture browser', device: 'Desktop' })), pagination: { page: currentPage, limit, total, total_pages: totalPages } };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const url = `http://127.0.0.1:${vite.httpServer.address().port}/__profile_flows`;
  await page.goto(url);
  const nav = page.locator('[data-desktop-navigation]');
  await nav.waitFor();
  await page.evaluate(() => window.selectTestUser('b'));
  await page.locator('[data-desktop-navigation="top/labels"]').waitFor();
  await page.evaluate(() => window.selectTestUser('a'));
  await page.locator('[data-desktop-navigation="side/icons"]').waitFor();
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => /menu_position|menu_display/.test(key))), false);
  const checkPage = async (number, total) => { await page.getByText(`Página ${number} de ${total}`, { exact: true }).waitFor(); assert.ok(await page.locator('[data-profile-panel] tbody tr').count() <= 5); };
  const openProfile = async () => { await page.getByRole('button', { name: 'Meu Perfil', exact: true }).click(); await page.locator('[data-profile-panel] tbody tr').first().waitFor(); };
  const closeProfile = async () => page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  for (const [width, height] of [[1920,1080],[1366,768],[1280,720],[1024,768],[390,844]]) {
    await page.setViewportSize({ width, height });
    for (const menu_position of ['side', 'top']) for (const menu_display of ['labels', 'icons']) {
      await page.evaluate(value => window.setTestPreferences(value), { menu_position, menu_display });
      await page.waitForFunction(value => document.querySelector('[data-desktop-navigation]')?.dataset.desktopNavigation === value, `${menu_position}/${menu_display}`);
      for (const dark of [false, true]) {
        const theme = page.getByRole('button', { name: dark ? 'Ativar tema escuro' : 'Ativar tema claro' });
        if (await theme.first().isVisible()) await theme.first().click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (width < 768) {
          assert.equal(await nav.isVisible(), false);
          await page.getByRole('button', { name: 'Abrir menu' }).click();
          assert.equal(await page.getByRole('link', { name: 'Gestão de Equipe' }).last().isVisible(), true);
          await page.getByRole('button', { name: 'Fechar menu' }).click();
          continue;
        }
        const main = await page.locator('main').boundingBox();
        assert.equal(main.x, menu_position === 'top' ? 0 : menu_display === 'icons' ? 80 : 256);
        const links = nav.getByRole('navigation').getByRole('link');
        assert.equal(await links.count(), 3);
        assert.equal(await links.first().locator('svg').count(), menu_display === 'icons' ? 1 : 0);
        assert.equal(await links.first().getAttribute('aria-current'), 'page');
        assert.equal(await links.first().getAttribute('title'), 'Clientes / Cofre');
        assert.equal(await page.getByRole('button', { name: /Notifica/ }).filter({ visible: true }).count(), 1);
        if (menu_display === 'icons') { await links.first().focus(); assert.equal(await links.first().locator('span').last().evaluate(el => getComputedStyle(el).opacity), '1'); }
        if (process.env.PROFILE_SCREENSHOT_DIR && width === 1280) await page.screenshot({ path: path.join(process.env.PROFILE_SCREENSHOT_DIR, `${menu_position}-${menu_display}-${dark}.png`) });
        await openProfile();
        assert.equal(await page.locator(`input[name="menu_position"][value="${menu_position}"]`).isChecked(), true);
        assert.equal(await page.locator(`input[name="menu_display"][value="${menu_display}"]`).isChecked(), true);
        await checkPage(1, 6);
        const panel = await page.locator('[data-profile-panel]').boundingBox(); assert.ok(panel.height <= height - 32);
        await page.getByRole('button', { name: 'Salvar Alterações' }).scrollIntoViewIfNeeded();
        assert.equal(await page.getByRole('button', { name: 'Salvar Alterações' }).isVisible(), true);
        await closeProfile();
      }
    }
  }
  for (const count of [5, 30]) for (const width of [1024, 390]) for (const dark of [false, true]) {
    sessionIds = Array.from({ length: count }, (_, i) => i + 1);
    await page.setViewportSize({ width: 1024, height: 768 });
    await openProfile();
    await page.setViewportSize({ width, height: 768 });
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
    const pages = Math.ceil(count / 5);
    await checkPage(1, pages);
    for (let number = 2; number <= pages; number++) {
      await page.getByRole('button', { name: 'Próxima', exact: true }).click(); await checkPage(number, pages);
    }
    await page.getByRole('button', { name: 'Salvar Alterações' }).scrollIntoViewIfNeeded();
    const panel = page.locator('[data-profile-panel]');
    assert.equal(await panel.evaluate(el => el.scrollWidth > el.clientWidth), false, 'Profile must not overflow horizontally');
    assert.ok((await panel.boundingBox()).height <= 736);
    if (process.env.PROFILE_SCREENSHOT_DIR) await panel.screenshot({ path: path.join(process.env.PROFILE_SCREENSHOT_DIR, `profile-${count}-${width}-${dark}.png`) });
    await closeProfile();
  }
  sessionIds = Array.from({ length: 45 }, (_, i) => i + 1);
  await page.setViewportSize({ width: 1024, height: 768 });
  await openProfile();
  for (let i = 2; i <= 6; i++) { await page.getByRole('button', { name: 'Próxima', exact: true }).click(); await checkPage(i, 6); }
  assert.equal(await page.getByRole('button', { name: 'Próxima', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Anterior', exact: true }).click(); await checkPage(5, 6);
  await closeProfile();
  sessionIds = Array.from({ length: 11 }, (_, i) => i + 1);
  await openProfile(); await checkPage(1, 3);
  for (let i = 2; i <= 3; i++) { await page.getByRole('button', { name: 'Próxima', exact: true }).click(); await checkPage(i, 3); }
  await page.getByRole('button', { name: 'Encerrar', exact: true }).click(); await checkPage(2, 2);
  await page.getByRole('button', { name: 'Encerrar outras', exact: true }).click(); await checkPage(1, 1);
  assert.equal(await page.locator('[data-profile-panel] tbody tr').count(), 1);
  await page.getByRole('button', { name: 'Ver informações do dispositivo' }).click();
  await page.getByText('Fixture browser', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await closeProfile();
  sessionIds = [1,2,3,4,5]; await openProfile(); await checkPage(1, 1);
  await page.getByRole('radio', { name: 'Superior', exact: true }).locator('..').click();
  await page.getByRole('radio', { name: 'Descrição', exact: true }).locator('..').click();
  assert.equal(await page.getByRole('radio', { name: 'Descrição', exact: true }).isChecked(), true);
  await page.getByRole('button', { name: 'Salvar Alterações' }).click();
  await page.waitForEvent('load');
  await page.locator('[data-desktop-navigation="top/labels"]').waitFor();
  assert.equal(users.a.menu_position, 'top'); assert.equal(users.b.menu_display, 'labels');
  await page.evaluate(() => window.selectTestUser('b'));
  assert.equal(await nav.getByRole('link', { name: 'Gestão de Equipe' }).count(), 0);
  await page.evaluate(() => window.selectTestUser('a'));
  assert.equal(await nav.getByRole('link', { name: 'Gestão de Equipe' }).count(), 1);
  await page.getByRole('button', { name: 'Notificações', exact: true }).click();
  await page.getByText('Notificações recentes', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.setTestPreferences({ menu_position: null, menu_display: null, must_change_password: true }));
  await page.getByRole('heading', { name: 'Troca obrigatória de senha' }).waitFor();
  assert.equal(await page.getByText('Preferências da interface', { exact: true }).count(), 0);
  assert.equal(await nav.getAttribute('data-desktop-navigation'), 'side/labels');
  await page.evaluate(() => window.setTestPreferences({ must_change_password: false }));
  await page.goto(url + '?admin'); await page.getByText('Página 1 de 8', { exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 10);
  assert.ok(requests.some(request => request.endpoint === '/users/profile' && request.method === 'PUT'));
  await page.getByRole('button', { name: 'Sair', exact: true }).first().click();
  assert.equal(await page.evaluate(() => window.loggedOut), true);
  sessionIds = [1]; await page.goto(url); await openProfile();
  await page.getByRole('button', { name: 'Encerrar', exact: true }).click();
  await page.waitForURL('**/login');
  assert.deepEqual(errors, []);
  console.log('Profile/navigation browser checks passed: four modes, themes, five viewports, pagination, revocation, preferences, permissions, theme/profile/logout.');
} finally { if (browser) await browser.close(); await vite.close(); }
