# FullPassword - Cofre Zero-Knowledge para MSPs e equipes de TI

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.1-green.svg)
![Node.js](https://img.shields.io/badge/node.js-18+-brightgreen.svg)
![React](https://img.shields.io/badge/react-18+-blue.svg)

**FullPassword** é um cofre de credenciais para MSPs, equipes de TI e prestadores de suporte técnico. O sistema organiza acessos por cliente/cofre e mantém os dados sensíveis criptografados no navegador usando a **Web Crypto API**.

O projeto evoluiu para suportar **múltiplos usuários**, **grupos**, **permissões granulares**, **compartilhamento criptográfico de cofres** e separação entre permissões de **visualizar**, **editar**, **adicionar** e **excluir**.

## 🎯 Características Principais

### 🔐 Segurança e Criptografia

- **Arquitetura Zero-Knowledge**: dados sensíveis criptografados no navegador.
- **AES-256-GCM**: criptografia simétrica usando Web Crypto API.
- **PBKDF2**: derivação da Master Key a partir da senha mestre do usuário.
- **RSA-OAEP por usuário**: usado para compartilhar chaves de cofre entre usuários autorizados.
- **Chave própria por cofre**: os dados do cofre são criptografados com uma chave do próprio cofre.
- **Back-end sem acesso ao texto claro**: API e banco armazenam apenas dados criptografados.
- **JWT Authentication**: autenticação com token e sessão controlada.
- **Argon2id**: hashing seguro das senhas de login no back-end.

### 👥 Usuários, Grupos e Permissões

- **Gestão de usuários**: cadastro, edição, ativação/inativação e vínculo com grupos.
- **Gestão de grupos**: grupos administrativos com permissões herdadas nos cofres compartilhados.
- **Permissões granulares por grupo**:
  - Visualizar
  - Editar
  - Adicionar
  - Excluir
- **Compartilhamento por grupo**: o cofre define quais grupos têm acesso; o grupo define o nível de permissão.
- **Modo somente leitura**: usuários com permissão apenas de visualização conseguem ver e copiar dados, mas não conseguem alterar campos.
- **Bloqueio de ações por permissão**: usuários sem permissão de adicionar ou excluir têm esses botões bloqueados no front-end e também são protegidos pelo back-end.

### 📊 Funcionalidades para MSPs

- **Gestão de Clientes/Cofres**: organização das credenciais por cliente.
- **Abas operacionais**:
  - cPanel / Web
  - VPN
  - Windows Server / Terminal Server
  - Linux Server
  - Servidores Diversos
  - Compartilhamento
- **Senhas copiáveis e visualizáveis**: botões para mostrar/ocultar e copiar senhas.
- **Anexos criptografados**: suporte a arquivos protegidos no cofre.
- **Interface responsiva**: frontend em React com Tailwind CSS.
- **Controle administrativo**: permissões especiais para administradores e donos de cofres.

### 🚀 Deploy e Operação

- **Docker Compose**: backend, frontend, banco PostgreSQL e Nginx containerizados.
- **Nginx Proxy Reverso**: publicação HTTP/HTTPS do sistema.
- **PostgreSQL**: banco relacional para usuários, grupos, cofres e metadados criptográficos.
- **Let's Encrypt**: suporte a certificado SSL/TLS.
- **Script de instalação**: instalação automatizada em VPS Linux.

## 📋 Stack Tecnológico

| Componente | Tecnologia | Versão/Requisito |
|-----------|------------|------------------|
| **Backend** | Node.js + Express | 18+ |
| **Frontend** | React + Vite | React 18+ |
| **Banco de Dados** | PostgreSQL | 15+ |
| **Criptografia** | Web Crypto API | Nativa do navegador |
| **Estilização** | Tailwind CSS | 3+ |
| **Containerização** | Docker + Docker Compose | Atual |
| **Proxy Reverso** | Nginx | Atual |
| **SSL/TLS** | Let's Encrypt + Certbot | Atual |

## 🚀 Quick Start

### Pré-requisitos

> [!CAUTION]
> **Atenção: valide estes pré-requisitos antes da instalação para evitar erro no deploy.**
>
> - 🟡 **VPS com Ubuntu 20.04/22.04 LTS ou Debian 11/12**
> - 🟡 **Domínio apontando para o IP da VPS (DNS A record)**
> - 🟡 **Acesso SSH como root**

### Instalação em 3 Passos

```bash
# 1. Acesse a VPS
ssh root@seu_ip_da_vps

# 2. Baixe e execute o script
wget https://raw.githubusercontent.com/trinityrrocha/fullpassword/main/scripts/install.sh
chmod +x install.sh
./install.sh
```

O script solicitará:

- Domínio, exemplo: `cofre.suaempresa.com.br`
- E-mail para Let's Encrypt, também usado como e-mail inicial do Super Admin
- Porta SSH, caso esteja customizada

O instalador gera uma senha temporária forte, cria automaticamente o primeiro usuário com a flag persistente `is_super_admin=true` e salva as informações iniciais em `/root/fullpassword-install-info.txt` com permissão `600`.

Após a conclusão, acesse:

```text
https://seu-dominio.com.br
```

> No primeiro login, o Super Admin deve obrigatoriamente trocar a senha temporária antes de usar o sistema.

## 🔁 Atualização em Produção

O acesso por SSH faz parte apenas da primeira instalação. Depois que o instalador conclui, o fluxo oficial de atualização é exclusivamente pelo painel, usando o **WebUpdater**, e permanece restrito ao usuário com `is_super_admin=true`.

1. Acesse o FullPassword pelo navegador.
2. Entre com o Super Admin.
3. Abra **Configurações do Sistema > WebUpdater**.
4. Execute a verificação de atualização.
5. Confirme a atualização pelo painel.
6. Aguarde o processo concluir e pressione `Ctrl + F5` no navegador.

Não use `git pull`, rebuild manual ou configuração recorrente por terminal como rotina operacional. O WebUpdater executa a sincronização do código, a reconstrução dos containers e o reinício dos serviços necessários.

## 📚 Documentação

- **[PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)** - Guia resumido de produção.
- **[DEPLOY.md](./DEPLOY.md)** - Guia detalhado de deploy.
- **[frontend/README.md](./frontend/README.md)** - Documentação do frontend.
- **[frontend/CRYPTO_IMPLEMENTATION.md](./frontend/CRYPTO_IMPLEMENTATION.md)** - Detalhes da criptografia.
- **[backend/README.md](./backend/README.md)** - Documentação da API.

## 🏗️ Estrutura do Projeto

```text
fullpassword/
├── backend/                 # Node.js + Express
│   ├── src/
│   │   ├── config/          # Configurações e banco de dados
│   │   ├── controllers/     # Lógica de negócio
│   │   ├── middleware/      # Autenticação e validação
│   │   ├── routes/          # Rotas da API
│   │   ├── services/        # Serviços auxiliares e controle de acesso
│   │   └── server.js        # Entrada principal
│   ├── Dockerfile
│   └── package.json
├── frontend/                # React + Vite
│   ├── src/
│   │   ├── components/      # Componentes reutilizáveis
│   │   ├── context/         # AuthContext
│   │   ├── pages/           # Páginas principais
│   │   ├── services/        # API, criptografia e chaves de cofre
│   │   └── App.jsx          # Entrada principal
│   ├── Dockerfile
│   └── package.json
├── database/
│   └── init.sql             # Schema inicial e ajustes idempotentes
├── docker/
│   └── nginx.conf           # Configuração do Nginx
├── scripts/
│   └── install.sh           # Script de instalação
├── docker-compose.yml       # Orquestração dos containers
└── README.md                # Este arquivo
```

## 🔐 Arquitetura Zero-Knowledge e Compartilhamento

```text
Usuário
├─ Master Key derivada/desenvelopada no navegador
├─ Chaves RSA do usuário
│  ├─ public_key
│  └─ encrypted_private_key

Cofre do cliente
├─ clientVaultKey própria do cofre
├─ Dados criptografados com clientVaultKey
└─ client_key_shares
   ├─ clientVaultKey criptografada para usuário A
   ├─ clientVaultKey criptografada para usuário B
   └─ clientVaultKey criptografada para usuários autorizados
```

Fluxo resumido:

1. O usuário desbloqueia o cofre com sua senha mestre.
2. O navegador recupera ou gera a chave criptográfica do cofre.
3. Os dados do cofre são descriptografados localmente.
4. Ao compartilhar com um grupo, a chave do cofre é criptografada para os usuários autorizados.
5. O back-end armazena apenas dados e chaves criptografadas.

**Resultado**: o back-end não manipula credenciais em texto claro e o compartilhamento respeita as permissões definidas nos grupos.

## 🛡️ Segurança Implementada

- ✅ Criptografia AES-256-GCM no navegador.
- ✅ Derivação de chave com PBKDF2.
- ✅ Chaves RSA-OAEP por usuário para compartilhamento criptográfico.
- ✅ Chave própria por cofre para permitir compartilhamento seguro.
- ✅ Hash de senha com Argon2id.
- ✅ Autenticação JWT.
- ✅ Controle de acesso no back-end por cofre, grupo e permissão.
- ✅ Bloqueios visuais no front-end conforme permissões.
- ✅ Armazenamento de dados sensíveis apenas em formato criptografado.
- ✅ Suporte a SSL/TLS com Let's Encrypt.

## 🔑 Modelo de Permissões

As permissões são definidas no **Grupo** e aplicadas aos cofres compartilhados com esse grupo.

| Permissão | Comportamento esperado |
|----------|-------------------------|
| **Visualizar** | Permite abrir o cofre, visualizar dados, mostrar/ocultar senhas e copiar informações. |
| **Editar** | Permite alterar dados existentes e salvar alterações. |
| **Adicionar** | Permite criar novos registros dentro do cofre. |
| **Excluir** | Permite excluir/remover registros do cofre. |

Regras principais:

- Um usuário só vê cofres compartilhados com grupos aos quais ele pertence.
- Dono do cofre e administradores possuem controle total.
- Usuários somente leitura não conseguem digitar, adicionar, salvar nem excluir.
- Usuários com edição, mas sem adicionar/excluir, podem salvar alterações existentes, mas não podem criar nem remover registros.

## 🤝 Como Contribuir

Contribuições são bem-vindas. Fluxo recomendado:

```bash
git clone https://github.com/trinityrrocha/fullpassword.git
cd fullpassword
git checkout -b feature/sua-feature-aqui
```

Boas práticas:

- Siga o estilo de código existente.
- Atualize a documentação quando necessário.
- Preserve o modelo Zero-Knowledge.
- Valide permissões tanto no front-end quanto no back-end.

Commit sugerido:

```bash
git commit -m "feat: descrição clara da mudança"
git push origin feature/sua-feature-aqui
```

Prefixos recomendados:

- `feat:` nova funcionalidade.
- `fix:` correção de bug.
- `docs:` documentação.
- `style:` formatação.
- `refactor:` refatoração.
- `test:` testes.
- `chore:` manutenção.

## 🐛 Reportar Bugs

Ao reportar um bug, informe:

- Descrição objetiva do problema.
- Passos para reproduzir.
- Comportamento esperado e comportamento atual.
- Perfil/permissão do usuário usado no teste.
- Logs do navegador ou do container, se aplicável.
- Screenshots, quando ajudarem na análise.

## 📄 Licença

Este projeto está licenciado sob a **MIT License**. Veja o arquivo [LICENSE](./LICENSE) para detalhes.

## 📞 Suporte

- 📖 [Documentação Completa](./PRODUCTION_SETUP.md)
- 🐛 [Issues](https://github.com/trinityrrocha/fullpassword/issues)
- 💬 [Discussions](https://github.com/trinityrrocha/fullpassword/discussions)

## 🚀 Roadmap

- [ ] Autenticação com WebAuthn/FIDO2.
- [ ] Suporte avançado a 2FA.
- [ ] Auditoria detalhada de acessos e alterações.
- [ ] Backup criptografado automático.
- [ ] Sincronização entre múltiplas abas.
- [ ] App mobile.
- [ ] Integração com outros cofres corporativos.

---

**FullPassword v1.0.1** - Cofre Zero-Knowledge para MSPs e equipes de TI.
