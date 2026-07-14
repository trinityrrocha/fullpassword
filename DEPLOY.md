# FullPassword - Guia de Deploy em Produção (VPS)

Este guia explica como realizar o deploy do FullPassword em uma VPS Linux (Ubuntu 20.04/22.04 LTS ou Debian 11/12) de forma 100% automatizada.

## Pré-requisitos (Importante!)

Antes de executar o script de instalação, você **DEVE** garantir que:

1. **VPS Limpa**: Recomenda-se uma instalação limpa do Ubuntu/Debian.
2. **Apontamento de DNS**: O domínio que você vai usar (ex: `cofre.suaempresa.com.br`) **já deve estar apontando** para o IP público da sua VPS (Registro A). Isso é obrigatório para que o Let's Encrypt consiga gerar o certificado SSL.
3. **Repositório GitHub**: O código do FullPassword deve estar em um repositório Git acessível (público ou com token de acesso se for privado).

## Passo a Passo da Instalação

1. Acesse sua VPS via SSH como root (ou use `sudo su`):
   ```bash
   ssh root@seu_ip_da_vps -p 22
   ```

2. Baixe o script de instalação (substitua a URL pela URL do seu repositório raw):
   ```bash
   wget https://raw.githubusercontent.com/trinityrrocha/fullpassword/main/scripts/install.sh
   ```

3. Dê permissão de execução ao script:
   ```bash
   chmod +x install.sh
   ```

4. Execute o instalador:
   ```bash
   ./install.sh
   ```

## O que o script solicitará?

Durante a execução, o script fará 3 perguntas:

1. **Domínio**: Ex: `cofre.suaempresa.com.br` (Não coloque http/https)
2. **E-mail**: Seu e-mail para receber avisos do Let's Encrypt. O mesmo endereço será usado como e-mail inicial do Super Admin.
3. **Porta SSH**: Se você mudou a porta padrão (22) da sua VPS, informe aqui para que o Firewall (UFW) não bloqueie seu acesso.

## O que o script faz automaticamente?

- Atualiza todo o sistema operacional (`apt update && upgrade`).
- Instala Docker, Docker Compose, Git, UFW, Fail2Ban e Certbot.
- Configura o Firewall (UFW) fechando todas as portas e abrindo apenas: SSH (sua porta), 80 (HTTP) e 443 (HTTPS).
- Configura o Fail2Ban para banir IPs que tentarem ataques de força bruta no SSH.
- Clona o repositório na pasta `/opt/fullpassword`.
- Gera senhas extremamente fortes (24+ caracteres) para o PostgreSQL e JWT Secret e cria o `.env`.
- Gera uma senha temporária aleatória de 32 caracteres e cria automaticamente o Super Admin com `is_super_admin=true` e `must_change_password=true`.
- Gera o certificado SSL/TLS válido (Let's Encrypt).
- Gera `docker/nginx.runtime.conf` para o domínio informado, sem alterar o `docker/nginx.conf` versionado.
- Valida a configuração com `docker compose config`.
- Sobe todos os containers (Banco, Backend, Frontend e Nginx).

## Pós-Instalação

Ao final do script, ele exibirá:
1. O link de acesso.
2. O e-mail inicial do Super Admin, igual ao e-mail usado no certificado.
3. A senha temporária gerada automaticamente.

**Ação Imediata Necessária:**
Acesse `https://seu-dominio.com.br` com o Super Admin criado pelo instalador. No primeiro login será obrigatório trocar a senha temporária. As informações também ficam em `/root/fullpassword-install-info.txt`, protegido com permissão `600`.

## Operação após a instalação

O SSH é usado somente para a primeira instalação. Depois disso, atualizações futuras devem ser executadas no painel por **Configurações do Sistema > WebUpdater**, disponível apenas para o Super Admin persistido no banco.

Não adote `git pull`, rebuild manual ou configuração recorrente por terminal como procedimento operacional. O Certbot mantém a renovação automática do certificado.
