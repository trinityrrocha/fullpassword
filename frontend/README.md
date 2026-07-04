# FullPassword Frontend - React UI

## Visão Geral

O frontend do FullPassword é construído com React (Vite), Tailwind CSS e focado em fornecer uma interface limpa, segura e responsiva para Managed Service Providers (MSPs). Esta estrutura prepara o terreno para a implementação da criptografia Zero-Knowledge.

## Stack Tecnológica

- **Framework**: React 18 + Vite
- **Estilização**: Tailwind CSS
- **Ícones**: Lucide-React
- **Roteamento**: React Router DOM
- **Requisições**: Axios

## Estrutura de Pastas

```
frontend/
├── src/
│   ├── components/
│   │   └── SecurePasswordInput.jsx  # Componente base para senhas
│   ├── layouts/
│   │   └── DashboardLayout.jsx      # Layout com Sidebar e navegação
│   ├── pages/
│   │   ├── Login.jsx                # Tela pública de autenticação
│   │   ├── ClientsList.jsx          # Lista de clientes
│   │   └── ClientVault.jsx          # Cofre do cliente (Abas dinâmicas)
│   ├── App.jsx                      # Configuração de rotas
│   ├── index.css                    # Configuração Tailwind
│   └── main.jsx                     # Entry point
├── tailwind.config.js
├── vite.config.js
└── Dockerfile
```

## Componentes Principais

### SecurePasswordInput
Um componente crucial para a segurança visual do sistema.
- Mascara a senha por padrão
- Ícone "Olho" para revelar/ocultar
- Ícone "Copiar" que salva na área de transferência (clipboard) sem precisar revelar a senha na tela

### ClientVault (O Cofre)
Página principal onde os dados sensíveis são gerenciados. Dividida em 4 abas:
1. **cPanel**: Gestão de hospedagem e e-mail
2. **VPN**: Acessos de rede com diferentes protocolos
3. **Servidor TS**: Acessos remotos (Windows/Linux) com adição dinâmica de múltiplos usuários
4. **Servidores Diversos**: Anotações livres e upload de arquivos para criptografia

## Preparação para Criptografia (Zero-Knowledge)

A página `ClientVault.jsx` já possui os estados (`useState`) configurados para agrupar todos os dados de cada formulário em objetos JSON. 

A função `handleSaveData` está documentada com os passos exatos onde a criptografia Client-Side (AES-256-GCM) será injetada na Etapa 5, garantindo que o payload (`encrypted_data`) seja gerado antes de qualquer comunicação com o Axios.

## Como Executar

```bash
# Instalar dependências
npm install

# Iniciar servidor de desenvolvimento
npm run dev
```
