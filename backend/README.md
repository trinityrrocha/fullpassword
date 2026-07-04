# FullPassword Backend - Documentação

## Visão Geral

O backend do FullPassword é uma aplicação Node.js/Express que implementa uma API segura para gerenciamento de senhas e credenciais, seguindo a arquitetura **Zero-Knowledge**. O backend atua como um "entregador de pacotes selados", nunca descriptografando dados sensíveis.

## Arquitetura e Segurança

### Zero-Knowledge Architecture

O backend **NUNCA** realiza descriptografia ou tem acesso a senhas em texto claro. Toda a criptografia (AES-256-GCM) e derivação de chaves (Argon2id) é feita no Frontend (Client-Side Encryption) antes do envio ao servidor.

### Segurança Implementada

- **Helmet**: Proteção de headers HTTP contra ataques comuns
- **CORS**: Controle de origem para requisições do frontend
- **JWT**: Autenticação baseada em tokens com expiração configurável
- **Argon2id**: Hash de senhas de login com algoritmo resistente a ataques
- **Validação de Acesso**: Verificação de permissões por grupo para clientes e cofre

## Instalação e Setup

### Pré-requisitos

- Node.js 20+ instalado
- PostgreSQL 15+ rodando
- Variáveis de ambiente configuradas

### Passos de Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Copiar arquivo de exemplo de ambiente
cp .env.example .env

# 3. Configurar as variáveis no arquivo .env
# Editar .env com as credenciais do banco de dados

# 4. Iniciar o servidor (desenvolvimento)
npm run dev

# 5. Ou iniciar em produção
npm start
```

## Variáveis de Ambiente (.env)

```env
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=fullpassword_user
DB_PASSWORD=fullpassword_pass
DB_NAME=fullpassword_db

# JWT
JWT_SECRET=sua_chave_secreta_super_segura_aqui
JWT_EXPIRES_IN=8h
```

## Estrutura de Pastas

```
backend/
├── src/
│   ├── config/
│   │   └── database.js          # Configuração do PostgreSQL
│   ├── controllers/
│   │   ├── authController.js    # Lógica de autenticação
│   │   ├── clientController.js  # Lógica de clientes
│   │   └── vaultController.js   # Lógica do cofre
│   ├── middleware/
│   │   └── authMiddleware.js    # Verificação de JWT
│   ├── routes/
│   │   ├── authRoutes.js        # Rotas de autenticação
│   │   ├── clientRoutes.js      # Rotas de clientes
│   │   └── vaultRoutes.js       # Rotas do cofre
│   └── server.js                # Arquivo principal do Express
├── package.json
├── Dockerfile
├── .env.example
└── README.md
```

## Endpoints da API

### Autenticação

#### POST /api/auth/login
Realiza login do usuário e retorna um token JWT.

**Request:**
```json
{
  "email": "admin@admin.com.br",
  "password": "@dmin123"
}
```

**Response (200):**
```json
{
  "message": "Login realizado com sucesso",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "name": "Administrador do Sistema",
    "email": "admin@admin.com.br",
    "role": "admin"
  }
}
```

**Response (401):**
```json
{
  "error": "Credenciais inválidas"
}
```

---

### Clientes

#### GET /api/clients
Lista os clientes permitidos para o grupo do usuário logado.

**Headers:**
```
Authorization: Bearer {token}
```

**Response (200):**
```json
[
  {
    "id": "uuid",
    "name": "Cliente A",
    "address": "Rua X, 123",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
]
```

**Response (401):**
```json
{
  "error": "Acesso negado. Token não fornecido ou em formato inválido."
}
```

---

#### POST /api/clients
Cadastra um novo cliente.

**Headers:**
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Request:**
```json
{
  "name": "Novo Cliente",
  "address": "Rua Y, 456",
  "group_ids": ["uuid-do-grupo-1", "uuid-do-grupo-2"]
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "name": "Novo Cliente",
  "address": "Rua Y, 456",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

---

### Cofre (Vault)

#### GET /api/vault-items/:clientId
Retorna os itens do cofre (dados criptografados) de um cliente específico.

**Headers:**
```
Authorization: Bearer {token}
```

**Response (200):**
```json
[
  {
    "id": "uuid",
    "category": "cPanel",
    "encrypted_data": "{dados_criptografados_em_json}",
    "encrypted_attachment": "{arquivo_base64_criptografado}",
    "metadata": {
      "descricao": "cPanel do Cliente A",
      "data_criacao": "2024-01-15"
    },
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
]
```

**Response (403):**
```json
{
  "error": "Acesso negado a este cliente"
}
```

---

#### POST /api/vault-items/:clientId
Salva um novo bloco de dados no cofre.

**Headers:**
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Request:**
```json
{
  "category": "cPanel",
  "encrypted_data": "{dados_criptografados_em_json}",
  "encrypted_attachment": "{arquivo_base64_criptografado}",
  "metadata": {
    "descricao": "cPanel do Cliente A",
    "data_criacao": "2024-01-15"
  }
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "category": "cPanel",
  "metadata": {
    "descricao": "cPanel do Cliente A",
    "data_criacao": "2024-01-15"
  },
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

## Fluxo de Autenticação

1. **Login**: Usuário envia email e senha para `/api/auth/login`
2. **Verificação**: Backend valida credenciais com Argon2id
3. **Token JWT**: Backend retorna token com expiração
4. **Requisições Autenticadas**: Cliente inclui token no header `Authorization: Bearer {token}`
5. **Middleware**: `verifyToken` valida o token em cada requisição protegida

## Fluxo de Acesso a Dados

1. **Permissão**: Usuário só acessa clientes/cofre dos grupos aos quais pertence
2. **Dados Criptografados**: Backend retorna `encrypted_data` sem descriptografar
3. **Descriptografia no Frontend**: Frontend descriptografa usando chave local do usuário
4. **Zero-Knowledge**: Backend nunca tem acesso a dados sensíveis em texto claro

## Desenvolvimento

### Scripts Disponíveis

```bash
# Iniciar em desenvolvimento (com hot-reload)
npm run dev

# Iniciar em produção
npm start
```

### Dependências Principais

| Pacote | Versão | Propósito |
|--------|--------|----------|
| express | ^4.19.2 | Framework web |
| pg | ^8.11.5 | Driver PostgreSQL |
| jsonwebtoken | ^9.0.2 | Geração e verificação de JWT |
| argon2 | ^0.40.1 | Hash de senhas |
| helmet | ^7.1.0 | Segurança de headers |
| cors | ^2.8.5 | Controle de origem |
| dotenv | ^16.4.5 | Variáveis de ambiente |

## Considerações de Produção

1. **JWT_SECRET**: Usar uma chave forte e aleatória em produção
2. **HTTPS**: Sempre usar HTTPS em produção
3. **Rate Limiting**: Implementar rate limiting para proteger contra brute force
4. **Logging**: Implementar logging estruturado para auditoria
5. **Backup**: Fazer backup regular do banco de dados
6. **Monitoramento**: Monitorar performance e erros em tempo real

## Troubleshooting

### Erro de Conexão com Banco de Dados

Verificar se o PostgreSQL está rodando e as credenciais estão corretas no `.env`.

### Token Expirado

O frontend deve fazer login novamente quando receber erro 401 com mensagem "Token expirado".

### Acesso Negado ao Cliente/Cofre

Verificar se o usuário pertence a um grupo que tem acesso ao cliente.

## Suporte

Para dúvidas ou problemas, consulte a documentação do projeto principal ou abra uma issue no repositório.
