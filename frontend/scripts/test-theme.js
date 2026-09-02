import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getNextTheme,
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

assert.equal(readStoredTheme(createStorage()), 'light', 'O tema padrão deve ser light');
assert.equal(readStoredTheme(createStorage('dark')), 'dark', 'O tema salvo deve ser lido');
const legacyStorage = createStorage('system');
assert.equal(readStoredTheme(legacyStorage), 'light', 'Tema system legado deve voltar para light');
assert.equal(legacyStorage.getItem(THEME_STORAGE_KEY), 'light', 'Tema system legado deve ser normalizado no storage');
const invalidStorage = createStorage('invalid');
assert.equal(readStoredTheme(invalidStorage), 'light', 'Tema inválido deve voltar para light');
assert.equal(invalidStorage.getItem(THEME_STORAGE_KEY), 'light', 'Tema inválido deve ser normalizado no storage');
assert.equal(normalizeTheme('light'), 'light');
assert.equal(normalizeTheme('invalid'), 'light');
assert.equal(resolveTheme('system'), 'light');
assert.equal(getNextTheme('light'), 'dark');
assert.equal(getNextTheme('dark'), 'light');

const darkRoot = createRoot();
assert.equal(applyTheme('dark', { root: darkRoot, systemIsDark: false }), 'dark');
assert.equal(darkRoot.classes.has('dark'), true, 'Escuro deve adicionar a classe dark');
assert.equal(darkRoot.dataset.theme, 'dark');

const lightRoot = createRoot();
lightRoot.classes.add('dark');
assert.equal(applyTheme('light', { root: lightRoot, systemIsDark: true }), 'light');
assert.equal(lightRoot.classes.has('dark'), false, 'Claro deve remover a classe dark');

const storage = createStorage();
assert.equal(persistTheme('dark', storage), 'dark');
assert.equal(storage.getItem(THEME_STORAGE_KEY), 'dark');

const toggleSource = read('src/components/ThemeToggle.jsx');
assert.doesNotMatch(toggleSource, /<select/);
assert.match(toggleSource, /<button/);
assert.match(toggleSource, /Moon/);
assert.match(toggleSource, /Sun/);
assert.match(toggleSource, /Ativar tema escuro/);
assert.match(toggleSource, /Ativar tema claro/);

const providerSource = read('src/context/ThemeContext.jsx');
assert.doesNotMatch(providerSource, /prefers-color-scheme: dark/);
assert.doesNotMatch(providerSource, /addEventListener\('change'/);

const indexHtml = read('index.html');
assert.match(indexHtml, /<script src="\/theme-init\.js"><\/script>/);
assert.doesNotMatch(indexHtml, /<script>(?:.|\n)*localStorage/);

console.log('Frontend theme tests passed.');
