# FullPassword - Cofre Zero-Knowledge para MSPs e equipes de TI

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Status](https://img.shields.io/badge/status-em%20evolu%C3%A7%C3%A3o-green.svg)
![Node.js](https://img.shields.io/badge/node.js-18+-brightgreen.svg)
![React](https://img.shields.io/badge/react-18+-blue.svg)

**FullPassword** é um cofre de credenciais e informações operacionais voltado para MSPs, equipes de TI e prestadores de suporte técnico. O sistema organiza acessos por empresa/cliente, separa os dados por módulos operacionais e mantém informações sensíveis criptografadas no navegador usando a **Web Crypto API**.

O projeto reúne gestão de usuários e grupos, permissões granulares, compartilhamento criptográfico de cofres, MFA, política de login, política de senhas, auditoria, sessões, backup/restauração criptografada, Backup Nuvem multi-provedor, notificações por e-mail, WebUpdater e instalação automatizada com **IP público ou Cloudflare Tunnel**.

> [!IMPORTANT]
> O FullPassword pode ser instalado em uma VM **sem IP público**, inclusive atrás de NAT, usando **Cloudflare Tunnel**. Nesse modo não é necessário expor as portas 80/443 para a Internet nem executar Certbot na origem. O `cloudflared` estabelece uma conexão de saída com a Cloudflare e encaminha o acesso HTTPS para o Nginx local. Isso reduz a superfície de exposição direta do servidor, mas não substitui boas práticas de hardening, atualização, MFA, backup e controle de acesso.

## ✨ Destaques atuais

- Arquitetura **Zero-Knowledge** para os dados sensíveis dos cofres.
- Multiusuário com grupos, permissões e compartilhamento criptográfico.
- MFA com TOTP e códigos de recuperação.
- Controle de sessões ativas e histórico de acessos.
- Preferências de navegação individuais por usuário.
- Módulos para hospedagem, VPN, Windows, Linux e dispositivos de infraestrutura.
- Backup e restauração criptografados nos formatos V1 e V2.
- Backup Nuvem com Google Drive, Backblaze B2, MEGA S4 e FTP/FTPS.
- Alertas de vencimento de domínio por e-mail.
- WebUpdater pelo painel, restrito ao Super Admin.
- Verificação automática de novas atualizações na branch `main`.
- Instalação automatizada em dois modos:
  - **IP público + Let's Encrypt**.
  - **Cloudflare Tunnel sem IP público**.

---

## 🔐 Segurança e criptografia

- **Arquitetura Zero-Knowledge**: dados sensíveis são criptografados no navegador antes do envio ao backend.
- **AES-256-GCM** nos cofres e envelopes criptográficos.
- **PBKDF2-SHA-256** para derivação de chave no navegador.
- **RSA-OAEP por usuário** para compartilhamento das chaves dos cofres.
- **Chave própria por cofre**: cada empresa/cofre utiliza sua própria chave criptográfica.
- **Identidade criptográfica por usuário** com `public_key` e chave privada armazenada apenas de forma criptografada.
- **Argon2id** para hash das senhas de autenticação no backend.
- Sessão em cookie `HttpOnly`, `SameSite=Strict` e `Secure` em produção.
- MFA com TOTP e códigos de recuperação de uso único.
- Política de login com bloqueio por tentativas inválidas.
- Política global de validade de senha.
- Blacklist e whitelist IPv4/CIDR.
- Proteção de tela best-effort contra impressão/captura, sem promessa de bloquear ferramentas externas ao navegador.
- Logs e auditoria sanitizados para não registrar senhas, tokens, passphrases ou conteúdo descriptografado do cofre.

### Parâmetros criptográficos versionados

- Usuários e wraps legados continuam compatíveis com PBKDF2-SHA-256 de 100.000 iterações.
- Novos usuários, bootstrap e trocas de senha utilizam PBKDF2-SHA-256 versão 2 com 310.000 iterações.
- Novos pares de compartilhamento usam RSA-OAEP 3072 bits; chaves RSA-2048 existentes continuam importáveis.
- O salt criptográfico continua sendo individual por usuário.

---

## 👥 Usuários, grupos e permissões

- Cadastro, edição, ativação/inativação e exclusão controlada de usuários.
- Grupos administrativos para compartilhamento dos cofres.
- Permissões granulares:
  - Visualizar
  - Editar
  - Adicionar
  - Excluir
- Modo somente leitura para usuários sem permissão de edição.
- Proteções de permissão no frontend e no backend.
- Exclusão segura com confirmação e proteção contra remoção indevida do último administrador.
- Super Admin protegido contra alterações administrativas não autorizadas.

### Preferências individuais de interface

Cada usuário pode definir sua própria experiência de navegação, sem alterar a interface dos demais usuários.

Opções disponíveis no perfil:

- **Posição do menu**:
  - Lateral
  - Superior
- **Exibição dos itens**:
  - Descrição
  - Ícones

As preferências são persistidas por usuário no banco e acompanham a conta em diferentes computadores. O layout mobile continua usando o menu responsivo próprio.

### Sessões no perfil

O perfil apresenta as sessões recentes em formato compacto:

- até **30 sessões mais recentes**;
- **5 registros por página**;
- no máximo **6 páginas**;
- ordenação pelo último acesso;
- opção de encerrar sessão individual ou encerrar as demais sessões da conta.

---

## 🧩 Módulos operacionais por empresa

Cada empresa/cofre pode ativar apenas os módulos necessários.

Módulos atuais:

- **Servidor de Hospedagem**
- **VPN**
- **Servidor Windows**
- **Servidor Linux**
- **Dispositivos**

Recursos comuns:

- listas compactas;
- busca e filtros;
- cadastro de usuários/logins vinculados;
- visualização read-only;
- edição em modal;
- anexos;
- botões de cópia sem exposição do segredo no DOM;
- senhas mascaradas em listas e visualizações.

### 🌐 Servidor de Hospedagem

- Domínio e URL da hospedagem.
- Usuário e senha protegidos.
- Usuários vinculados ao servidor.
- Departamento identificado na listagem.
- Data de vencimento do domínio.
- Lista de destinatários para alerta por e-mail.
- Ativação/desativação individual das notificações.

#### Alertas de vencimento de domínio

Quando configurados, os alertas podem ser enviados:

- 30 dias antes;
- 15 dias antes;
- 5 dias antes;
- no dia do vencimento;
- diariamente por até 10 dias após o vencimento.

A alteração do domínio ou da data de vencimento reinicia o ciclo de notificações. Dados sensíveis da hospedagem, como senha e login, permanecem dentro do conteúdo criptografado do cofre e não são utilizados pelo scheduler de notificações.

### 🛡️ VPN

- Servidores VPN e usuários vinculados.
- Protocolo/tipo da VPN.
- IPv4 local e IPv4 do túnel.
- VLAN e porta.
- Validação IPv4/CIDR conforme o campo.

### 🪟 Servidor Windows

- Cadastro de servidores Windows.
- Conexões ETH e VPN.
- Campos de conexão alinhados em grade:
  - Nome/identificação
  - MAC
  - IPv4
  - Gateway
- Tipos de VPN preservados, como WireGuard e OpenVPN.
- Portas estáticas e Terminal Service.
- Usuários vinculados ao servidor.
- Busca, filtros e anexos.

### 🐧 Servidor Linux

- Cadastro de servidores Linux.
- Conexões ETH e VPN.
- MAC, IPv4 e Gateway nas conexões.
- Tipos de VPN no mesmo padrão visual do Windows.
- Portas estáticas.
- Usuários vinculados ao servidor.
- Suporte visual a dados de Proxmox quando aplicável.
- Anexos.

### 📟 Dispositivos

Tipos atuais:

- **WIFI/CONTROLLER**
- **DVR**
- **IMPRESSORA**
- **NAS STORAGE**
- **PABX-IP/VOIP**
- **ROTEADOR/GATEWAY**

Compatibilidade é mantida para valores legados quando necessário.

#### WIFI/CONTROLLER

- URL, login e senha.
- Redes Wi-Fi com banda, VLAN e tipo.
- Tipos de rede como Padrão, Hotspot e IoT.

#### DVR

Campos de rede e portas específicas, incluindo:

- IP;
- TCP;
- HTTPS;
- HTTP;
- RTSP;
- NTP;
- POS;
- ID;
- MAC;
- DDNS.

#### IMPRESSORA

- Rede estática com IP, máscara, gateway, porta de impressão, MAC e DHCP.
- Conexões VPN quando necessárias.
- Logins vinculados ao equipamento.

#### NAS STORAGE

- URL, login e senha do equipamento.
- Usuários/logins vinculados.
- Rede e demais informações operacionais do dispositivo.

#### PABX-IP/VOIP

- URL do portal.
- Login e senha.
- Rede com IP, máscara, gateway, MAC e DHCP.
- Cadastro de ramais.
- Logins vinculados.

#### ROTEADOR/GATEWAY

- Dados PPPoE por WAN.
- Controle para evitar reutilização indevida da mesma WAN em novos registros.
- WAN1 a WAN5.
- IP público, operadora, telefone e MAC.
- Redes LAN com IP, máscara, VLAN, tipo e observação.
- Portas WAN com porta, protocolo, direção e observação.

---

## 📎 Anexos

- Upload, listagem e download de anexos nos módulos compatíveis.
- Anexos associados aos registros do cofre.
- Preservação em backup/restauração conforme o formato utilizado pelo sistema.

---

## 💾 Backup e restauração

- Backup criptografado protegido por passphrase.
- Dry-run/validação antes da restauração.
- Resumo do conteúdo antes da aplicação.
- Restauração transacional com rollback.
- Tratamento de registros já existentes.
- Backup de segurança antes da restauração quando aplicável.

### Formatos

- **V2 recomendado**: pacote ZIP com manifesto e checksums.
- **V1 legado**: envelope `.enc.json` para compatibilidade.

### Backup Nuvem

Provedores suportados:

| Provedor | Tecnologia | Situação |
|---|---|---|
| Google Drive | OAuth 2.0 + Drive API | Implementado |
| Backblaze B2 | S3-Compatible | Implementado |
| MEGA S4 Object Storage | S3-Compatible | Implementado |
| FTP/FTPS | FTP/FTPS | Implementado |

Recursos:

- execução manual ou agendada;
- somente um provedor ativo por vez;
- retenção configurável;
- histórico paginado;
- notificação por e-mail em falha;
- credenciais cifradas no backend com `CONFIG_ENCRYPTION_KEY`;
- access tokens do Google Drive mantidos em memória;
- logs sem tokens, credenciais ou passphrase.

> [!CAUTION]
> Preserve a `CONFIG_ENCRYPTION_KEY`. Trocar ou perder essa chave pode impedir a leitura de senhas SMTP, credenciais de provedores, refresh tokens e frases de backup já armazenadas.

### Google Drive

O Google Drive utiliza OAuth 2.0 server-side, Drive API v3 e o escopo:

```text
https://www.googleapis.com/auth/drive.file
```

A Redirect URI deve corresponder exatamente ao domínio da instalação, por exemplo:

```text
https://cofre.exemplo.com.br/api/integrations/google-drive/oauth/callback
```

---

## ✉️ SMTP

A configuração SMTP global fica disponível ao Super Admin para:

- teste de envio;
- recuperação de acesso;
- notificações do Backup Nuvem;
- alertas de vencimento de domínio.

A senha SMTP é criptografada em repouso usando `CONFIG_ENCRYPTION_KEY`.

Combinações comuns:

- porta `465`: SSL/TLS direto;
- porta `587`: STARTTLS.

---

## 🔑 Recuperação de acesso

O FullPassword possui recuperação de conta por e-mail com token temporário de uso único.

Por causa da arquitetura Zero-Knowledge, a recuperação de acesso **não recupera a senha mestre anterior nem descriptografa automaticamente cofres ligados à identidade criptográfica antiga**. O fluxo cria nova identidade criptográfica e pode exigir novo compartilhamento dos cofres pelo administrador.

Quando MFA está ativo, a recuperação também exige TOTP válido ou código de recuperação ainda não utilizado.

---

## 🔔 Atualizações e WebUpdater

O FullPassword possui atualização pelo próprio painel, restrita ao Super Admin.

### Descoberta automática de novas versões

O sistema não depende de tags, Releases ou CHANGELOG para determinar se existe atualização.

A fonte de verdade é a branch oficial:

```text
origin/main
```

O Updater Daemon executa `git fetch origin main`:

- ao iniciar, quando há estado válido;
- automaticamente a cada 24 horas;
- quando o Super Admin clica em **Verificar atualizações**.

A interface mostra:

- commit instalado;
- commit disponível;
- quantidade de alterações;
- lista dos subjects dos commits disponíveis;
- data da última verificação.

O sino de notificações avisa o Super Admin quando um novo commit fica disponível. O mesmo commit não gera uma nova notificação diária depois de visualizado.

> Verificar atualização **não instala** a atualização. O deploy continua dependendo da ação explícita do Super Admin.

### Versão instalada

A versão instalada é o commit do último deploy concluído com sucesso, e não simplesmente o `HEAD` do diretório Git. Isso evita que uma atualização interrompida seja apresentada incorretamente como instalada.

### Atualização em produção

Fluxo recomendado:

1. Entrar como Super Admin.
2. Abrir **Configurações do Sistema > Atualização do Sistema**.
3. Verificar atualizações.
4. Revisar as alterações disponíveis.
5. Confirmar **Atualizar sistema**.
6. Aguardar healthchecks e conclusão do WebUpdater.

Evite usar `git pull` e rebuild manual como rotina de produção.

---

# 🚀 Instalação

O mesmo `scripts/install.sh` oferece dois modos.

## Opção 1 — IP público

Modelo tradicional para VPS/VM com endereço público.

Requisitos:

- domínio apontando para o IP público;
- portas TCP 80 e 443 liberadas externamente;
- saída para Internet.

O instalador:

- configura firewall;
- instala Docker;
- clona o FullPassword;
- gera `.env` e segredos;
- valida DNS/IP;
- emite certificado Let's Encrypt com Certbot;
- configura Nginx HTTPS;
- sobe os containers;
- cria o Super Admin.

## Opção 2 — Cloudflare Tunnel

Modelo recomendado quando não se deseja expor diretamente a VM para a Internet.

A VM pode estar:

- sem IP público;
- atrás de NAT;
- em uma rede privada/on-premise;
- com 80/443 fechadas para conexões de entrada.

Requisitos:

- domínio gerenciado pela Cloudflare;
- acesso de saída à Internet;
- possibilidade de autenticar a conta Cloudflare pelo navegador durante a instalação.

O instalador automatiza:

- instalação do `cloudflared` pelo repositório APT oficial;
- login/autorização da conta Cloudflare;
- criação do túnel;
- criação da rota DNS/CNAME;
- geração de `/etc/cloudflared/config.yml`;
- instalação e ativação do serviço systemd `cloudflared`;
- Nginx local em `127.0.0.1:80`;
- URLs externas do FullPassword permanecendo em HTTPS.

Nesse modo:

- **não é necessário IP público na VM**;
- **não é necessário abrir 80/443 para a Internet**;
- **não é usado Certbot na origem**;
- o HTTPS público termina na infraestrutura da Cloudflare;
- o tráfego chega à origem pelo Cloudflare Tunnel.

Isso permite instalar o FullPassword em infraestrutura própria sem depender obrigatoriamente de uma VPS em nuvem com IP público.

> [!NOTE]
> O uso de Cloudflare Tunnel reduz a exposição direta da origem, mas a segurança do ambiente continua dependendo de atualizações, MFA, senhas fortes, firewall, backups e proteção do servidor/VM.

---

## Quick Start

### Sistemas suportados

- Ubuntu 20.04 LTS
- Ubuntu 22.04 LTS
- Ubuntu 24.04 LTS
- Debian 11
- Debian 12
- Debian 13 (Trixie)

### Executar o instalador

```bash
wget -O install.sh https://raw.githubusercontent.com/trinityrrocha/fullpassword/main/scripts/install.sh
chmod +x install.sh
sudo ./install.sh
```

O menu inicial apresenta:

```text
1) Instalação com IP público
2) Instalação com Cloudflare Tunnel
```

O instalador solicita apenas os dados necessários, incluindo domínio, e-mail do Super Admin e porta SSH. O diretório padrão é:

```text
/opt/fullpassword
```

### Diretório customizado

Uso avançado:

```bash
sudo env FULLPASSWORD_APP_DIR=/opt/fullpassword-teste ./install.sh
```

### Reinstalação

Se já existir uma instalação válida no destino, o instalador exige a confirmação explícita:

```text
REINSTALAR
```

Nenhuma remoção destrutiva de volumes deve ocorrer automaticamente.

### Observações para Cloudflare Tunnel

Antes de criar a rota do túnel, remova registros `A`/`AAAA` conflitantes do mesmo hostname na Cloudflare.

Durante o login, o próprio `cloudflared` apresenta uma URL semelhante a:

```text
https://dash.cloudflare.com/argotunnel?...
```

Abra a URL, autentique-se, selecione a zone correta e retorne ao terminal. O instalador continua automaticamente quando a autorização é concluída.

### Diagnóstico

Instalação padrão:

```bash
sudo docker compose --project-directory /opt/fullpassword ps
sudo docker compose --project-directory /opt/fullpassword logs --tail=100 backend
sudo docker compose --project-directory /opt/fullpassword logs --tail=100 nginx
```

Cloudflare Tunnel:

```bash
sudo systemctl status cloudflared --no-pager
sudo journalctl -u cloudflared --no-pager -n 80
```

---

## 🎨 Interface

- Layout compacto para melhor aproveitamento de espaço.
- Tema claro/escuro.
- Navegação lateral ou superior por preferência individual.
- Modo de menu por descrição ou somente ícones.
- Cards compactos e responsivos.
- Botões de ação padronizados com Lucide Icons.
- Modais read-only sem campos editáveis.
- Senhas mascaradas visualmente.
- Feedback local ao copiar informações.
- Suporte a telas menores com paginação do histórico de sessões.

---

## 📋 Stack tecnológico

| Componente | Tecnologia |
|---|---|
| Backend | Node.js + Express |
| Frontend | React + Vite |
| Banco | PostgreSQL |
| Criptografia | Web Crypto API |
| Estilização | Tailwind CSS |
| Containers | Docker + Docker Compose |
| Proxy | Nginx |
| TLS público | Let's Encrypt/Certbot ou Cloudflare Tunnel |
| Tunnel | cloudflared |

---

## 🏗️ Estrutura do projeto

```text
fullpassword/
├── backend/                 # Node.js + Express
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── routes/
│   │   └── services/
│   ├── Dockerfile
│   └── package.json
├── frontend/                # React + Vite
│   ├── src/
│   │   ├── components/
│   │   ├── context/
│   │   ├── layouts/
│   │   ├── pages/
│   │   └── services/
│   ├── Dockerfile
│   └── package.json
├── database/
│   ├── init.sql
│   └── migrations/
├── docker/
├── scripts/
│   ├── install.sh
│   ├── update.sh
│   └── updater-daemon.sh
├── docker-compose.yml
└── README.md
```

---

## 🔐 Arquitetura Zero-Knowledge e compartilhamento

```text
Usuário
├─ Master Key derivada/desenvelopada no navegador
├─ Chaves RSA do usuário
│  ├─ public_key
│  └─ encrypted_private_key

Cofre da empresa
├─ clientVaultKey própria
├─ dados criptografados com clientVaultKey
└─ compartilhamentos da chave do cofre
   ├─ usuário A
   ├─ usuário B
   └─ demais usuários autorizados
```

Fluxo resumido:

1. O usuário autentica no sistema.
2. O navegador desbloqueia a identidade criptográfica.
3. O cofre autorizado é desenvelopado localmente.
4. Os dados são descriptografados no navegador.
5. O backend mantém os dados sensíveis em formato criptografado.

---

## ✅ Segurança implementada

- ✅ Zero-Knowledge para dados sensíveis do cofre.
- ✅ AES-256-GCM.
- ✅ PBKDF2-SHA-256 versionado.
- ✅ RSA-OAEP para compartilhamento.
- ✅ Argon2id para senhas de login.
- ✅ MFA + recovery codes.
- ✅ Sessões revogáveis.
- ✅ Política de login e de senhas.
- ✅ Controle de acesso por grupos e permissões.
- ✅ Auditoria.
- ✅ Backup/restauração criptografados.
- ✅ Backup Nuvem multi-provedor.
- ✅ Credenciais operacionais do backend cifradas com `CONFIG_ENCRYPTION_KEY`.
- ✅ WebUpdater restrito ao Super Admin.
- ✅ Verificação automática de atualizações.
- ✅ Instalação tradicional com Let's Encrypt.
- ✅ Instalação por Cloudflare Tunnel sem exposição direta de 80/443.

---

## 🧪 Validações recomendadas após atualização

Após um WebUpdater, valide pelo menos:

- login do Super Admin;
- abertura de cofre existente;
- leitura e gravação de registros;
- permissões de usuário/grupo;
- perfil e preferências de navegação;
- MFA;
- sessões;
- módulos Windows/Linux/Dispositivos;
- Backup V1/V2;
- Backup Nuvem;
- SMTP;
- notificações de vencimento de domínio;
- página de atualização e status do WebUpdater;
- console do navegador sem erros fatais.

---

## 📚 Documentação adicional

- **[PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)** - Guia resumido de produção.
- **[DEPLOY.md](./DEPLOY.md)** - Guia detalhado de deploy.
- **[frontend/README.md](./frontend/README.md)** - Documentação do frontend.
- **[frontend/CRYPTO_IMPLEMENTATION.md](./frontend/CRYPTO_IMPLEMENTATION.md)** - Detalhes da criptografia.
- **[backend/README.md](./backend/README.md)** - Documentação da API.

---

## 📄 Licença

Distribuído sob a licença MIT. Consulte o arquivo de licença do repositório para os termos aplicáveis.
