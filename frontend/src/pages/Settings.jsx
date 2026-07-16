import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, RefreshCw, AlertTriangle, ShieldCheck, Download, Database } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const APP_COMMIT = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : 'unknown';

export default function Settings() {
  const { user } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateCountdown, setUpdateCountdown] = useState(0);
  const [backupConfirmation, setBackupConfirmation] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);
  const [systemPermissions, setSystemPermissions] = useState(null);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(true);

  const canManageSystem = systemPermissions?.can_manage_system === true && systemPermissions?.is_super_admin === true;
  const currentUserEmail = systemPermissions?.email || user?.email || 'e-mail não identificado';
  const superAdminEmail = systemPermissions?.super_admin_email || 'e-mail configurado na instalação';

  useEffect(() => {
    const loadSystemPermissions = async () => {
      if (!user) {
        setSystemPermissions(null);
        setIsLoadingPermissions(false);
        return;
      }

      setIsLoadingPermissions(true);
      try {
        const response = await api.get('/system/permissions');
        setSystemPermissions(response.data);
      } catch (error) {
        console.error('Erro ao carregar permissões do sistema:', error);
        setSystemPermissions(null);
      } finally {
        setIsLoadingPermissions(false);
      }
    };

    loadSystemPermissions();
  }, [user]);

  useEffect(() => {
    let timer;
    if (updateCountdown > 0) {
      timer = setInterval(() => {
        setUpdateCountdown((prev) => prev - 1);
      }, 1000);
    } else if (updateCountdown === 0 && isUpdating) {
      window.location.reload();
    }
    return () => clearInterval(timer);
  }, [updateCountdown, isUpdating]);

  const handleUpdateSystem = async () => {
    if (!canManageSystem) {
      alert(`Apenas o Super Admin inicial (${superAdminEmail}) pode executar o WebUpdater.`);
      return;
    }

    if (!window.confirm('Tem certeza que deseja atualizar o sistema? O serviço ficará indisponível por alguns segundos.')) {
      return;
    }

    try {
      const response = await api.post('/system/update');
      setIsUpdating(true);
      setUpdateCountdown(response.data.estimatedTime || 60);
    } catch (error) {
      setIsUpdating(false);
      console.error('Erro ao iniciar atualização:', error);
      alert(error.response?.data?.error || 'Erro ao iniciar atualização. Verifique se você está logado como Super Admin.');
    }
  };

  const handleDownloadBackup = async () => {
    if (!canManageSystem) {
      alert(`Apenas o Super Admin inicial (${superAdminEmail}) pode gerar backup completo do sistema.`);
      return;
    }

    if (backupConfirmation !== 'EXPORTAR BACKUP') {
      alert('Digite exatamente EXPORTAR BACKUP para confirmar.');
      return;
    }
    if (backupPassphrase.length < 16) {
      alert('A frase de criptografia deve ter ao menos 16 caracteres.');
      return;
    }

    setIsDownloadingBackup(true);

    try {
      const response = await api.post('/system/backup', {
        confirmation: backupConfirmation,
        passphrase: backupPassphrase
      }, {
        responseType: 'blob'
      });

      const disposition = response.headers['content-disposition'];
      let filename = 'fullpassword-backup.fullpassword-backup.enc.json';

      if (disposition) {
        const match = disposition.match(/filename="(.+)"/);
        if (match && match[1]) {
          filename = match[1];
        }
      }

      const blob = new Blob([response.data], {
        type: response.headers['content-type'] || 'application/octet-stream'
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
      setBackupConfirmation('');
      setBackupPassphrase('');

    } catch (error) {
      let message = 'Erro ao gerar backup criptografado.';
      if (error.response?.data instanceof Blob) {
        try {
          const parsed = JSON.parse(await error.response.data.text());
          message = parsed.error || message;
        } catch {
          // Mantém mensagem genérica sem expor a frase enviada no objeto Axios.
        }
      }
      alert(message);
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  const restrictedWarning = (message) => (
    <div className="bg-amber-50 border-l-4 border-amber-400 p-4">
      <div className="flex">
        <div className="flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
        </div>
        <div className="ml-3">
          <p className="text-sm text-amber-700">{message}</p>
          <p className="text-xs text-amber-600 mt-1">
            Usuário autenticado: {currentUserEmail}. Super Admin exigido: {superAdminEmail}.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center">
            <SettingsIcon className="w-6 h-6 mr-2 text-indigo-600" />
            Configurações do Sistema
          </h1>
          <p className="text-sm text-slate-500">Gerencie parâmetros globais, atualizações e backups da plataforma</p>
        </div>
        <div className="text-right">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-800">
            Versão Atual: v1.0.1 ({APP_COMMIT})
          </span>
        </div>
      </div>

      {isUpdating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-90">
          <div className="bg-white p-8 rounded-lg shadow-2xl max-w-md w-full text-center">
            <RefreshCw className="w-16 h-16 text-indigo-600 animate-spin mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Atualizando Sistema</h2>
            <p className="text-slate-600 mb-6">
              O FullPassword está baixando a versão mais recente e reconstruindo os containers.
            </p>
            <div className="text-4xl font-mono font-bold text-indigo-600 mb-2">
              {updateCountdown}s
            </div>
            <p className="text-sm text-slate-500">
              A página será recarregada automaticamente.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white shadow rounded-lg overflow-hidden border border-slate-200">
          <div className="px-6 py-5 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
            <h3 className="text-lg leading-6 font-medium text-slate-900 flex items-center">
              <RefreshCw className="w-5 h-5 mr-2 text-indigo-500" />
              WebUpdater (Atualização Automática)
            </h3>
            {canManageSystem && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Super Admin
              </span>
            )}
          </div>
          <div className="p-6">
            <p className="text-sm text-slate-600 mb-4">
              O WebUpdater sincroniza o código fonte do repositório GitHub (branch main) e recria os containers Docker automaticamente.
              Esta ação é restrita ao Super Admin inicial.
            </p>

            {isLoadingPermissions ? (
              <div className="text-sm text-slate-500">Validando permissão de Super Admin...</div>
            ) : !canManageSystem ? (
              restrictedWarning('Apenas o Super Admin inicial pode executar a atualização do sistema.')
            ) : (
              <button
                onClick={handleUpdateSystem}
                disabled={isUpdating}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Buscar Atualizações e Reiniciar
              </button>
            )}
          </div>
        </div>

        <div className="bg-white shadow rounded-lg overflow-hidden border border-slate-200">
          <div className="px-6 py-5 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
            <h3 className="text-lg leading-6 font-medium text-slate-900 flex items-center">
              <Database className="w-5 h-5 mr-2 text-indigo-500" />
              Web Backup (Backup Completo)
            </h3>
            {canManageSystem && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Super Admin
              </span>
            )}
          </div>
          <div className="p-6">
            <p className="text-sm text-slate-600 mb-4">
              Gere um backup completo criptografado do FullPassword. O conteúdo sensível será protegido
              antes do download e as senhas dos cofres não serão descriptografadas pelo servidor.
            </p>

            <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-700">
                    Sem a frase de criptografia o backup não poderá ser aberto. Ela não é armazenada pelo sistema.
                  </p>
                </div>
              </div>
            </div>

            {isLoadingPermissions ? (
              <div className="text-sm text-slate-500">Validando permissão de Super Admin...</div>
            ) : !canManageSystem ? (
              restrictedWarning('Apenas o Super Admin inicial pode gerar backup completo do sistema.')
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Confirmação</label>
                  <input
                    type="text"
                    value={backupConfirmation}
                    onChange={(e) => setBackupConfirmation(e.target.value)}
                    placeholder="Digite EXPORTAR BACKUP"
                    autoComplete="off"
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Frase de criptografia</label>
                  <input
                    type="password"
                    value={backupPassphrase}
                    onChange={(e) => setBackupPassphrase(e.target.value)}
                    minLength={16}
                    autoComplete="new-password"
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                  <p className="mt-1 text-xs text-slate-500">Mínimo de 16 caracteres. Não salve esta frase junto ao arquivo.</p>
                </div>

                <button
                  onClick={handleDownloadBackup}
                  disabled={isDownloadingBackup}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {isDownloadingBackup ? 'Criptografando backup...' : 'Baixar Backup Criptografado'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white shadow rounded-lg overflow-hidden border border-slate-200">
          <div className="px-6 py-5 border-b border-slate-200 bg-slate-50">
            <h3 className="text-lg leading-6 font-medium text-slate-900 flex items-center">
              <ShieldCheck className="w-5 h-5 mr-2 text-emerald-500" />
              Status de Segurança
            </h3>
          </div>
          <div className="p-6">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div className="sm:col-span-1">
                <dt className="text-sm font-medium text-slate-500">Criptografia Client-Side</dt>
                <dd className="mt-1 text-sm text-slate-900 font-semibold text-emerald-600">Ativa (AES-256-GCM)</dd>
              </div>
              <div className="sm:col-span-1">
                <dt className="text-sm font-medium text-slate-500">Derivação de Chave</dt>
                <dd className="mt-1 text-sm text-slate-900 font-semibold text-emerald-600">Ativa (PBKDF2)</dd>
              </div>
              <div className="sm:col-span-1">
                <dt className="text-sm font-medium text-slate-500">Arquitetura Zero-Knowledge</dt>
                <dd className="mt-1 text-sm text-slate-900 font-semibold text-emerald-600">Em conformidade</dd>
              </div>
              <div className="sm:col-span-1">
                <dt className="text-sm font-medium text-slate-500">Isolamento de Memória</dt>
                <dd className="mt-1 text-sm text-slate-900 font-semibold text-emerald-600">Context API Volátil</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
