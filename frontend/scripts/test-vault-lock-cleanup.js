import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');

const authContext = read('src/context/AuthContext.jsx');
const clearHook = read('src/hooks/useClearOnVaultLock.js');
const clientVault = read('src/pages/ClientVault.jsx');
const settings = read('src/pages/Settings.jsx');
const backupRestore = read('src/components/BackupRestoreCard.jsx');
const securePasswordInput = read('src/components/SecurePasswordInput.jsx');
const copyButton = read('src/components/CopyButton.jsx');
const app = read('src/App.jsx');

assert.match(authContext, /vaultLockCleanupsRef = useRef\(new Set\(\)\)/);
assert.match(authContext, /transientMasterKeySourceRef = useRef\(null\)/);
assert.match(authContext, /notifyVaultLockCleanups\(\);\s+transientMasterKeySourceRef\.current = null;\s+setMasterKey\(null\)/);
assert.match(authContext, /const key = await unwrapMasterKey\(wrappedKeyStr, kek\);\s+transientMasterKeySourceRef\.current = \{ kek, wrappedKey: wrappedKeyStr \};\s+setMasterKey\(key\)/);
assert.doesNotMatch(authContext, /setMasterKey\(transientMasterKey\)/);
assert.doesNotMatch(authContext, /user\?\.wrapped_key[\s\S]{0,300}encryptWrappedVaultKeyForPublicKeys/);
assert.match(authContext, /navigator\.clipboard\?\.writeText/);
assert.match(authContext, /setVaultStateEpoch\(\(current\) => current \+ 1\)/);
assert.match(clearHook, /registerVaultLockCleanup\(\(\) => clearCallbackRef\.current\(\)\)/);
assert.match(app, /<DashboardLayout key=\{vaultStateEpoch\} \/>/);

for (const reset of [
  'setCpanelForm({ cpanels: [], users: [] })',
  'setVpnForm({ servers: [], users: [] })',
  'setTsForm({ servers: [], users: [] })',
  'setServerForm({ servers: [], sshCredentials: [] })',
  'setDevicesForm({ devices: [], deviceLogins: [] })',
  'setSavedItems([])',
  'setVaultDataKey(null)',
  'setEncryptedVaultKeyShare(null)',
  "setUnlockPassword('')"
]) {
  assert.ok(clientVault.includes(reset), `ClientVault não limpa ${reset}`);
}

const managerFiles = [
  'src/components/CpanelWebManager.jsx',
  'src/components/VpnManager.jsx',
  'src/components/WindowsServerManager.jsx',
  'src/components/LinuxServerManager.jsx',
  'src/components/DevicesManager.jsx'
];

for (const managerFile of managerFiles) {
  const source = read(managerFile);
  assert.match(source, /useClearOnVaultLock\(\(\) => \{/);
  assert.match(source, /setEditing[A-Za-z]+\(null\)/);
  assert.match(source, /setViewing[A-Za-z]+\(null\)/);
  assert.match(source, /setShow[A-Za-z]+Modal\(false\)/);
}

assert.match(settings, /setBackupPassphrase\(''\)/);
assert.match(backupRestore, /useClearOnVaultLock\(\(\) => \{[\s\S]*setPassphrase\(''\)/);
assert.match(securePasswordInput, /setShowPassword\(false\)/);
assert.match(securePasswordInput, /setPreviousValue\(null\)/);
assert.match(copyButton, /useClearOnVaultLock\(\(\) => \{[\s\S]*setCopied\(false\)/);

console.log('Vault lock plaintext cleanup tests passed.');
