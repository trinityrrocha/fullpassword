import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Search, Plus, ChevronRight, Lock, X } from 'lucide-react';

export default function ClientsList() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newClient, setNewClient] = useState({
    name: '',
    address: '',
    phone: '',
    email: ''
  });

  // Mock de clientes (será substituído por chamada à API)
  const mockClients = [
    { id: '1', name: 'Acme Corp', address: 'Av. Paulista, 1000 - SP', itemsCount: 12 },
    { id: '2', name: 'Tech Solutions', address: 'Rua das Flores, 123 - RJ', itemsCount: 5 },
    { id: '3', name: 'Global Industries', address: 'Setor Comercial Sul - DF', itemsCount: 28 },
    { id: '4', name: 'StartUp Innovate', address: 'Av. Rio Branco, 500 - SP', itemsCount: 3 },
  ];

  const filteredClients = mockClients.filter(client => 
    client.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreateClient = async (e) => {
    e.preventDefault();
    // TODO: Implementar chamada à API
    // await api.post('/clients', newClient);
    console.log('Novo cliente:', newClient);
    alert('Cliente criado com sucesso! (Simulação)');
    setIsModalOpen(false);
    setNewClient({ name: '', address: '', phone: '', email: '' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
          <p className="text-sm text-slate-500">Selecione um cliente para acessar seu cofre de senhas</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          <Plus className="w-4 h-4 mr-2" />
          Novo Cliente
        </button>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden border border-slate-200">
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <div className="relative rounded-md shadow-sm max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md p-2 border"
              placeholder="Buscar cliente por nome..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <ul className="divide-y divide-slate-200">
          {filteredClients.map((client) => (
            <li key={client.id}>
              <Link 
                to={`/client/${client.id}`}
                className="block hover:bg-slate-50 transition-colors"
              >
                <div className="px-4 py-4 sm:px-6 flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10 rounded-md bg-indigo-100 flex items-center justify-center">
                      <Building2 className="h-6 w-6 text-indigo-600" />
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-indigo-600 truncate">{client.name}</div>
                      <div className="text-sm text-slate-500 truncate">{client.address}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="hidden sm:flex items-center text-sm text-slate-500">
                      <Lock className="flex-shrink-0 mr-1.5 h-4 w-4 text-slate-400" />
                      {client.itemsCount} itens no cofre
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-400" />
                  </div>
                </div>
              </Link>
            </li>
          ))}
          {filteredClients.length === 0 && (
            <li className="px-4 py-8 text-center text-slate-500">
              Nenhum cliente encontrado com a busca "{searchTerm}".
            </li>
          )}
        </ul>
      </div>

      {/* Modal Novo Cliente */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            
            {/* Background overlay */}
            <div className="fixed inset-0 bg-slate-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setIsModalOpen(false)}></div>

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

            {/* Modal panel */}
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex justify-between items-center mb-5">
                  <h3 className="text-lg leading-6 font-medium text-slate-900" id="modal-title">
                    Cadastrar Novo Cliente
                  </h3>
                  <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-500">
                    <X className="h-6 w-6" />
                  </button>
                </div>
                
                <form id="newClientForm" onSubmit={handleCreateClient} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome da Empresa</label>
                    <input 
                      type="text" 
                      required
                      className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                      value={newClient.name}
                      onChange={e => setNewClient({...newClient, name: e.target.value})}
                      placeholder="Ex: Acme Corp"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Endereço Completo</label>
                    <input 
                      type="text" 
                      className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                      value={newClient.address}
                      onChange={e => setNewClient({...newClient, address: e.target.value})}
                      placeholder="Rua, Número, Bairro, Cidade - UF"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Telefone</label>
                      <input 
                        type="text" 
                        className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                        value={newClient.phone}
                        onChange={e => setNewClient({...newClient, phone: e.target.value})}
                        placeholder="(00) 0000-0000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">E-mail de Contato</label>
                      <input 
                        type="email" 
                        className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                        value={newClient.email}
                        onChange={e => setNewClient({...newClient, email: e.target.value})}
                        placeholder="contato@empresa.com.br"
                      />
                    </div>
                  </div>
                </form>
              </div>
              <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button 
                  type="submit" 
                  form="newClientForm"
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Salvar Cliente
                </button>
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
