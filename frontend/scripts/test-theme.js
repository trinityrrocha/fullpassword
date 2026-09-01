import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  normalizeTheme,
  persistTheme,
  readStoredTheme,
  resolveTheme
} from '../src/utils/theme.js';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');

const createStorage = (initialValue = null) => {
  const values = new Map();
  if (initialValue !== null) values.set(THEME_STORAGE_KEY, initialValue);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
};

const createRoot = () => {
  const classes = new Set();
  return {
    classes,
    classList: {
      toggle: (className, enabled) => enabled ? classes.add(className) : classes.delete(className)
    },
    dataset: {},
    style: {}
  };
};

assert.equal(readStoredTheme(createStorage()), 'system', 'O tema padrão deve ser system');
assert.equal(readStoredTheme(createStorage('dark')), 'dark', 'O tema salvo deve ser lido');
assert.equal(readStoredTheme(createStorage('invalid')), 'system', 'Tema inválido deve voltar para system');
assert.equal(normalizeTheme('light'), 'light');
assert.equal(normalizeTheme('invalid'), 'system');
assert.equal(resolveTheme('system', true), 'dark');
assert.equal(resolveTheme('system', false), 'light');

const darkRoot = createRoot();
assert.equal(applyTheme('dark', { root: darkRoot, systemIsDark: false }), 'dark');
assert.equal(darkRoot.classes.has('dark'), true, 'Escuro deve adicionar a classe dark');
assert.equal(darkRoot.dataset.theme, 'dark');

const lightRoot = createRoot();
lightRoot.classes.add('dark');
assert.equal(applyTheme('light', { root: lightRoot, systemIsDark: true }), 'light');
assert.equal(lightRoot.classes.has('dark'), false, 'Claro deve remover a classe dark');

const systemRoot = createRoot();
applyTheme('system', { root: systemRoot, systemIsDark: true });
assert.equal(systemRoot.classes.has('dark'), true, 'Sistema deve seguir prefers-color-scheme escuro');
applyTheme('system', { root: systemRoot, systemIsDark: false });
assert.equal(systemRoot.classes.has('dark'), false, 'Sistema deve seguir prefers-color-scheme claro');

const storage = createStorage();
assert.equal(persistTheme('dark', storage), 'dark');
assert.equal(storage.getItem(THEME_STORAGE_KEY), 'dark');

const toggleSource = read('src/components/ThemeToggle.jsx');
for (const label of ['Claro', 'Escuro', 'Sistema']) {
  assert.ok(toggleSource.includes(`>${label}<`), `Controle de tema sem a opção ${label}`);
}
assert.match(toggleSource, /aria-label="Selecionar tema da interface"/);

const providerSource = read('src/context/ThemeContext.jsx');
assert.match(providerSource, /prefers-color-scheme: dark/);
assert.match(providerSource, /addEventListener\('change'/);

const indexHtml = read('index.html');
assert.match(indexHtml, /<script src="\/theme-init\.js"><\/script>/);
assert.doesNotMatch(indexHtml, /<script>(?:.|\n)*localStorage/);

console.log('Frontend theme tests passed.');
