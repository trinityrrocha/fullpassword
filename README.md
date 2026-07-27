# FullPassword - Cofre Zero-Knowledge para MSPs e equipes de TI

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Status](https://img.shields.io/badge/status-em%20evolu%C3%A7%C3%A3o-green.svg)
![Node.js](https://img.shields.io/badge/node.js-18+-brightgreen.svg)
![React](https://img.shields.io/badge/react-18+-blue.svg)

**FullPassword** é um cofre de credenciais para MSPs, equipes de TI e prestadores de suporte técnico. O sistema organiza acessos por empresa/cliente, separa dados por módulos operacionais e mantém as informações sensíveis criptografadas no navegador usando a **Web Crypto API**.

A aplicação suporta múltiplos usuários, grupos, permissões granulares, compartilhamento criptográfico de cofres, autenticação com MFA, política de login, política global de senhas, auditoria, backup/restauração criptografada, Backup Nuvem multi-provedor com automação, notificações de falha por e-mail e organização operacional por abas.

## 🎯 Características principais

### 🔐 Segurança e criptografia

- **Arquitetura Zero-Knowledge**: dados sensíveis são criptografados no navegador antes de serem enviados ao back-end.
- **AES-256-GCM**: criptografia simétrica usada nos cofres e envelopes criptográficos.
- **PBKDF2 / derivação de chave no navegador**: usada no fluxo de chave mestre do usuário.
- **RSA-OAEP por usuário**: usado para compartilhar chaves de cofre com usuários autorizados.
- **Identidade criptográfica da conta**: cada usuário gera no navegador sua `public_key` e sua chave privada criptografada no primeiro login. A API armazena somente a chave pública e `encrypted_private_key`; a chave privada nunca é enviada em claro.
- **Bootstrap independente de cofre**: um usuário não precisa possuir ou abrir um cofre para concluir sua identidade criptográfica e ficar apto a receber compartilhamentos. Contas existentes sem chaves concluem o setup no próximo login.
- **Chave própria por cofre**: cada empresa/cofre possui chave própria para criptografia dos dados internos.
- **Back-end sem acesso ao texto claro**: API e banco armazenam dados criptografados e metadados necessários.
- **Argon2id**: hashing seguro das senhas de login no back-end.
- **Autenticação JWT com controle de sessão**.
- **MFA e códigos de recuperação**.
- **Política de login**: controle de tentativas falhadas, janela de contagem e tempo de bloqueio automático.
- **Política global de senhas**: expiração configurável por 3 meses, 6 meses ou 1 ano.
- **Blacklist / Whitelist manual de IP/CIDR**: validação de IPv4 e IPv4/CIDR com whitelist prevalecendo sobre blacklist.
- **Proteção contra impressão/captura de tela best-effort**: bloqueio de impressão, tentativa de interceptar Print Screen, blur ao perder foco e controle por switch. Essa proteção não é absoluta, pois o navegador não consegue impedir capturas feitas diretamente pelo sistema operacional, ferramentas externas ou câmera.

### 👥 Usuários, grupos e permissões

- **Gestão de usuários do sistema**: cadastro, edição, ativação/inativação e exclusão controlada.
- **Gestão de grupos**: grupos administrativos usados para compartilhar cofres.
- **Vínculo de membros com grupos por multi-select com checkbox**.
- **Permissões granulares por grupo**:
  - Visualizar
  - Editar
  - Adicionar
  - Excluir
- **Compartilhamento por grupo**: o cofre define quais grupos têm acesso; o grupo define o nível de permissão.
- **Modo somente leitura**: usuários com permissão apenas de visualização conseguem consultar e copiar dados autorizados, mas não conseguem alterar campos.
- **Bloqueio de ações por permissão**: usuários sem permissão de adicionar, editar ou excluir têm ações bloqueadas no front-end e protegidas no back-end.
- **Exclusão segura de usuário do sistema**: com confirmação `EXCLUIR`, bloqueio de autoexclusão e proteção contra remoção do último administrador.

### 🧩 Módulos operacionais por empresa

As empresas possuem abas operacionais configuráveis. Novas empresas podem iniciar sem módulos ativos, e cada módulo pode ser adicionado conforme necessidade.

Módulos atuais:

- **Servidor hospedagem**
- **VPN**
- **Servidor Windows**
- **Servidor Linux**
- **Dispositivos**

Comportamentos comuns:

- Botão superior compacto de ações por módulo.
- Lista principal compacta.
- Busca e filtro por servidor/dispositivo quando aplicável.
- Lista de usuários/logins cadastrados.
- Modal de visualização somente leitura por ícone de olho.
- Modal de edição/cadastro.
- Anexos vinculados aos registros.
- Exclusão de módulo com confirmação `EXCLUIR`, removendo os dados daquele módulo sem afetar os demais.

### 🌐 Servidor hospedagem

Módulo para credenciais e acessos de hospedagem.

Inclui:

- Cadastro de servidores/domínios de hospedagem.
- URL, login e senha mascarada.
- Botões de copiar para URL, login e senha.
- Usuários vinculados ao servidor de hospedagem.
- Busca de usuários e filtro por servidor.
- Layout compacto com servidores e usuários em cards de linha única.

### 🛡️ VPN

Módulo para cadastro de servidores VPN e usuários vinculados.

Inclui:

- Cadastro de servidor VPN.
- Protocolo/tipo VPN.
- IPv4 local com validação IPv4/CIDR.
- IPv4 túnel com validação IPv4/CIDR.
- VLAN e porta.
- Usuários VPN vinculados ao servidor.
- Lista compacta exibindo nome, protocolo, IPv4 túnel, IPv4 local e porta.

### 🪟 Servidor Windows

Módulo para servidores Windows, conexões, portas, Terminal Service e usuários.

Inclui:

- Cadastro de servidores Windows.
- Conexões Eth e VPN.
- Campos `IPV4/` e `Gateway/` com prefixos visuais internos.
- Validação IPv4/CIDR para IP e IPv4 puro para gateway.
- Portas e TS.
- Usuários vinculados ao servidor.
- Busca e filtro por servidor.
- Anexos.

### 🐧 Servidor Linux

Módulo para servidores Linux, conexões, portas e usuários.

Inclui:

- Cadastro de servidores Linux.
- Conexões Eth com `IPV4/` e `Gateway/` em linha única.
- Conexões VPN com input `IPV4/`.
- Validação IPv4/CIDR e IPv4 puro conforme o campo.
- Portas.
- Usuários vinculados ao servidor.
- Suporte visual específico para dados de Proxmox quando aplicável.
- Anexos.

### 📟 Dispositivos

Módulo para dispositivos de rede e infraestrutura.

Tipos de dispositivo disponíveis:

- VOIP
- NAS
- DVR
- IMPRESSORA
- NAS STORAGE
- PABX
- ROTEADOR

Inclui:

- Cadastro de dispositivos.
- Conexões e portas.
- Anexos.
- Cadastro de logins vinculados ao dispositivo.
- Select de dispositivo exibindo nome + tipo, por exemplo `Loja1 (VOIP)`.
- Login e senha mascarada.
- Departamento com opção adicional `Geral`.
- Permissão do login com opções `Admin` e `User`.
- Busca de logins e filtro por dispositivo.

### 📎 Anexos

- Upload e listagem de anexos dentro dos módulos operacionais.
- Download de anexos em modais de edição e visualização quando aplicável.
- Anexos permanecem associados aos dados criptografados do cofre.
- Backup e restauração preservam os anexos contidos nos dados do banco/cofre.

### 💾 Backup e restauração

- Backup criptografado protegido por frase/senha.
- Validação/dry-run antes da restauração.
- Exibição de resumo do conteúdo do backup antes de restaurar.
- Restauração com transação e rollback em falha.
- Backup automático de segurança preservado antes da restauração.
- Tratamento de registros já existentes para evitar duplicidade em usuários, grupos, vínculos, políticas e auditoria.
- Mensagens visuais de progresso, sucesso e erro.
- Compatibilidade com anexos incluídos nos dados criptografados.
- **Backup V2 recomendado**: pacote ZIP com manifesto, checksums e estrutura preparada para validação antes da restauração.
- **Backup V1 por compatibilidade**: mantém o envelope legado `.enc.json` para fluxos antigos de restauração.
- **Seleção de formato por execução**: o Super Admin escolhe entre V1 e V2, e o formato usado fica registrado no histórico.
- **Frase de criptografia protegida**: a frase nunca retorna em claro para a interface; após salva, é indicada apenas por máscara visual.
- **Backup Nuvem multi-provedor**: permite envio manual ou agendado para Google Drive, Backblaze B2, MEGA S4 Object Storage e FTP/FTPS.
- **Histórico paginado**: execuções são listadas em páginas de 10 registros.
- **Retenção unificada**: o histórico do Backup Nuvem segue o mesmo período de retenção configurado para os arquivos remotos.

### ⚙️ Configurações do sistema

- Accordions exclusivos: apenas um card aberto por vez.
- Card de Segurança com política de login, sessões, proteção de tela e demais opções administrativas.
- Sessões ativas e sessões encerradas em abas separadas.
- Paginação de sessões com 10 registros por página.
- Histórico de sessões encerradas limitado a 30 dias.
- Política global de senhas por select: 3 meses, 6 meses ou 1 ano.
- Blacklist / Whitelist manual com campos alinhados e validação IPv4/CIDR.
- Switches sutis para ativar/desativar recursos de segurança.
- Configuração global de e-mail SMTP restrita ao Super Admin, com SSL/TLS direto, STARTTLS e envio de teste.

### Configuração SMTP

O FullPassword pode usar SMTP para e-mails de teste e como base para futuros fluxos de convites, alertas e recuperação de conta. A configuração fica em **Configurações do Sistema > E-mail / SMTP** e somente o Super Admin pode consultar, alterar ou testar o transporte.

A senha SMTP é criptografada em repouso no backend com AES-256-GCM e uma chave dedicada mantida fora do banco:

```env
CONFIG_ENCRYPTION_KEY=
```

Gere uma chave base64 de 32 bytes com:

```bash
openssl rand -base64 32
```

O instalador gera essa chave automaticamente sem imprimi-la. O WebUpdater preserva uma chave existente válida e, em instalações anteriores com a variável ausente, vazia, inválida ou ainda preenchida com placeholder, gera uma única chave e atualiza o `.env` com permissão restrita. Perder ou trocar uma chave válida impede a leitura das senhas SMTP, dos refresh tokens e das frases de backup já salvos.

Se o painel informar que a chave de criptografia não está configurada, execute novamente o WebUpdater ou defina uma chave válida no `.env` e reinicie o backend. Um erro `429` durante o teste indica o limite de cinco testes SMTP em quinze minutos; aguarde antes de tentar novamente. Na tela, salve a configuração e a senha antes de testar. As combinações usuais são porta `465` com **SSL/TLS direto** e porta `587` com **STARTTLS**; portas personalizadas continuam permitidas com aviso visual.

### Backup Nuvem

O **Backup Nuvem** permite que o Super Admin configure um destino remoto para armazenar backups criptografados do FullPassword, com execução manual ou agendada.

#### Provedores suportados

| Provedor | Tipo | Status |
|----------|------|--------|
| Google Drive | OAuth 2.0 + Google Drive API | Implementado, testado e funcional |
| Backblaze B2 | S3-Compatible | Implementado, pendente de teste real com credenciais Backblaze |
| MEGA S4 Object Storage | S3-Compatible | Implementado, não testado em ambiente real |
| FTP/FTPS | FTP com opção FTPS | Implementado, pendente de teste real em servidor FTP/FTPS |

Somente um provedor pode receber novas execuções por vez, mas todos podem ficar desligados. Ao desligar ou trocar de provedor, as credenciais salvas são preservadas; apenas novas execuções deixam de usar o provedor anterior.

#### Formatos de backup

- **Backup V2**: formato recomendado, gerado como pacote ZIP com manifesto e checksums.
- **Backup V1**: formato de compatibilidade, gerado como envelope `.enc.json`.

A escolha entre V1 e V2 vale para backups manuais e agendados. O histórico registra o formato usado em cada execução.

#### Segurança

- A frase de criptografia do backup é cifrada no backend e nunca retorna em claro para o frontend.
- Quando já existe uma frase salva, o campo mostra apenas `****************************`.
- A frase deve ter pelo menos 16 caracteres e precisa ser guardada pelo administrador; sem ela, o backup remoto não pode ser restaurado.
- Client Secret, refresh token, chaves S3, senha FTP e frase de backup são criptografados com `CONFIG_ENCRYPTION_KEY`.
- Access tokens do Google Drive ficam apenas em memória.
- Logs, auditoria, debug seguro, histórico e e-mails não incluem credenciais, tokens, frases de criptografia nem conteúdo do cofre.

> [!CAUTION]
> Perder ou trocar `CONFIG_ENCRYPTION_KEY` impede a leitura de senhas SMTP, credenciais de provedores, refresh tokens e frases de backup já armazenadas.

#### Automação

Existe somente um agendador de Backup Nuvem. Ele verifica os horários a cada 30 segundos usando `TZ` (padrão `America/Sao_Paulo`), usa o provedor ativo e o formato selecionado no momento da execução e evita duplicidade por slot agendado. O scheduler antigo do Google Drive apenas delega para o singleton genérico e não cria um intervalo paralelo.

#### Histórico e retenção

O histórico de execuções é paginado no backend, com no máximo 10 registros por página. Sua limpeza segue o mesmo período de retenção configurado para os backups remotos e afeta somente `cloud_backup_runs`, sem remover eventos da auditoria do sistema.

#### Notificações e limites

Falhas de backup podem gerar notificações por e-mail usando o SMTP global configurado em **Configurações do Sistema > E-mail / SMTP**. Os destinatários são validados e limitados, e os e-mails não incluem segredos, conteúdo do cofre ou stack trace. Troca/configuração de provedor, teste/execução e WebUpdater usam limitadores independentes.

#### Configuração do Google Drive

O Google Drive usa OAuth 2.0 server-side, Drive API v3 e somente o escopo:

```text
https://www.googleapis.com/auth/drive.file
```

Esse escopo restringe o acesso aos arquivos criados ou usados pelo aplicativo. O FullPassword cria ou reutiliza a pasta **FullPassword Backups** e aplica retenção somente aos backups V1/V2 marcados pelo sistema dentro dessa pasta.

Checklist no Google Cloud:

1. Acesse o Google Cloud Console e crie ou selecione o projeto correto.
2. Em **APIs e serviços > Ativar APIs e serviços**, ative a **Google Drive API**.
3. Em **APIs e serviços > Credenciais**, crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**.
4. Defina um nome para o cliente, por exemplo `FullPassword Backup Nuvem`.
5. Cadastre em **URIs de redirecionamento autorizados** exatamente a URL exibida no FullPassword. Exemplo:

   ```text
   https://cofre.exemplo.com.br/api/integrations/google-drive/oauth/callback
   ```

6. Em **Branding** ou **Tela de consentimento OAuth**, informe nome do app, e-mail de suporte, domínio autorizado e e-mail de contato do desenvolvedor.
7. Se o app estiver em modo de teste, adicione a conta Google em **Audience/Público > Test users**.
8. Copie o **Client ID** e o **Client Secret**.

No FullPassword:

1. Entre como Super Admin e acesse **Configurações do Sistema > Backup Nuvem**.
2. Ative **Google Drive**.
3. Salve Client ID, Client Secret e Redirect URI.
4. Clique em **Conectar Google Drive** e autorize a conta.
5. Execute **Testar** e depois um backup manual de validação.

O domínio acima é apenas um exemplo. Cada instalação deve usar seu domínio real, e a Redirect URI cadastrada no Google Cloud deve ser idêntica à URL efetivamente usada.

Como fallback legado, instalações que já usam variáveis de ambiente continuam compatíveis:

```env
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REDIRECT_URI=https://cofre.exemplo.com.br/api/integrations/google-drive/oauth/callback
```

Quando existirem credenciais completas no banco, elas têm prioridade sobre o ambiente. No fallback, `GOOGLE_DRIVE_REDIRECT_URI` pode ficar vazio; nesse caso o backend deriva a URI a partir de `APP_ORIGIN`. A URI cadastrada no Google Cloud deve ser idêntica à efetivamente usada.

#### Configuração do Backblaze B2

O Backblaze B2 usa o adapter S3-Compatible do FullPassword. Configure endpoint S3, região, bucket, Access Key/Key ID, Secret Key/Application Key e prefixo remoto. Use um bucket privado e restrinja as credenciais ao menor nível necessário. A retenção atua somente no prefixo configurado e sobre arquivos gerados pelo FullPassword.

#### Configuração do MEGA S4 Object Storage

O MEGA S4 Object Storage é tratado como armazenamento S3-Compatible e usa o mesmo adapter S3 do Backblaze B2. Configure o endpoint S3 informado pelo painel MEGA S4, região, bucket, Access Key, Secret Key e prefixo remoto.

> [!NOTE]
> O suporte ao MEGA S4 Object Storage está implementado, mas ainda não foi validado em ambiente real. Antes de usá-lo em produção, execute teste de conexão, backup manual e restauração de validação.

#### Configuração do FTP/FTPS

Configure host, porta, usuário, senha, pasta remota e a opção FTPS. FTP puro não criptografa o tráfego; use FTPS sempre que o servidor permitir. Antes de ativar o agendamento, faça um backup manual e confirme que o arquivo foi gravado na pasta remota correta.

### Recuperação de acesso

O FullPassword permite solicitar por e-mail uma recuperação de acesso à conta. O link contém um token aleatório temporário, válido por 30 minutos e por um único uso; o banco armazena somente o hash SHA-256 desse token. Quando a conta usa MFA, a conclusão também exige um TOTP válido ou um código de recuperação MFA ainda não utilizado.

Por usar arquitetura Zero-Knowledge, essa recuperação **não recupera a senha mestre anterior e não descriptografa cofres antigos**. A nova senha é usada no navegador para gerar um novo salt, uma nova chave de usuário e um novo par RSA. O backend recebe somente a chave de usuário envelopada, a chave pública e a chave privada já criptografada.

Ao concluir a redefinição, as sessões anteriores são revogadas e os compartilhamentos criptográficos vinculados à identidade antiga são removidos. Usuário, grupos, permissões, clientes e cofres são preservados, mas um administrador pode precisar ressincronizar ou recompartilhar os cofres com a nova identidade.

Os códigos de recuperação são exclusivamente um segundo fator alternativo do MFA. Eles são armazenados com hash Argon2, têm uso único, não substituem a senha mestre e não descriptografam cofres.

No login, um código de recuperação só pode ser informado depois que e-mail e senha corretos gerarem um desafio MFA válido. Na recuperação de acesso, ele só valida o MFA depois que o link recebido por e-mail foi validado e uma nova senha foi informada. O código usado é invalidado atomicamente, nunca autentica sozinho e não recupera a identidade criptográfica anterior.

Os códigos em texto claro são retornados apenas na ativação ou regeneração, para exibição e geração local do PDF. O perfil mostra somente a quantidade restante. A regeneração exige o TOTP atual, invalida todos os códigos anteriores e entrega um novo conjunto uma única vez.

Se o usuário perder o aplicativo autenticador, o Perfil permite desativar o MFA com a senha atual e um código de recuperação ainda não usado. A operação é transacional: o código só é consumido se o MFA for realmente desativado, todos os códigos antigos são invalidados e a sessão atual permanece ativa para configurar imediatamente um novo aplicativo.

Para impedir rotação de identidade sem prova de posse, administradores não definem uma nova senha no formulário de edição de membros. A recuperação deve ser iniciada pelo próprio usuário em **Esqueceu a senha?** e concluída com token, confirmação explícita e MFA quando habilitado.

### 🎨 Interface e experiência

- Layout compacto para melhor aproveitamento de espaço.
- Cards de listagem em linha única quando possível.
- Busca e filtros por servidor/dispositivo.
- Botões de ação padronizados por ícones.
- Botões de copiar com feedback local discreto.
- Senhas sempre mascaradas como `****` em listas e cards.
- Sem botão de copiar senha na tela principal de login nem no modal de solicitação de senha do cofre.
- Modais read-only sem inputs, selects, salvar ou excluir.

## 📋 Stack tecnológico

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
> - VPS com Ubuntu 20.04/22.04 LTS ou Debian 11/12
> - Domínio apontando para o IP da VPS
> - Acesso SSH como root

### Instalação em 3 passos

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

No primeiro login, o Super Admin deve obrigatoriamente trocar a senha temporária antes de usar o sistema.

## 🔁 Atualização em produção

O acesso por SSH faz parte apenas da primeira instalação. Depois que o instalador conclui, o fluxo oficial de atualização é pelo painel, usando o **WebUpdater**, restrito ao usuário com `is_super_admin=true`.

1. Acesse o FullPassword pelo navegador.
2. Entre com o Super Admin.
3. Abra **Configurações do Sistema > WebUpdater**.
4. Execute a verificação de atualização.
5. Confirme a atualização pelo painel.
6. Aguarde o processo concluir e pressione `Ctrl + F5` no navegador.

Não use `git pull`, rebuild manual ou configuração recorrente por terminal como rotina operacional. O WebUpdater executa a sincronização do código, reconstrução dos containers e reinício dos serviços necessários. O fluxo aceita apenas solicitações internas com formato validado e atualiza exclusivamente a branch `main` do repositório oficial configurado; URL remota, branch e comandos não são recebidos do navegador.

## 📚 Documentação

- **[PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)** - Guia resumido de produção.
- **[DEPLOY.md](./DEPLOY.md)** - Guia detalhado de deploy.
- **[frontend/README.md](./frontend/README.md)** - Documentação do frontend.
- **[frontend/CRYPTO_IMPLEMENTATION.md](./frontend/CRYPTO_IMPLEMENTATION.md)** - Detalhes da criptografia.
- **[backend/README.md](./backend/README.md)** - Documentação da API.

## 🏗️ Estrutura do projeto

```text
fullpassword/
├── backend/                 # Node.js + Express
│   ├── src/
│   │   ├── config/          # Configurações e banco de dados
│   │   ├── controllers/     # Lógica de negócio
│   │   ├── middleware/      # Autenticação, autorização e validações
│   │   ├── routes/          # Rotas da API
│   │   ├── services/        # Serviços auxiliares, segurança e controle de acesso
│   │   └── server.js        # Entrada principal
│   ├── Dockerfile
│   └── package.json
├── frontend/                # React + Vite
│   ├── src/
│   │   ├── components/      # Componentes reutilizáveis e módulos operacionais
│   │   ├── context/         # Contextos da aplicação
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

## 🔐 Arquitetura Zero-Knowledge e compartilhamento

```text
Usuário
├─ Master Key derivada/desenvelopada no navegador
├─ Chaves RSA do usuário
│  ├─ public_key
│  └─ encrypted_private_key

Cofre da empresa
├─ clientVaultKey própria do cofre
├─ Dados criptografados com clientVaultKey
└─ client_key_shares
   ├─ clientVaultKey criptografada para usuário A
   ├─ clientVaultKey criptografada para usuário B
   └─ clientVaultKey criptografada para usuários autorizados
```

Fluxo resumido:

1. O usuário autentica no sistema.
2. O navegador desbloqueia as chaves necessárias para acesso ao cofre.
3. Os dados do cofre são descriptografados localmente.
4. Ao compartilhar com um grupo, a chave do cofre é criptografada para os usuários autorizados.
5. O back-end armazena apenas dados e chaves criptografadas.

**Resultado**: o back-end não manipula credenciais em texto claro e o compartilhamento respeita as permissões definidas nos grupos.

### Parâmetros criptográficos versionados

- Usuários e wraps legados sem metadados continuam usando PBKDF2-SHA-256 com 100.000 iterações.
- Novos usuários, bootstrap e trocas de senha usam PBKDF2-SHA-256 versão 2 com 310.000 iterações.
- Novos pares de compartilhamento usam RSA-OAEP 3072 bits; chaves RSA-2048 existentes continuam importáveis.
- Salt criptográfico único por usuário permanece obrigatório em todas as versões.
- Argon2id no navegador é uma possibilidade futura e não faz parte da implementação atual.

## 🛡️ Segurança implementada

- ✅ Criptografia AES-256-GCM no navegador.
- ✅ Derivação de chave no navegador.
- ✅ Chaves RSA-OAEP por usuário para compartilhamento criptográfico.
- ✅ Chave própria por cofre.
- ✅ Hash de senha com Argon2id.
- ✅ Autenticação JWT.
- ✅ Sessão em cookie `HttpOnly`, `SameSite=Strict` e `Secure` em produção, validada e revogável no banco.
- ✅ MFA e códigos de recuperação.
- ✅ Política de login com bloqueio por tentativas falhadas.
- ✅ Política global de senhas.
- ✅ Sessões ativas e encerradas com histórico limitado.
- ✅ Blacklist / Whitelist manual por IPv4/CIDR.
- ✅ Controle de acesso no back-end por cofre, grupo e permissão.
- ✅ Operações de compartilhamento validadas e auditadas no back-end.
- ✅ Bloqueios visuais no front-end conforme permissões.
- ✅ Backup e restauração criptografados com validação e rollback.
- ✅ Logs de backup/restauração sanitizados, sem registrar passphrase ou conteúdo do backup.
- ✅ Backup Nuvem multi-provedor com Google Drive, Backblaze B2, MEGA S4 Object Storage e FTP/FTPS.
- ✅ Scheduler único para backups remotos manuais e agendados.
- ✅ Credenciais de provedores remotos criptografadas com `CONFIG_ENCRYPTION_KEY`.
- ✅ Frase de backup mascarada na interface após salva.
- ✅ Histórico de Backup Nuvem paginado e com retenção controlada.
- ✅ Notificações de falha por e-mail via SMTP global.
- ✅ WebUpdater restrito ao Super Admin, à branch `main`, ao repositório oficial e a serviços permitidos.
- ✅ Screen protection best-effort sem promessa de bloqueio absoluto de screenshot.
- ✅ Suporte a SSL/TLS com Let's Encrypt.
- ✅ Transporte SMTP global com validação TLS e senha criptografada por chave dedicada.

## 🔑 Modelo de permissões

As permissões são definidas no **Grupo** e aplicadas aos cofres compartilhados com esse grupo.

| Permissão | Comportamento esperado |
|----------|-------------------------|
| **Visualizar** | Permite abrir o cofre, visualizar dados autorizados e copiar informações permitidas. |
| **Editar** | Permite alterar dados existentes e salvar alterações. |
| **Adicionar** | Permite criar novos registros dentro do cofre. |
| **Excluir** | Permite excluir/remover registros do cofre. |

Regras principais:

- Um usuário só vê cofres compartilhados com grupos aos quais ele pertence.
- Dono do cofre e administradores possuem controle total.
- Usuários somente leitura não conseguem digitar, adicionar, salvar nem excluir.
- Usuários com edição, mas sem adicionar/excluir, podem salvar alterações existentes, mas não podem criar nem remover registros.

## 🧪 Validações recomendadas após atualização

Após aplicar atualizações pelo WebUpdater, validar:

- Login do Super Admin.
- Abertura de cofre existente.
- Adição/edição/exclusão de módulo.
- Cadastro e leitura de credenciais por módulo.
- Busca e filtro por servidor/dispositivo.
- Backup e restauração com arquivo recém-gerado.
- Backup Nuvem com todos os provedores desligados.
- Ativação e desativação de cada provedor remoto.
- Google Drive OAuth com Google Drive API habilitada.
- Teste de conexão do provedor ativo.
- Backup manual nos formatos V1 e V2.
- Histórico paginado com 10 registros por página.
- Máscara da frase de criptografia após salvar.
- Notificação de falha por e-mail, se o SMTP estiver configurado.
- Configurações de segurança, sessões, blacklist/whitelist e política de senhas.
- Configuração SMTP com um servidor de teste controlado antes de habilitar uso real.
- Console do navegador sem `ReferenceError`, `OperationError` ou erro fatal.

## 🤝 Como contribuir

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
- Não exponha senhas, chaves, plaintext de cofres ou dados sensíveis em logs.

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

## 🐛 Reportar bugs

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

- [ ] WebAuthn/FIDO2.
- [ ] Relatórios administrativos avançados.
- [ ] Exportações operacionais por módulo.
- [ ] App mobile.
- [ ] Integração com outros cofres corporativos.

---

**FullPassword** - Cofre Zero-Knowledge para MSPs e equipes de TI.
