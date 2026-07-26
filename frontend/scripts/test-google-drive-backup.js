import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCloudStatus } from '../src/utils/cloudBackupUiState.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const card = read('src/components/CloudBackupCard.jsx');
const modals = read('src/components/CloudBackupModals.jsx');
const googlePanel = read('src/components/GoogleDriveProviderPanel.jsx');
const settings = read('src/pages/Settings.jsx');
const combinedCloudUi = `${card}\n${modals}\n${googlePanel}`;

assert.equal(getCloudStatus({ providerStatus: { last_test_status: 'degraded' }, configured: true }), 'degraded');
assert.equal(getCloudStatus({ providerStatus: { last_test_status: 'success' }, configured: true }), 'online');
assert.equal(getCloudStatus({ providerStatus: { last_test_status: 'failed' }, configured: true }), 'offline');

assert.match(card, /title="Backup Nuvem"/);
assert.match(card, /\['google_drive', 'Google Drive'\]/);
assert.match(card, /\['backblaze_b2', 'Backblaze B2'\]/);
assert.match(card, /\['mega_s3', 'Mega S3'\]/);
assert.match(card, /\['ftp', 'FTP'\]/);
assert.match(card, /role="switch"/);
assert.match(card, /aria-checked=\{active\}/);
assert.match(card, /provider === status\.active_provider \? 'none' : provider/);
assert.match(card, /provider: targetProvider/);
assert.match(card, /Nenhum provedor de backup em nuvem ativo/);
assert.match(card, /status\.active_provider === 'none'/);
assert.match(card, /window\.confirm\('Ao ativar este provedor/);
assert.match(card, /api\.put\('\/cloud-backup\/provider'/);

const compactRows = card.match(/data-cloud-row="/g) || [];
assert.equal(compactRows.length, 4);
assert.match(card, /data-cloud-row="service-endpoint"/);
assert.match(card, /data-cloud-row="credentials"/);
assert.match(card, /data-cloud-row="destination-test"/);
assert.match(card, /data-cloud-row="monitoring-status"/);
assert.match(card, /Monitoramento Automático/);

assert.match(card, /US East/);
assert.match(card, /https:\/\/s3\.us-east-005\.backblazeb2\.com/);
assert.match(card, /Access Key \/ Key ID/);
assert.match(card, /Secret Key \/ Application Key/);
assert.match(card, /Bucket/);
assert.match(card, /Prefixo/);

assert.match(card, /Europa - Amsterdam/);
assert.match(card, /Europa - Luxembourg/);
assert.match(card, /Canadá - Montreal/);
assert.match(card, /APAC - Tokyo/);
assert.match(card, /https:\/\/s3\.eu-amsterdam\.megas4\.com/);
assert.match(card, /Mega Object Storage \/ S4/);

assert.match(card, /FTP \/ FTPS/);
assert.match(card, /Host/);
assert.match(card, /Porta/);
assert.match(card, /FTPS/);
assert.match(card, /Usuário/);
assert.match(card, /Senha/);
assert.match(card, /Pasta remota/);
assert.match(card, /FTP puro não criptografa o tráfego/);

assert.match(card, /EndpointEditorModal/);
assert.match(card, /ConnectionTestModal/);
assert.match(card, /MonitoringModal/);
assert.match(modals, /title="Editar endpoint"/);
assert.match(modals, /title="Teste de conexão"/);
assert.match(modals, /title="Monitoramento completo"/);
assert.match(card, />Instável</);
assert.match(modals, /degraded: \{ label: 'Instável'/);
assert.match(modals, /Testar permissão de escrita/);
assert.match(modals, /Copiar Debug Seguro/);
assert.match(modals, /Silenciar 1h/);
assert.match(modals, /Sparkline de latência/);
assert.match(card, /A conexão ainda não foi testada com sucesso/);
assert.match(card, />Alterar</);

assert.match(card, /Backup Nuvem ativo/);
assert.match(card, /Agendamento ativo/);
assert.match(card, /Backup V2/);
assert.match(card, /Frase de criptografia/);
assert.match(card, /Notificações por e-mail/);
assert.match(card, /Configure o servidor de e-mail antes de ativar notificações/);
assert.match(card, /failure_email_enabled/);
assert.match(card, /failure_email_recipients/);
assert.match(card, /failure_email_on_recovery/);

assert.match(card, /MASKED_SECRET = '••••••••••••••••'/);
assert.match(card, /access_key: ''/);
assert.match(card, /secret_key: ''/);
assert.match(card, /username: ''/);
assert.match(card, /password: ''/);
assert.doesNotMatch(combinedCloudUi, /localStorage|sessionStorage/);
assert.doesNotMatch(combinedCloudUi, /WhatsApp|whatsappWebhook|webhook/i);
assert.doesNotMatch(modals, /secretAccessKey|refresh_token|access_token|client_secret|backup_passphrase/);

assert.match(googlePanel, /Configuração OAuth/);
assert.match(googlePanel, /\/integrations\/google-drive\/oauth-config/);
assert.match(googlePanel, /\/integrations\/google-drive\/oauth\/start/);
assert.match(googlePanel, /Conectar Google Drive/);
assert.match(googlePanel, /clientSecret: ''/);
assert.doesNotMatch(googlePanel, /localStorage|sessionStorage|refresh_token|access_token/);

assert.match(settings, /import CloudBackupCard/);
assert.match(settings, /<CloudBackupCard isSuperAdmin=\{canManageSystem\}/);
assert.doesNotMatch(settings, /<GoogleDriveBackupCard/);

console.log('Cloud Backup compact frontend tests passed.');
