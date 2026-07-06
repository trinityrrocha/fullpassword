import { useMemo, useState } from 'react';
import { Globe, Plus, Edit2, Trash2, X } from 'lucide-react';
import SecurePasswordInput from './SecurePasswordInput';

const departmentOptions = [
  'Comercial',
  'Contabilidade',
  'ERP',
  'Financeiro',
  'Fiscal',
  'Gerencia',
  'Outro',
  'RH',
  'Sistema',
  'Suporte',
  'Vendas'
];

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const emptyCpanel = () => ({
  id: makeId(),
  domain: '',
  url: '',
  username: '',
  password: '',
  notes: ''
});

const emptyCpanelUser = (cpanelId = '') => ({
  id: makeId(),
  cpanelId,
  name: '',
  login: '',
  password: '',
  department: 'Sistema'
});

const normalizeCpanelForm = (data = {}) => {
  if (Array.isArray(data.cpanels) || Array.isArray(data.users)) {
    return {
      cpanels: Array.isArray(data.cpanels)
        ? data.cpanels.map((item) => ({
            id: item.id || makeId(),
            domain: item.domain || item.url || '',
            url: item.url || '',
            username: item.username || '',
            password: item.password || '',
            notes: item.notes || ''
          }))
        : [],
      users: Array.isArray(data.users)
        ? data.users.map((user) => ({
            id: user.id || makeId(),
            cpanelId: user.cpanelId || '',
            name: user.name || '',
            login: user.login || user.username || '',
            password: user.password || '',
            department: user.department || user.type || 'Sistema'
          }))
        : []
    };
  }

  const legacyCpanelId = data.url || data.username || data.email ? `legacy-cpanel-${makeId()}` : '';
  const legacyCpanel = legacyCpanelId
    ? [{
        id: legacyCpanelId,
        domain: data.url || 'cPanel principal',
        url: data.url || '',
        username: data.username || '',
        password: data.password || '',
        notes: data.isSystem === false ? 'Acesso pessoa física' : 'Acesso sistema'
      }]
    : [];

  const legacyUser = data.email
    ? [{
        id: `legacy-user-${makeId()}`,
        cpanelId: legacyCpanelId,
        name: data.email,
        login: data.email,
        password: data.emailPassword || '',
        department: data.isSystem === false ? 'Outro' : 'Sistema'
      }]
    : [];

  return {
    cpanels: legacyCpanel,
    users: legacyUser
  };
};

export default function CpanelWebManager({ cpanelForm, setCpanelForm, handleSaveData, isSaving }) {
  const normalizedForm = useMemo(() => normalizeCpanelForm(cpanelForm), [cpanelForm]);
  const [cpanelDraft, setCpanelDraft] = useState(emptyCpanel());
  const [userDraft, setUserDraft] = useState(emptyCpanelUser());
  const [editingCpanel, setEditingCpanel] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [deleteCpanelConfirmation, setDeleteCpanelConfirmation] = useState('');
  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');
  const [userSearch, setUserSearch] = useState('');

  const getCpanelLabel = (cpanelId) => {
    const cpanel = normalizedForm.cpanels.find((item) => item.id === cpanelId);
    if (!cpanel) return 'cPanel / domínio não informado';
    return cpanel.domain || cpanel.url || 'cPanel / domínio sem nome';
  };

  const persistCpanelForm = async (nextForm, successMessage) => {
    const saved = await handleSaveData('cPanel', nextForm, { successMessage });
    if (saved) setCpanelForm(nextForm);
    return saved;
  };

  const addCpanel = async () => {
    if (!cpanelDraft.domain.trim() && !cpanelDraft.url.trim()) {
      alert('Informe pelo menos o domínio ou a URL do cPanel.');
      return;
    }
    if (!cpanelDraft.username.trim()) {
      alert('Informe o usuário do cPanel.');
      return;
    }

    const newCpanel = { ...cpanelDraft, id: makeId() };
    const nextForm = {
      ...normalizedForm,
      cpanels: [newCpanel, ...normalizedForm.cpanels]
    };

    const saved = await persistCpanelForm(nextForm, 'cPanel / domínio cadastrado e salvo automaticamente no cofre.');
    if (saved) {
      setCpanelDraft(emptyCpanel());
      setUserDraft((current) => ({ ...current, cpanelId: current.cpanelId || newCpanel.id }));
    }
  };

  const saveEditedCpanel = async () => {
    if (!editingCpanel.domain.trim() && !editingCpanel.url.trim()) {
      alert('Informe pelo menos o domínio ou a URL do cPanel.');
      return;
    }
    if (!editingCpanel.username.trim()) {
      alert('Informe o usuário do cPanel.');
      return;
    }

    const nextForm = {
      ...normalizedForm,
      cpanels: normalizedForm.cpanels.map((item) => item.id === editingCpanel.id ? editingCpanel : item)
    };

    const saved = await persistCpanelForm(nextForm, 'cPanel / domínio atualizado e salvo no cofre.');
    if (saved) {
      setEditingCpanel(null);
      setDeleteCpanelConfirmation('');
    }
  };

  const deleteEditedCpanel = async () => {
    if (deleteCpanelConfirmation !== 'EXCLUIR') {
      alert('Para confirmar a exclusão, escreva EXCLUIR no campo de confirmação.');
      return;
    }

    const nextForm = {
      cpanels: normalizedForm.cpanels.filter((item) => item.id !== editingCpanel.id),
      users: normalizedForm.users.map((user) => user.cpanelId === editingCpanel.id ? { ...user, cpanelId: '' } : user)
    };

    const saved = await persistCpanelForm(nextForm, 'cPanel / domínio excluído e cofre atualizado.');
    if (saved) {
      setEditingCpanel(null);
      setDeleteCpanelConfirmation('');
    }
  };

  const addCpanelUser = async () => {
    if (!userDraft.cpanelId) {
      alert('Selecione o cPanel / domínio ao qual este usuário pertence.');
      return;
    }
    if (!userDraft.name.trim() || !userDraft.login.trim()) {
      alert('Informe o nome e o login do usuário.');
      return;
    }

    const newUser = { ...userDraft, id: makeId() };
    const nextForm = {
      ...normalizedForm,
      users: [newUser, ...normalizedForm.users]
    };

    const saved = await persistCpanelForm(nextForm, 'Usuário cadastrado e salvo automaticamente no cofre.');
    if (saved) setUserDraft(emptyCpanelUser(userDraft.cpanelId));
  };

  const saveEditedUser = async () => {
    if (!editingUser.cpanelId) {
      alert('Selecione o cPanel / domínio ao qual este usuário pertence.');
      return;
    }
    if (!editingUser.name.trim() || !editingUser.login.trim()) {
      alert('Informe o nome e o login do usuário.');
      return;
    }

    const nextForm = {
      ...normalizedForm,
      users: normalizedForm.users.map((user) => user.id === editingUser.id ? editingUser : user)
    };

    const saved = await persistCpanelForm(nextForm, 'Usuário atualizado e salvo no cofre.');
    if (saved) {
      setEditingUser(null);
      setDeleteUserConfirmation('');
    }
  };

  const deleteEditedUser = async () => {
    if (deleteUserConfirmation !== 'EXCLUIR') {
      alert('Para confirmar a exclusão, escreva EXCLUIR no campo de confirmação.');
      return;
    }

    const nextForm = {
      ...normalizedForm,
      users: normalizedForm.users.filter((user) => user.id !== editingUser.id)
    };

    const saved = await persistCpanelForm(nextForm, 'Usuário excluído e cofre atualizado.');
    if (saved) {
      setEditingUser(null);
      setDeleteUserConfirmation('');
    }
  };

  const filteredUsers = normalizedForm.users.filter((user) => {
    const search = userSearch.trim().toLowerCase();
    if (!search) return true;

    return [
      user.name,
      user.login,
      user.department,
      getCpanelLabel(user.cpanelId)
    ].join(' ').toLowerCase().includes(search);
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <h3 className="text-lg font-medium text-slate-900 mb-4">Cadastro de cPanel / domínio</h3>
        <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Domínio</label>
            <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={cpanelDraft.domain} onChange={(e) => setCpanelDraft({ ...cpanelDraft, domain: e.target.value })} placeholder="dominio.com.br" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">URL do cPanel</label>
            <input type="url" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={cpanelDraft.url} onChange={(e) => setCpanelDraft({ ...cpanelDraft, url: e.target.value })} placeholder="https://cpanel.dominio.com.br" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Usuário cPanel</label>
            <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={cpanelDraft.username} onChange={(e) => setCpanelDraft({ ...cpanelDraft, username: e.target.value })} />
          </div>
          <div className="sm:col-span-2 max-w-md">
            <SecurePasswordInput name="new_cpanel_password" label="Senha cPanel" value={cpanelDraft.password} onChange={(e) => setCpanelDraft({ ...cpanelDraft, password: e.target.value })} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="block text-sm font-medium text-slate-700 mb-1">Observações</label>
            <textarea rows={2} className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={cpanelDraft.notes} onChange={(e) => setCpanelDraft({ ...cpanelDraft, notes: e.target.value })} placeholder="Observações do domínio / hospedagem"></textarea>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" disabled={isSaving} onClick={addCpanel} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="w-4 h-4 mr-2" /> {isSaving ? 'Salvando...' : 'Adicionar cPanel / domínio'}
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {normalizedForm.cpanels.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum cPanel / domínio cadastrado.</p>
          ) : normalizedForm.cpanels.map((cpanel) => (
            <div key={cpanel.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg p-4">
              <div className="space-y-1">
                <p className="font-medium text-slate-900">{cpanel.domain || 'Domínio sem nome'}</p>
                <p className="text-sm text-slate-500">URL: {cpanel.url || '-'} | Usuário: {cpanel.username || '-'}</p>
              </div>
              <button type="button" onClick={() => { setEditingCpanel({ ...cpanel }); setDeleteCpanelConfirmation(''); }} className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-700 bg-white hover:bg-slate-50">
                <Edit2 className="w-4 h-4 mr-2" /> Detalhes
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <h3 className="text-lg font-medium text-slate-900 mb-4">Cadastro de usuários</h3>
        <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
            <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={userDraft.name} onChange={(e) => setUserDraft({ ...userDraft, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Login</label>
            <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={userDraft.login} onChange={(e) => setUserDraft({ ...userDraft, login: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">cPanel / domínio</label>
            <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={userDraft.cpanelId} onChange={(e) => setUserDraft({ ...userDraft, cpanelId: e.target.value })}>
              <option value="">Selecione...</option>
              {normalizedForm.cpanels.map((cpanel) => (
                <option key={cpanel.id} value={cpanel.id}>{cpanel.domain || cpanel.url}</option>
              ))}
            </select>
          </div>
          <div className="max-w-md">
            <SecurePasswordInput name="new_cpanel_user_password" label="Senha do usuário" value={userDraft.password} onChange={(e) => setUserDraft({ ...userDraft, password: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Departamento</label>
            <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={userDraft.department} onChange={(e) => setUserDraft({ ...userDraft, department: e.target.value })}>
              {departmentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" disabled={isSaving} onClick={addCpanelUser} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="w-4 h-4 mr-2" /> {isSaving ? 'Salvando...' : 'Adicionar usuário'}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Pesquisar usuário</label>
        <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" placeholder="Buscar por nome, login, departamento ou domínio..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <h3 className="text-lg font-medium text-slate-900 mb-4">Usuários cadastrados</h3>
        <div className="space-y-3">
          {filteredUsers.length === 0 ? (
            <p className="text-sm text-slate-500">{userSearch.trim() ? 'Nenhum usuário encontrado.' : 'Nenhum usuário cadastrado.'}</p>
          ) : filteredUsers.map((user) => (
            <div key={user.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg p-4">
              <div className="space-y-1">
                <p className="font-medium text-slate-900">{user.name || 'Usuário sem nome'}</p>
                <p className="text-sm text-slate-500">Login: {user.login || '-'} | Departamento: {user.department || '-'}</p>
                <p className="text-xs text-slate-500">cPanel / domínio: {getCpanelLabel(user.cpanelId)}</p>
              </div>
              <button type="button" onClick={() => { setEditingUser({ ...user }); setDeleteUserConfirmation(''); }} className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-700 bg-white hover:bg-slate-50">
                <Edit2 className="w-4 h-4 mr-2" /> Detalhes
              </button>
            </div>
          ))}
        </div>
      </div>

      {editingCpanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Detalhes do cPanel / domínio</h3>
              <button type="button" onClick={() => setEditingCpanel(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Domínio</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editingCpanel.domain} onChange={(e) => setEditingCpanel({ ...editingCpanel, domain: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">URL do cPanel</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editingCpanel.url} onChange={(e) => setEditingCpanel({ ...editingCpanel, url: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Usuário</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editingCpanel.username} onChange={(e) => setEditingCpanel({ ...editingCpanel, username: e.target.value })} />
                </div>
                <div className="max-w-md">
                  <SecurePasswordInput name={`edit_cpanel_password_${editingCpanel.id}`} label="Senha" value={editingCpanel.password} onChange={(e) => setEditingCpanel({ ...editingCpanel, password: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Observações</label>
                  <textarea rows={3} className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editingCpanel.notes} onChange={(e) => setEditingCpanel({ ...editingCpanel, notes: e.target.value })}></textarea>
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <label className="block text-sm font-medium text-red-700 mb-1">Para excluir este cPanel / domínio, escreva EXCLUIR</label>
                <input type="text" className="w-full border-red-200 rounded-md shadow-sm p-2 border" value={deleteCpanelConfirmation} onChange={(e) => setDeleteCpanelConfirmation(e.target.value)} placeholder="EXCLUIR" />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
              <button type="button" disabled={isSaving} onClick={deleteEditedCpanel} className="inline-flex items-center justify-center px-4 py-2 border border-red-200 rounded-md text-sm font-medium text-red-600 bg-white hover:bg-red-50 disabled:opacity-50"><Trash2 className="w-4 h-4 mr-2" /> Excluir</button>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setEditingCpanel(null)} className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">Cancelar</button>
                <button type="button" disabled={isSaving} onClick={saveEditedCpanel} className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar alterações'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Detalhes do usuário</h3>
              <button type="button" onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editingUser.name} onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Login</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editingUser.login} onChange={(e) => setEditingUser({ ...editingUser, login: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">cPanel / domínio</label>
                  <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={editingUser.cpanelId} onChange={(e) => setEditingUser({ ...editingUser, cpanelId: e.target.value })}>
                    <option value="">Selecione...</option>
                    {normalizedForm.cpanels.map((cpanel) => <option key={cpanel.id} value={cpanel.id}>{cpanel.domain || cpanel.url}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Departamento</label>
                  <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={editingUser.department} onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}>
                    {departmentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2 max-w-md">
                  <SecurePasswordInput name={`edit_cpanel_user_password_${editingUser.id}`} label="Senha" value={editingUser.password} onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })} />
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <label className="block text-sm font-medium text-red-700 mb-1">Para excluir este usuário, escreva EXCLUIR</label>
                <input type="text" className="w-full border-red-200 rounded-md shadow-sm p-2 border" value={deleteUserConfirmation} onChange={(e) => setDeleteUserConfirmation(e.target.value)} placeholder="EXCLUIR" />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
              <button type="button" disabled={isSaving} onClick={deleteEditedUser} className="inline-flex items-center justify-center px-4 py-2 border border-red-200 rounded-md text-sm font-medium text-red-600 bg-white hover:bg-red-50 disabled:opacity-50"><Trash2 className="w-4 h-4 mr-2" /> Excluir</button>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setEditingUser(null)} className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">Cancelar</button>
                <button type="button" disabled={isSaving} onClick={saveEditedUser} className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar alterações'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
