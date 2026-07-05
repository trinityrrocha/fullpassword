# FullPassword - Zero-Knowledge Password Manager for MSPs

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)
![Node.js](https://img.shields.io/badge/node.js-18+-brightgreen.svg)
![React](https://img.shields.io/badge/react-18+-blue.svg)

**FullPassword** é um gerenciador de senhas de código aberto construído especificamente para **Managed Service Providers (MSPs)** com arquitetura **Zero-Knowledge**. Todo o código sensível é criptografado no navegador do cliente usando a **Web Crypto API** nativa, garantindo que o backend nunca tem acesso a dados em texto claro.

## 🎯 Características Principais

### 🔐 Segurança de Nível Enterprise

- **Zero-Knowledge Architecture**: Criptografia AES-256-GCM no navegador
- **Master Key Derivation**: PBKDF2 com 100.000 iterações
- **Web Crypto API**: Sem dependências externas de criptografia
- **SSL/TLS Automático**: Let's Encrypt integrado
- **Firewall e Fail2Ban**: Proteção contra força bruta
- **JWT Authentication**: Sessões seguras com expiração configurável

### 📊 Funcionalidades para MSPs

- **Gestão de Clientes**: Organize credenciais por cliente
- **Abas Dinâmicas**: cPanel, VPN, Terminal Server, Servidores Diversos
- **Múltiplos Usuários**: Controle de acesso por grupos
- **Anexos Criptografados**: Upload de arquivos de configuração
- **Interface Intuitiva**: Design responsivo com Tailwind CSS

### 🚀 Deploy Automatizado

- **Script de Instalação Bash**: Deploy em VPS com um comando
- **Docker Compose**: Todos os serviços containerizados
- **Nginx Proxy Reverso**: Roteamento automático
- **Certificado Let's Encrypt**: SSL/TLS gratuito e automático

## 📋 Stack Tecnológico

| Componente | Tecnologia | Versão |
|-----------|-----------|--------|
| **Backend** | Node.js + Express | 18+ |
| **Frontend** | React + Vite | 18+ |
| **Banco de Dados** | PostgreSQL | 15 |
| **Criptografia** | Web Crypto API | Nativa |
| **Estilização** | Tailwind CSS | 3+ |
| **Containerização** | Docker + Docker Compose | Latest |
| **Proxy Reverso** | Nginx | Latest |
| **SSL/TLS** | Let's Encrypt + Certbot | Latest |

## 🚀 Quick Start

### Pré-requisitos

- VPS com Ubuntu 20.04/22.04 LTS ou Debian 11/12
- Domínio apontando para o IP da VPS (DNS A record)
- Acesso SSH como root

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
- Domínio (ex: `cofre.suaempresa.com.br`)
- E-mail para Let's Encrypt
- Porta SSH (se customizada)
- URL do repositório GitHub

Após a conclusão, acesse `https://seu-dominio.com.br` com as credenciais padrão:
- **Email**: `admin@admin.com.br`
- **Senha**: `@dmin123` (⚠️ Alterar imediatamente!)

## 📚 Documentação

- **[PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)** - Guia resumido de produção
- **[DEPLOY.md](./DEPLOY.md)** - Guia detalhado de deploy
- **[frontend/README.md](./frontend/README.md)** - Documentação do frontend
- **[frontend/CRYPTO_IMPLEMENTATION.md](./frontend/CRYPTO_IMPLEMENTATION.md)** - Detalhes da criptografia
- **[backend/README.md](./backend/README.md)** - Documentação da API

## 🏗️ Estrutura do Projeto

```
fullpassword/
├── backend/                 # Node.js + Express
│   ├── src/
│   │   ├── config/         # Configurações (DB, etc)
│   │   ├── controllers/    # Lógica de negócio
│   │   ├── routes/         # Rotas da API
│   │   ├── middleware/     # Autenticação, validação
│   │   └── server.js       # Entrada principal
│   ├── Dockerfile
│   └── package.json
├── frontend/                # React + Vite
│   ├── src/
│   │   ├── components/     # Componentes reutilizáveis
│   │   ├── pages/          # Páginas principais
│   │   ├── services/       # Criptografia, API
│   │   ├── context/        # AuthContext
│   │   └── App.jsx         # Entrada principal
│   ├── Dockerfile
│   └── package.json
├── docker/
│   ├── nginx.conf          # Configuração do Nginx
│   └── init.sql            # Script SQL inicial
├── scripts/
│   └── install.sh          # Script de instalação
├── docker-compose.yml      # Orquestração de containers
└── README.md               # Este arquivo
```

## 🔐 Arquitetura Zero-Knowledge

```
Frontend (React)
├─ Derivar Master Key (PBKDF2)
├─ Criptografar dados (AES-256-GCM)
└─ Enviar encrypted_data para API

Backend (Node.js)
├─ Receber encrypted_data
├─ Armazenar SEM descriptografar
└─ Retornar encrypted_data ao frontend

Frontend (React)
├─ Receber encrypted_data
├─ Descriptografar com Master Key
└─ Exibir dados em claro
```

**Resultado**: O backend nunca tem acesso a senhas ou credenciais em texto claro.

## 🛡️ Segurança Implementada

- ✅ **Criptografia End-to-End**: AES-256-GCM
- ✅ **Derivação de Chave**: PBKDF2 com 100.000 iterações
- ✅ **Autenticação**: JWT com expiração
- ✅ **Hashing de Senhas**: Argon2id no backend
- ✅ **CORS**: Restrito ao domínio
- ✅ **Helmet**: Headers HTTP de segurança
- ✅ **Firewall**: UFW com portas restritas
- ✅ **Proteção SSH**: Fail2Ban contra força bruta
- ✅ **SSL/TLS**: Let's Encrypt automático

## 🤝 Como Contribuir

Contribuições são bem-vindas! Por favor, siga os passos abaixo:

### 1. Fork o Repositório
Clique no botão "Fork" no GitHub para criar sua cópia pessoal.

### 2. Clone Localmente
```bash
git clone https://github.com/trinityrrocha/fullpassword.git
cd fullpassword
```

### 3. Crie uma Branch para sua Feature
```bash
git checkout -b feature/sua-feature-aqui
```

### 4. Faça suas Alterações
- Siga o estilo de código existente
- Adicione testes se aplicável
- Atualize a documentação

### 5. Commit com Mensagens Claras
```bash
git commit -m "feat: descrição clara da sua mudança"
```

Use prefixos convencionais:
- `feat:` - Nova funcionalidade
- `fix:` - Correção de bug
- `docs:` - Documentação
- `style:` - Formatação
- `refactor:` - Refatoração
- `test:` - Testes
- `chore:` - Manutenção

### 6. Push para sua Branch
```bash
git push origin feature/sua-feature-aqui
```

### 7. Abra um Pull Request
- Descreva claramente suas mudanças
- Referencie issues relacionadas
- Aguarde revisão

## 📝 Guia de Estilo

- **Backend**: Node.js + Express (ES6+)
- **Frontend**: React com Hooks (Functional Components)
- **CSS**: Tailwind CSS (utility-first)
- **Formatação**: 2 espaços de indentação

## 🐛 Reportar Bugs

Se encontrar um bug, por favor abra uma issue no GitHub com:
- Descrição clara do problema
- Passos para reproduzir
- Comportamento esperado vs. atual
- Screenshots (se aplicável)

## 📄 Licença

Este projeto está licenciado sob a **MIT License** - veja o arquivo [LICENSE](./LICENSE) para detalhes.

## 🙏 Agradecimentos

- Web Crypto API (W3C)
- Let's Encrypt (ISRG)
- Docker (Moby Project)
- React (Meta)
- Node.js (OpenJS Foundation)

## 📞 Suporte

- 📖 [Documentação Completa](./PRODUCTION_SETUP.md)
- 🐛 [Issues](https://github.com/trinityrrocha/fullpassword/issues)
- 💬 [Discussions](https://github.com/trinityrrocha/fullpassword/discussions)

## 🚀 Roadmap

- [ ] Autenticação com WebAuthn/FIDO2
- [ ] Sincronização entre múltiplas abas
- [ ] Backup criptografado automático
- [ ] Auditoria de acessos
- [ ] Integração com Vault HashiCorp
- [ ] App mobile (React Native)
- [ ] Suporte a 2FA

## ⭐ Se Gostou, Deixe uma Star!

Se este projeto foi útil para você, considere deixar uma ⭐ no GitHub para mostrar seu apoio!

---

**FullPassword v1.0** - Desenvolvido com ❤️ para a comunidade MSP

Made with ❤️ by the FullPassword Community
