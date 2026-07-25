import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getVaultSharingGroupNames,
  normalizeVaultShare,
  toggleVaultGroupShare
} from '../src/utils/vaultSharingSelection.js';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manager = fs.readFileSync(path.join(frontendRoot, 'src/components/VaultSharingManager.jsx'), 'utf8');

const administrators = {
  id: 'group-admin',
  name: 'Administradores',
  can_view: true,
  can_edit: true,
  can_add: true,
  can_delete: true
};
const support = {
  id: 'group-support',
  name: 'Suporte Técnico',
  can_view: true,
  can_edit: false,
  can_add: false,
  can_delete: false
};

const existingShares = [normalizeVaultShare(administrators)];
assert.equal(existingShares[0].group_id, administrators.id);
assert.equal(existingShares[0].can_delete, true);

const withSupport = toggleVaultGroupShare(existingShares, support);
assert.deepEqual(withSupport.map((share) => share.group_id), ['group-support', 'group-admin']);
assert.equal(withSupport[0].can_view, true);
assert.equal(withSupport[0].can_edit, false);

const withoutAdministrators = toggleVaultGroupShare(withSupport, administrators);
assert.deepEqual(withoutAdministrators.map((share) => share.group_id), ['group-support']);
assert.deepEqual(
  getVaultSharingGroupNames(withSupport, [administrators, support]),
  ['Suporte Técnico', 'Administradores']
);

assert.match(manager, /role="listbox"/);
assert.match(manager, /aria-multiselectable="true"/);
assert.match(manager, /type="checkbox"/);
assert.match(manager, /checked=\{isSelected\}/);
assert.match(manager, /Selecione os grupos\.\.\./);
assert.match(manager, /1 grupo selecionado/);
assert.match(manager, /Grupos compartilhados:/);
assert.match(manager, /selectedGroupNames\.join\(', '\)/);
assert.match(manager, /\[overflow-wrap:anywhere\]/);
assert.match(manager, /Nenhum grupo selecionado para compartilhamento\./);
assert.match(manager, /document\.addEventListener\('mousedown', handleOutsideClick\)/);
assert.match(manager, /event\.key !== 'Escape'/);
assert.match(manager, /onClick=\{saveShares\}/);
assert.match(manager, /Salvar compartilhamento/);
assert.match(manager, /onClick=\{resyncKeyShares\}/);
assert.match(manager, /Ressincronizar chaves do compartilhamento/);
assert.match(manager, /can_view: share\.can_view/);
assert.match(manager, /can_edit: share\.can_edit/);
assert.match(manager, /can_add: share\.can_add/);
assert.match(manager, /can_delete: share\.can_delete/);
assert.doesNotMatch(manager, /Permissões herdadas do grupo/);
assert.doesNotMatch(manager, /<Trash2|<Plus|>\s*Adicionar\s*</);

console.log('Vault sharing group selector tests passed.');
