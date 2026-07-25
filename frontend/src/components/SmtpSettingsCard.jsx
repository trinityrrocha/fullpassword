import { useEffect, useRef, useState } from 'react';
import { Mail, Send } from 'lucide-react';
import api from '../services/api';
import SettingsAccordionCard from './SettingsAccordionCard';

const INITIAL_SETTINGS = {
  enabled: false,
  host: '',
  port: 587,
  security: 'starttls',
  username: '',
  has_password: false,
  from_name: 'FullPassword',
  from_email: '',
  reply_to: '',
  timeout_seconds: 15
};

const CONFIG_ENCRYPTION_ERROR_CODES = new Set([
  'CONFIG_ENCRYPTION_KEY_MISSING',
  'CONFIG_ENCRYPTION_KEY_INVALID',
  'CONFIG_ENCRYPTION_KEY_PLACEHOLDER'
]);
const CONFIG_ENCRYPTION_UI_ERROR = [
  'A chave de criptografia das configurações não está configurada no servidor.',
  'Defina CONFIG_ENCRYPTION_KEY no arquivo .env com uma chave base64 de 32 bytes e reinicie o backend.',
  'Comando sugerido: openssl rand -base64 32'
].join('\n\n');
const SMTP_RATE_LIMIT_ERROR = 'Limite de testes SMTP atingido. Aguarde alguns minutos antes de tentar novamente.';
const LOCAL_COOLDOWN_SECONDS = 60;
const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500';

const portSecurityWarning = (port, security) => {
  const numericPort = Number(port);
  if (numericPort === 465 && security === 'starttls') {
    return 'Porta 465 normalmente usa SSL/TLS direto. Para STARTTLS, normalmente use 587.';
  }
  if (numericPort === 587 && security === 'ssl_tls') {
    return 'Porta 587 normalmente usa STARTTLS. Para SSL/TLS direto, normalmente use 465.';
  }
  return '';
};

export default function SmtpSettingsCard({ isSuperAdmin }) {
  const passwordInputRef = useRef(null);
  const [settings, setSettings] = useState(INITIAL_SETTINGS);
  const [testRecipient, setTestRecipient] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [passwordEntered, setPasswordEntered] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    if (!isSuperAdmin) return undefined;
    let active = true;
    api.get('/system/smtp')
      .then(({ data }) => {
        if (!active) return;
        setSettings({ ...INITIAL_SETTINGS, ...data });
        setConfigDirty(false);
        setPasswordEntered(false);
      })
      .catch((error) => {
        if (!active) return;
        setMessage({
          type: 'error',
          text: error.response?.data?.error || 'Não foi possível carregar a configuração SMTP.'
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isSuperAdmin]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setCooldownSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  if (!isSuperAdmin) return null;

  const updateField = (field, value) => {
    setSettings((current) => ({ ...current, [field]: value }));
    setConfigDirty(true);
  };

  const updateSecurity = (security) => {
    setSettings((current) => {
      const currentPort = Number(current.port);
      const usesStandardPort = !current.port || currentPort === 465 || currentPort === 587;
      const port = usesStandardPort
        ? security === 'ssl_tls' ? 465 : security === 'starttls' ? 587 : current.port
        : current.port;
      return { ...current, security, port };
    });
    setConfigDirty(true);
  };

  const formatSaveError = (error) => {
    const code = error.response?.data?.code;
    if (error.response?.status === 503 && CONFIG_ENCRYPTION_ERROR_CODES.has(code)) {
      return CONFIG_ENCRYPTION_UI_ERROR;
    }
    return error.response?.data?.error || 'Não foi possível salvar a configuração SMTP.';
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = String(new FormData(form).get('password') || '');

    if (settings.enabled && settings.username.trim() && !settings.has_password && !password) {
      setMessage({
        type: 'error',
        text: 'Informe a senha SMTP e salve a configuração antes de enviar um e-mail de teste.'
      });
      return;
    }

    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      const { data: savedSettings } = await api.put('/system/smtp', {
        enabled: settings.enabled,
        host: settings.host,
        port: Number(settings.port),
        security: settings.security,
        username: settings.username,
        password,
        from_name: settings.from_name,
        from_email: settings.from_email,
        reply_to: settings.reply_to,
        timeout_seconds: Number(settings.timeout_seconds)
      });

      let refreshedSettings = savedSettings;
      try {
        refreshedSettings = (await api.get('/system/smtp')).data;
      } catch {
        // A resposta sanitizada do PUT já representa a configuração persistida.
      }
      setSettings({ ...INITIAL_SETTINGS, ...refreshedSettings });
      setConfigDirty(false);
      setPasswordEntered(false);
      if (passwordInputRef.current) passwordInputRef.current.value = '';
      setMessage({
        type: 'success',
        text: password ? 'Senha SMTP salva.' : 'Configuração SMTP salva com segurança.'
      });
    } catch (error) {
      setMessage({ type: 'error', text: formatSaveError(error) });
    } finally {
      setSaving(false);
    }
  };

  const hasUnsavedChanges = configDirty || passwordEntered;
  const getTestBlockedReason = () => {
    if (!settings.enabled) return 'Ative e salve a configuração SMTP antes de enviar um e-mail de teste.';
    if (hasUnsavedChanges) return 'Salve as alterações da configuração SMTP antes de enviar o e-mail de teste.';
    if (!settings.has_password) return 'Salve a configuração SMTP com a senha antes de enviar o e-mail de teste.';
    if (cooldownSeconds > 0) return `${SMTP_RATE_LIMIT_ERROR} Nova tentativa local em ${cooldownSeconds}s.`;
    return '';
  };
  const testBlockedReason = getTestBlockedReason();

  const testEmail = async () => {
    const blockedReason = getTestBlockedReason();
    if (blockedReason) {
      setMessage({ type: 'error', text: blockedReason });
      return;
    }

    setTesting(true);
    setMessage({ type: '', text: '' });
    try {
      const { data } = await api.post('/system/smtp/test', {
        to: testRecipient.trim() || undefined
      });
      setMessage({ type: 'success', text: data.message || 'E-mail de teste enviado com sucesso.' });
    } catch (error) {
      const isRateLimited = error.response?.status === 429
        || error.response?.data?.code === 'SMTP_TEST_RATE_LIMITED';
      if (isRateLimited) {
        setCooldownSeconds(LOCAL_COOLDOWN_SECONDS);
        setMessage({ type: 'error', text: SMTP_RATE_LIMIT_ERROR });
      } else {
        setMessage({
          type: 'error',
          text: error.response?.data?.error || 'Não foi possível enviar o e-mail de teste.'
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const tlsPortWarning = portSecurityWarning(settings.port, settings.security);

  return (
    <SettingsAccordionCard
      id="smtp-settings"
      title="E-mail / SMTP"
      icon={<Mail className="mr-2 h-5 w-5 text-indigo-500" />}
      badge={<span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">Super Admin</span>}
    >
      {loading ? (
        <p className="text-sm text-slate-500">Carregando configuração SMTP...</p>
      ) : (
        <form className="space-y-5" onSubmit={saveSettings}>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            A configuração SMTP permite envio de convites, alertas e fluxos futuros de recuperação de conta.
            Ela não permite recuperar cofres sem a senha mestre em uma arquitetura Zero-Knowledge.
          </div>

          <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => updateField('enabled', event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            SMTP ativo
          </label>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Host SMTP
              <input
                type="text"
                value={settings.host}
                onChange={(event) => updateField('host', event.target.value)}
                maxLength={255}
                autoComplete="off"
                className={`${fieldClass} mt-1`}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Porta
              <input
                type="number"
                value={settings.port}
                onChange={(event) => updateField('port', event.target.value)}
                min={1}
                max={65535}
                className={`${fieldClass} mt-1`}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Segurança
              <select
                value={settings.security}
                onChange={(event) => updateSecurity(event.target.value)}
                className={`${fieldClass} mt-1`}
              >
                <option value="ssl_tls">SSL/TLS direto</option>
                <option value="starttls">STARTTLS</option>
                <option value="none">Sem criptografia</option>
              </select>
              {tlsPortWarning && (
                <span className="mt-1 block text-xs font-normal text-amber-700">{tlsPortWarning}</span>
              )}
              {settings.security === 'none' && (
                <span className="mt-1 block text-xs font-normal text-red-700">
                  Use sem criptografia somente em ambiente local ou de teste.
                </span>
              )}
            </label>
            <label className="text-sm font-medium text-slate-700">
              Timeout em segundos
              <input
                type="number"
                value={settings.timeout_seconds}
                onChange={(event) => updateField('timeout_seconds', event.target.value)}
                min={1}
                max={120}
                className={`${fieldClass} mt-1`}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Usuário SMTP
              <input
                type="text"
                value={settings.username}
                onChange={(event) => updateField('username', event.target.value)}
                maxLength={320}
                autoComplete="username"
                className={`${fieldClass} mt-1`}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Senha SMTP
              <input
                ref={passwordInputRef}
                type="password"
                name="password"
                maxLength={4096}
                autoComplete="new-password"
                onChange={(event) => setPasswordEntered(event.target.value.length > 0)}
                placeholder="Preencha apenas para alterar a senha SMTP"
                className={`${fieldClass} mt-1`}
              />
              <span className="mt-1 block text-xs text-slate-500">
                {settings.has_password ? 'Uma senha SMTP já está salva e não será exibida.' : 'Nenhuma senha SMTP salva.'}
              </span>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Nome do remetente
              <input
                type="text"
                value={settings.from_name}
                onChange={(event) => updateField('from_name', event.target.value)}
                maxLength={255}
                className={`${fieldClass} mt-1`}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              E-mail do remetente
              <input
                type="email"
                value={settings.from_email}
                onChange={(event) => updateField('from_email', event.target.value)}
                maxLength={254}
                autoComplete="email"
                className={`${fieldClass} mt-1`}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Reply-To opcional
              <input
                type="email"
                value={settings.reply_to}
                onChange={(event) => updateField('reply_to', event.target.value)}
                maxLength={254}
                autoComplete="off"
                className={`${fieldClass} mt-1`}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4">
            <label className="min-w-64 flex-1 text-sm font-medium text-slate-700">
              Destinatário para e-mail de teste
              <input
                type="email"
                value={testRecipient}
                onChange={(event) => setTestRecipient(event.target.value)}
                maxLength={254}
                placeholder="Vazio usa o e-mail do Super Admin"
                className={`${fieldClass} mt-1`}
              />
            </label>
            <button
              type="button"
              onClick={testEmail}
              disabled={Boolean(testBlockedReason) || testing || saving}
              className="inline-flex items-center rounded-md border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="mr-2 h-4 w-4" />
              {testing ? 'Enviando...' : 'Enviar e-mail de teste'}
            </button>
            <button
              type="submit"
              disabled={saving || testing}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Salvando...' : 'Salvar configuração'}
            </button>
          </div>

          {testBlockedReason && <p className="text-xs text-slate-600">{testBlockedReason}</p>}

          {message.text && (
            <p
              role={message.type === 'error' ? 'alert' : 'status'}
              className={`whitespace-pre-line rounded-md border px-3 py-2 text-sm ${
                message.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-green-200 bg-green-50 text-green-800'
              }`}
            >
              {message.text}
            </p>
          )}
        </form>
      )}
    </SettingsAccordionCard>
  );
}
