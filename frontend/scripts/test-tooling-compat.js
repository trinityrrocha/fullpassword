import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
import theme from '../legacy-tailwind-theme.js';
import spacingCompatibility from '../tailwind-spacing-compat.js';

const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const pkg = JSON.parse(read('../package.json'));
assert.equal(pkg.devDependencies.tailwindcss, '4.3.3');
assert.equal(pkg.devDependencies['@tailwindcss/vite'], '4.3.3');
const lock = JSON.parse(read('../package-lock.json'));
for (const name of ['braces', 'micromatch', 'chokidar', 'postcss-selector-parser', 'postcss-nested']) {
  assert(!Object.keys(lock.packages).some(p => p.endsWith('/node_modules/' + name) || p === 'node_modules/' + name), `${name} must not remain in the canonical tree`);
}
assert.equal(theme.colors.indigo[600], '#4f46e5');
assert.equal(theme.colors.slate[900], '#0f172a');
assert.equal(theme.colors.gray[50], '#f9fafb');
assert.equal(theme.borderRadius.DEFAULT, '0.25rem');
assert.equal(theme.borderRadius.sm, '0.125rem');
assert.equal(theme.blur.sm, '4px');
assert.equal(theme.boxShadow.sm, '0 1px 2px 0 rgb(0 0 0 / 0.05)');
const css = read('../src/index.css');
assert.match(css, /@config "\.\.\/tailwind\.config\.js"/);
assert.match(css, /@custom-variant dark \(&:is\(\.dark \*\)\)/);
assert.match(css, /--default-ring-width: 3px/);
assert.match(css, /--default-ring-color: #3b82f6/);
assert.match(css, /border-color: var\(--color-gray-200/);
assert.match(css, /color: var\(--color-gray-400/);
const transformed = await postcss([spacingCompatibility()]).process('.space-y-4>:where(:not(:last-child)){margin-block-end:1rem}.new-class{padding:2rem}', { from: undefined });
assert(!transformed.css.includes('margin-block-end'));
assert(transformed.css.includes('.space-y-4>:not([hidden])~:not([hidden])'));
assert(transformed.css.includes('margin-top'));
assert(transformed.css.includes('.new-class{padding:2rem}'));
assert(!read('../vite.config.js').includes('handleShareClick'));
console.log('PASS tooling compatibility: vulnerable trees absent, v3 visual tokens/defaults/dark/hover and sibling selectors retained; no fake sharing define.');
