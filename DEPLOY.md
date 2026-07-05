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

Durante a execução, o script fará 4 perguntas:

1. **Domínio**: Ex: `cofre.suaempresa.com.br` (Não coloque http/https)
2. **E-mail**: Seu e-mail para receber avisos de expiração do SSL da Let's Encrypt.
3. **Porta SSH**: Se você mudou a porta padrão (22) da sua VPS, informe aqui para que o Firewall (UFW) não bloqueie seu acesso.
4. **URL do Repositório**: Ex: `https://github.com/trinityrrocha/fullpassword.git`

## O que o script faz automaticamente?

- Atualiza todo o sistema operacional (`apt update && upgrade`).
- Instala Docker, Docker Compose, Git, UFW, Fail2Ban e Certbot.
- Configura o Firewall (UFW) fechando todas as portas e abrindo apenas: SSH (sua porta), 80 (HTTP) e 443 (HTTPS).
- Configura o Fail2Ban para banir IPs que tentarem ataques de força bruta no SSH.
- Clona o repositório na pasta `/opt/fullpassword`.
- Gera senhas extremamente fortes (24+ caracteres) para o PostgreSQL e JWT Secret e cria o `.env`.
- Gera o certificado SSL/TLS válido (Let's Encrypt).
- Configura o Nginx como Proxy Reverso com SSL ativado.
- Sobe todos os containers (Banco, Backend, Frontend e Nginx).

## Pós-Instalação

Ao final do script, ele exibirá:
1. As credenciais geradas para o banco de dados.
2. As credenciais do usuário Administrador padrão (`admin@admin.com.br` / `@dmin123`).

**Ação Imediata Necessária:**
Acesse `https://seu-dominio.com.br`, faça login com o usuário padrão e **ALTERE A SENHA IMEDIATAMENTE**, pois a senha padrão é de conhecimento público e é a base para derivar a Master Key do cofre.

## Manutenção e Comandos Úteis

O projeto fica instalado em `/opt/fullpassword`.

**Ver logs do backend:**
```bash
cd /opt/fullpassword
docker-compose logs -f backend
```

**Reiniciar serviços:**
```bash
cd /opt/fullpassword
docker-compose restart
```

**Atualizar o sistema (Nova versão do Git):**
```bash
cd /opt/fullpassword
git pull
docker-compose up -d --build
```

**Renovar Certificado SSL (Normalmente é automático):**
```bash
certbot renew
docker-compose restart nginx
```
