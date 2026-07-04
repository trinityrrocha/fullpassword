import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Search, Plus, ChevronRight, Lock } from 'lucide-react';

export default function ClientsList() {
  const [searchTerm, setSearchTerm] = useState('');

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
          <p className="text-sm text-slate-500">Selecione um cliente para acessar seu cofre de senhas</p>
        </div>
        <button className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
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
    </div>
  );
}
