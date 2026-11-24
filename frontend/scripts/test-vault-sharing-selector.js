import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canPickUser,
  getVaultSharingGroupNames,
  setUserSharePermission,
  sharingSummary,
  toUserSharesPayload,
  toggleUserShare,
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

// ---- direct user shares ----
const ana = { id: 'u-ana', name: 'Ana Souza', email_hint: 'an***@example.com', has_identity: true, is_active: true };
const noKey = { id: 'u-nokey', name: 'Sem Chave', email_hint: 'se***@example.com', has_identity: false, is_active: true };
assert.equal(canPickUser(ana), true); assert.equal(canPickUser(noKey), false, 'no crypto identity: cannot receive a key');
assert.equal(canPickUser({ ...ana, is_active: false }), false); assert.equal(canPickUser(null), false);
let picked = toggleUserShare([], ana);
assert.deepEqual(picked.map((u) => [u.user_id, u.can_view, u.can_edit]), [['u-ana', true, false]], 'view is implied, nothing else by default');
assert.deepEqual(toggleUserShare(picked, noKey), picked, 'a user without identity is never added');
picked = setUserSharePermission(picked, 'u-ana', 'can_edit', true);
assert.equal(picked[0].can_edit, true); assert.equal(setUserSharePermission(picked, 'u-ana', 'can_view', false)[0].can_view, true, 'view cannot be switched off from here');
assert.deepEqual(toggleUserShare(picked, ana), [], 'toggling again removes');
assert.deepEqual(toUserSharesPayload(picked), [{ user_id: 'u-ana', can_view: true, can_edit: true, can_add: false, can_delete: false }], 'only ids and rights go back to the server');
assert.deepEqual(toUserSharesPayload(undefined), []);
assert.equal(sharingSummary(1, 2), '1 grupo e 2 usuários'); assert.equal(sharingSummary(0, 0), 'Nenhum grupo ou usuário selecionado'); assert.equal(sharingSummary(3, 1), '3 grupos e 1 usuário');
assert.match(manager, /user-directory/); assert.match(manager, /userSharesLoaded \? toUserSharesPayload\(userShares\) : undefined/, 'unread direct shares are never overwritten');
assert.match(manager, /Usuários para compartilhar/);
console.log('Vault direct user share selection tests passed.');
