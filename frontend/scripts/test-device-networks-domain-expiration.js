import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const devices = read('src/components/DevicesManager.jsx');
const hosting = read('src/components/CpanelWebManager.jsx');
const vault = read('src/pages/ClientVault.jsx');

assert.match(devices, /printerNetwork: \{/, 'Impressora deve ter rede estática segura');
assert.match(devices, /pabxNetwork: \{/, 'PABX deve ter rede estática segura');
assert.match(devices, /const availableConnectionOptions = vpnOnlyConnections \? \['VPN'\] : CONNECTION_OPTIONS/, 'Impressora e PABX devem oferecer somente VPN para novas conexões');
assert.match(devices, /StaticNetworkReadOnly title="Rede da impressora"/, 'Visualização da impressora deve exibir rede estática');
assert.match(devices, /StaticNetworkReadOnly title="Rede do PABX-IP\/VOIP"/, 'Visualização do PABX deve exibir rede estática');
for (const label of ['IP da rede estática', 'Máscara da rede estática', 'Gateway da rede estática', 'MAC da rede estática', 'DHCP da rede estática', 'Observação da rede estática']) {
  assert.match(devices, new RegExp(`aria-label="${label}"`), `Campo ausente: ${label}`);
}
assert.match(devices, /aria-label="Porta de impressão"/, 'Impressora deve exibir porta de impressão');
assert.match(devices, /const DHCP_OPTIONS = \['On', 'Off'\]/, 'DHCP deve aceitar On e Off');
assert.match(devices, /printPort: sanitizePortInput/, 'Porta de impressão deve ser numérica');

assert.match(hosting, /domainExpirationDate: ''/, 'Hospedagem antiga deve normalizar vencimento vazio');
assert.match(hosting, /domainExpirationNotifyEnabled: false/, 'Notificação deve iniciar desativada');
assert.match(hosting, /Data de vencimento do domínio/, 'Formulário deve exibir vencimento');
assert.match(hosting, /Notificar vencimento do domínio por e-mail/, 'Formulário deve exibir ativação de e-mail');
assert.match(hosting, /Este e-mail já foi adicionado/, 'E-mails duplicados devem ser recusados');
assert.match(hosting, /Adicione pelo menos um e-mail/, 'Notificação ativa deve exigir destinatário');
assert.match(hosting, /Notificação: \{cpanel\.domainExpirationNotifyEnabled/, 'Lista deve mostrar status da notificação');
assert.match(hosting, /<ReadOnlyField label="Senha">\*\*\*\*/, 'Senha deve permanecer mascarada');

const notificationPayload = vault.slice(vault.indexOf("if (category === 'cPanel')"), vault.indexOf('if (showSuccess)', vault.indexOf("if (category === 'cPanel')")));
assert.match(notificationPayload, /domainExpirationNotifyEnabled/, 'Somente notificações explicitamente ativas devem ser sincronizadas');
assert.doesNotMatch(notificationPayload, /password|username|notes|url/i, 'Metadados operacionais não podem conter dados sensíveis do cofre');

console.log('Frontend device networks and domain expiration tests passed.');
