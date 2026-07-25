import { useEffect, useState } from 'react';
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

const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function SmtpSettingsCard({ isSuperAdmin }) {
  const [settings, setSettings] = useState(INITIAL_SETTINGS);
  const [testRecipient, setTestRecipient] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    if (!isSuperAdmin) return undefined;
    let active = true;
    api.get('/system/smtp')
      .then(({ data }) => {
        if (!active) return;
        setSettings({ ...INITIAL_SETTINGS, ...data });
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

  if (!isSuperAdmin) return null;

  const updateField = (field, value) => {
    setSettings((current) => ({ ...current, [field]: value }));
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const passwordInput = form.elements.namedItem('password');
    const password = String(new FormData(form).get('password') || '');
    if (passwordInput) passwordInput.value = '';

    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      const { data } = await api.put('/system/smtp', {
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
      setSettings({ ...INITIAL_SETTINGS, ...data });
      setMessage({ type: 'success', text: 'Configuração SMTP salva com segurança.' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Não foi possível salvar a configuração SMTP.'
      });
    } finally {
      setSaving(false);
    }
  };

  const testEmail = async () => {
    setTesting(true);
    setMessage({ type: '', text: '' });
    try {
      const { data } = await api.post('/system/smtp/test', {
        to: testRecipient.trim() || undefined
      });
      setMessage({ type: 'success', text: data.message || 'E-mail de teste enviado com sucesso.' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Não foi possível enviar o e-mail de teste.'
      });
    } finally {
      setTesting(false);
    }
  };

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
                onChange={(event) => updateField('security', event.target.value)}
                className={`${fieldClass} mt-1`}
              >
                <option value="ssl_tls">SSL/TLS direto</option>
                <option value="starttls">STARTTLS</option>
                <option value="none">Sem criptografia (somente ambiente local/teste)</option>
              </select>
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
                type="password"
                name="password"
                maxLength={4096}
                autoComplete="new-password"
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
              disabled={testing || saving}
              className="inline-flex items-center rounded-md border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
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

          {message.text && (
            <p
              role={message.type === 'error' ? 'alert' : 'status'}
              className={`rounded-md border px-3 py-2 text-sm ${
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
