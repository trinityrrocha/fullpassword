import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(frontendRoot, '..');
const read = (absolutePath) => fs.readFileSync(absolutePath, 'utf8');

const collectSourceFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    return /\.(?:js|jsx|html|svg)$/.test(entry.name) ? [entryPath] : [];
  });

const frontendSources = [
  ...collectSourceFiles(path.join(frontendRoot, 'src')),
  ...collectSourceFiles(path.join(frontendRoot, 'public')),
  path.join(frontendRoot, 'index.html'),
  ...fs.readdirSync(frontendRoot)
    .filter((name) => /^vite.*\.js$/.test(name))
    .map((name) => path.join(frontendRoot, name))
];

for (const sourcePath of frontendSources) {
  const source = read(sourcePath);
  const relativePath = path.relative(projectRoot, sourcePath);
  assert.doesNotMatch(source, /\bstyle\s*=\s*\{/, `${relativePath} contém atributo style inline`);
  assert.doesNotMatch(source, /<style(?:\s|>)/i, `${relativePath} contém elemento style inline`);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/, `${relativePath} injeta HTML diretamente`);
}

const cspFiles = [
  path.join(projectRoot, 'docker', 'nginx.conf'),
  path.join(projectRoot, 'scripts', 'install.sh'),
  path.join(projectRoot, 'scripts', 'update.sh')
];
const unsafeInlineDirective = ['unsafe', 'inline'].join('-');

for (const cspPath of cspFiles) {
  const source = read(cspPath);
  const relativePath = path.relative(projectRoot, cspPath);
  assert.match(source, /Content-Security-Policy "[^"]*style-src 'self';/);
  assert.ok(!source.includes(unsafeInlineDirective), `${relativePath} ainda permite diretiva inline insegura`);
}

const app = read(path.join(frontendRoot, 'src', 'App.jsx'));
assert.match(app, /errorElement=\{<RouteErrorFallback \/>}/);

const styles = read(path.join(frontendRoot, 'src', 'index.css'));
for (const className of ['csp-progress', 'vpn-connection-grid', 'permission-admin-icon']) {
  assert.ok(styles.includes(`.${className}`), `Classe CSP ausente: ${className}`);
}

const screenProtection = read(path.join(frontendRoot, 'src', 'components', 'ScreenProtection.jsx'));
assert.doesNotMatch(screenProtection, /\bstyle\s*=\s*\{/);
assert.match(screenProtection, /classList\.(?:add|remove|toggle)/);

console.log('Frontend CSP hardening tests passed.');
