import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { resolveConfig } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icons = new Set(['Eye', 'Edit', 'Edit2', 'Pencil', 'PencilLine', 'Trash', 'Trash2']);
const config = await resolveConfig({ root }, 'build');
const transforms = config.plugins.filter(plugin => plugin.name.startsWith('client-vault-') && typeof plugin.transform === 'function');
let buttons = 0;

function check(source, filename, count = false) {
  const messages = new Linter().verify(source, [{
    files: ['**/*.jsx'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { actions: { rules: { validate: { create() { return {
      JSXElement(node) {
        if (node.openingElement.name.name !== 'button') return;
        const attrs = Object.fromEntries(node.openingElement.attributes.filter(attr => attr.type === 'JSXAttribute').map(attr => [attr.name.name, attr.value]));
        const children = node.children.filter(child => child.type !== 'JSXText' || child.value.trim());
        const icon = children.length === 1 && children[0].type === 'JSXElement' && children[0].openingElement.name.name;
        const classes = attrs.className?.value || '';
        if (!icons.has(icon)) {
          assert.ok(!classes.includes('action-icon-button'), 'Text buttons must not use icon-only styling');
          return;
        }
        const context = filename + ':' + node.loc.start.line;
        const variant = icon === 'Eye' ? 'view' : icon.startsWith('Trash') ? 'delete' : 'edit';
        assert.ok(classes.includes('action-icon-button') && classes.includes('action-icon-' + variant), context);
        assert.doesNotMatch(classes, /(?:^|\s)(?:\S*:)?(?:border|bg-|shadow|p[xy]?-[1-9]|[hw]-[89])/, context);
        assert.equal(attrs.type?.value, 'button', context);
        assert.ok(attrs['aria-label'] && attrs.title && attrs.onClick, context + ' must keep labels and handler');
        const svgClass = children[0].openingElement.attributes.find(attr => attr.name?.name === 'className')?.value?.value;
        assert.equal(svgClass, 'h-4 w-4', context + ' must retain a 16px SVG');
        if (count) buttons++;
      }
    }; } } } } },
    rules: { 'actions/validate': 'error' }
  }], { filename, allowInlineConfig: false });
  assert.deepEqual(messages, [], filename + ' must parse and pass icon checks');
}

for (const filename of fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(name => name.endsWith('.jsx'))) {
  // Explicit task exclusions: backup configuration and password visibility controls.
  if (['CloudBackupCard.jsx', 'SecurePasswordInput.jsx'].includes(path.basename(filename))) continue;
  const id = path.join(root, 'src', filename).replaceAll('\\', '/');
  const source = fs.readFileSync(id, 'utf8');
  check(source, filename, true);
  let transformed = source;
  for (const plugin of transforms) {
    const result = await plugin.transform(transformed, id);
    if (result) transformed = typeof result === 'string' ? result : result.code;
  }
  check(transformed, filename);
}
assert.ok(buttons >= 40, 'Scan must cover the managers, pages and shared controls');
console.log(`Action icon checks passed: ${buttons} icon-only buttons, including Vite transforms; text buttons preserved.`);
