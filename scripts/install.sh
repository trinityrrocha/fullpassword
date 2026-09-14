#!/bin/bash
# FullPassword - Ubuntu 20.04/22.04/24.04 e Debian 11/12/13 (Trixie).
# Modos: IP público ou Cloudflare Tunnel.
# Não use bash -x: o instalador manipula segredos em memória.
set -eE
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
REPO_URL=https://github.com/trinityrrocha/fullpassword.git
RUNTIME_NGINX_CONF=./docker/nginx.runtime.conf
BACKUP_CHUNK_SIZE_MB=50
BACKUP_MAX_UPLOAD_MB=200
BACKUP_TEMP_DIR=/tmp/fullpassword-backups
BACKUP_RESTORE_TIMEOUT_MS=1800000
INSTALL_STAGE=preflight
OS_LABEL='não detectado'
CLOUDFLARE_RESOURCES_MAY_EXIST=false

fail() {
    printf 'ERRO: %s\nInstalação incompleta. Etapa: %s. Sistema: %s\n' "$*" "$INSTALL_STAGE" "$OS_LABEL" >&2
    printf '%s\n' 'Esta instalação parcial não deve ser considerada válida para produção.' \
        'Revise os logs. Em VM de teste, após corrigir o instalador, limpe a VM ou remova a instalação parcial e execute novamente do início.' \
        'Não apague volumes em produção sem backup.' >&2
    case "$INSTALL_STAGE" in
        apt)
            printf '%s\n' 'Revise a mensagem do APT acima para identificar o pacote/repositório que falhou.' \
                'Verifique os repositórios da versão detectada em /etc/apt/sources.list e /etc/apt/sources.list.d/.' \
                'Não misture repositórios Debian de outra versão (Bookworm, Trixie ou Sid).' >&2 ;;
        cloudflared)
            printf '%s\n' 'Diagnóstico: sudo systemctl status cloudflared' \
                'sudo journalctl -u cloudflared --no-pager -n 80' \
                'Configuração: /etc/cloudflared/config.yml (root-only)' >&2 ;;
        docker|healthcheck)
            print_docker_diagnostics >&2 || true ;;
    esac
    if [ "$CLOUDFLARE_RESOURCES_MAY_EXIST" = true ] && [ "$INSTALL_STAGE" != diagnostics ]; then
        printf '%bATENÇÃO: O túnel Cloudflare e/ou o registro DNS podem já ter sido criados.%b\n' "$YELLOW" "$NC" >&2
        printf '%s\n' 'Como a instalação não foi concluída, revise esses recursos no painel Cloudflare antes de iniciar uma nova VM de teste com o mesmo hostname.' \
            'Nenhum túnel, registro DNS ou credencial será removido automaticamente.' >&2
    fi
    exit 1
}

print_docker_diagnostics() (
    # Diagnóstico best-effort: não substituir o erro original nem entrar em
    # recursão se Docker/Compose também estiverem indisponíveis.
    trap - ERR
    set +e
    INSTALL_STAGE=diagnostics
    printf '\n%bDiagnóstico Docker (somente leitura):%b\n' "$BLUE" "$NC"
    (compose --project-directory "$APP_DIR" ps) || true
    (compose --project-directory "$APP_DIR" logs --tail=200 db) || true
    (compose --project-directory "$APP_DIR" logs --tail=100 backend) || true
    (compose --project-directory "$APP_DIR" logs --tail=100 nginx) || true
    local health
    health=$(docker inspect fullpassword_db --format '{{json .State.Health}}' 2>/dev/null) || health=''
    if [ -n "$health" ]; then
        printf '\nHealthcheck do fullpassword_db:\n'
        if command -v jq >/dev/null 2>&1; then
            printf '%s\n' "$health" | jq . || printf '%s\n' "$health"
        else
            printf '%s\n' "$health"
        fi
        if printf '%s\n' "$health" | grep -Eq '"Status"[[:space:]]*:[[:space:]]*"unhealthy"'; then
            printf '%bERRO: O container PostgreSQL `fullpassword_db` não ficou saudável.%b\n' "$RED" "$NC"
            cat <<'DIAG'
Possíveis causas:
- falha no init.sql;
- volume PostgreSQL parcialmente inicializado de tentativa anterior;
- senha/variáveis inválidas no .env;
- problema de permissão no volume;
- tempo insuficiente para inicialização;
- imagem PostgreSQL com falha de download/inicialização.

Ações recomendadas:
1. Revise os logs acima.
2. Se for VM de teste e não houver dados importantes, remova a instalação incompleta antes de tentar novamente.
3. Não apague volumes em produção sem backup.
DIAG
        fi
    else
        printf 'Healthcheck indisponível: container ainda não criado ou Docker inacessível.\n'
    fi
    printf '\nComandos de diagnóstico (diretório da instalação: %s):\n' "$APP_DIR"
    printf 'sudo docker compose --project-directory "%s" ps\n' "$APP_DIR"
    printf 'sudo docker compose --project-directory "%s" logs --tail=200 db\n' "$APP_DIR"
    printf 'sudo docker compose --project-directory "%s" logs --tail=100 backend\n' "$APP_DIR"
    printf 'sudo docker compose --project-directory "%s" logs --tail=100 nginx\n' "$APP_DIR"
    printf 'Alternativa com acesso root ao diretório:\n'
    printf "sudo bash -lc 'cd \"%s\" && docker compose ps'\n" "$APP_DIR"
    printf "sudo bash -lc 'cd \"%s\" && docker compose logs --tail=200 db'\n" "$APP_DIR"
    printf '%s\n' "sudo docker inspect fullpassword_db --format '{{json .State.Health}}' | jq ."
)

detect_os() {
    local release_file="${1:-/etc/os-release}"
    local ID='' VERSION_ID='' PRETTY_NAME=''
    [ -r "$release_file" ] || fail 'Não foi possível ler /etc/os-release.'
    . "$release_file"
    OS_LABEL="${PRETTY_NAME:-$ID $VERSION_ID}"
    case "$ID:$VERSION_ID" in
        ubuntu:20.04|ubuntu:22.04|ubuntu:24.04|debian:11|debian:12|debian:13)
            printf 'Sistema detectado: %s — suportado.\n' "$OS_LABEL" ;;
        *) fail 'Sistema não suportado. Use Ubuntu 20.04/22.04/24.04 ou Debian 11/12/13.' ;;
    esac
}

resolve_app_dir() {
    APP_DIR="${FULLPASSWORD_APP_DIR:-/opt/fullpassword}"
    [[ "$APP_DIR" =~ ^(/[a-zA-Z0-9_-]+){2,}$ ]] \
        || fail 'Use um diretório absoluto dedicado, sem espaços, pontos ou caracteres especiais; /, /opt, /home e /root não são destinos válidos.'
    # Não permitir que um symlink desvie o destino validado para outro local.
    local resolved
    resolved=$(readlink -m -- "$APP_DIR") || fail 'Não foi possível validar o diretório de instalação.'
    [ "$resolved" = "$APP_DIR" ] || fail 'O diretório de instalação não pode conter links simbólicos.'
}

run_apt() {
    local previous_stage="$INSTALL_STAGE"
    INSTALL_STAGE=apt
    apt-get "$@" || fail "Falha no APT: apt-get $*"
    INSTALL_STAGE="$previous_stage"
}

compose() {
    if docker compose version >/dev/null 2>&1; then
        docker compose "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose "$@"
    else
        fail 'Docker Compose não está disponível.'
    fi
}

select_install_mode() {
    cat <<'MENU'
Selecione o modo de instalação:
1) Instalação com IP público
   - Requer domínio apontando para o IP público da VPS
   - Requer portas 80/443 abertas externamente
   - Usa Let's Encrypt/Certbot no servidor
2) Instalação com Cloudflare Tunnel
   - Não requer IP público nem portas 80/443 abertas externamente
   - Requer domínio gerenciado na Cloudflare
   - Usa HTTPS na borda da Cloudflare
MENU
    read -r -p 'Opção (1/2): ' choice
    case "$choice" in
        1) INSTALL_MODE=public_ip; NGINX_HTTP_BIND=80; NGINX_HTTPS_BIND=443 ;;
        2) INSTALL_MODE=cloudflare_tunnel; NGINX_HTTP_BIND=127.0.0.1:80; NGINX_HTTPS_BIND=127.0.0.1:443 ;;
        *) fail 'Opção inválida. Selecione somente 1 ou 2.' ;;
    esac
}

collect_install_settings() {
    read -r -p 'Domínio do FullPassword (ex: cofre.seudominio.com.br): ' DOMAIN
    [[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$ ]] \
        || fail 'Domínio inválido; informe apenas o hostname, sem URL ou porta.'
    DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')
    if [ "$INSTALL_MODE" = public_ip ]; then
        read -r -p "Digite seu e-mail para o certificado Let's Encrypt e Super Admin: " SUPER_ADMIN_EMAIL
    else
        read -r -p 'Digite o e-mail do Super Admin: ' SUPER_ADMIN_EMAIL
    fi
    [[ "$SUPER_ADMIN_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || fail 'E-mail inválido.'
    LETSENCRYPT_EMAIL="$SUPER_ADMIN_EMAIL"
    read -r -p 'Porta SSH atual [22]: ' SSH_PORT
    [ -n "$SSH_PORT" ] || SSH_PORT=22
    [[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$SSH_PORT >= 1 && 10#$SSH_PORT <= 65535)) || fail 'Porta SSH inválida.'
    SSH_PORT=$((10#$SSH_PORT))
    resolve_app_dir
    if [ -e "$APP_DIR" ]; then
        [ -d "$APP_DIR/.git" ] || fail 'Diretório existente não é uma instalação Git. Escolha outro diretório.'
        echo "ATENÇÃO: já existe uma instalação em $APP_DIR; continuar pode interrompê-la."
        read -r -p 'Digite REINSTALAR para confirmar o backup e substituição: ' confirmation
        [ "$confirmation" = REINSTALAR ] || fail 'Instalação abortada sem substituir a existente.'
    fi
    if [ "$INSTALL_MODE" = cloudflare_tunnel ]; then
        [ ! -e /etc/cloudflared/config.yml ] && ! systemctl cat cloudflared.service >/dev/null 2>&1 \
            || fail 'Já existe configuração/serviço cloudflared. Preserve-o e revise antes de instalar.'
    fi
}

install_base_dependencies() {
    run_apt update
    run_apt upgrade -y
    run_apt install -y curl git ufw fail2ban apt-transport-https ca-certificates netcat-openbsd dnsutils openssl jq
    if [ "$INSTALL_MODE" = public_ip ]; then
        run_apt install -y certbot python3-certbot-nginx
    fi
}

config_encryption_key_is_placeholder() {
    case "${CONFIG_ENCRYPTION_KEY:-}" in
        GERE_*|gere_*|changeme|CHANGE_ME|change-me|CHANGE-ME|example|EXAMPLE) return 0 ;;
        *) return 1 ;;
    esac
}

config_encryption_key_is_valid() {
    [ -n "${CONFIG_ENCRYPTION_KEY:-}" ] || return 1
    config_encryption_key_is_placeholder && return 1
    decoded_size=$(printf '%s' "$CONFIG_ENCRYPTION_KEY" | openssl base64 -d -A 2>/dev/null | wc -c | tr -d ' ')
    round_trip=$(printf '%s' "$CONFIG_ENCRYPTION_KEY" | openssl base64 -d -A 2>/dev/null | openssl base64 -A 2>/dev/null)
    [ "$decoded_size" = "32" ] && [ "$round_trip" = "$CONFIG_ENCRYPTION_KEY" ]
}

ensure_config_encryption_key() {
    if config_encryption_key_is_valid; then
        return
    fi
    CONFIG_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
    export CONFIG_ENCRYPTION_KEY
    echo -e "${GREEN}CONFIG_ENCRYPTION_KEY ausente; uma nova chave foi gerada para o .env sem ser exibida.${NC}"
    echo -e "${YELLOW}Preserve essa chave: trocá-la impede descriptografar senhas SMTP já salvas.${NC}"
}

generate_secrets() {
    DB_PASSWORD=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 40)
    JWT_SECRET=$(openssl rand -hex 64)
    ADMIN_BOOTSTRAP_TOKEN=$(openssl rand -hex 32)
    ensure_config_encryption_key
    INITIAL_PASSWORD_RANDOM=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 28)
    INITIAL_SUPER_ADMIN_PASSWORD="${INITIAL_PASSWORD_RANDOM}Aa1!"
}

configure_firewall() {
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow "$SSH_PORT/tcp"
    if [ "$INSTALL_MODE" = public_ip ]; then
        ufw allow 80/tcp
        ufw allow 443/tcp
    else
        echo 'Sem HTTP/HTTPS de entrada. O cloudflared usa conexões de saída para a Cloudflare.'
    fi
    ufw --force enable
}

configure_fail2ban() {
    cat > /etc/fail2ban/jail.local << EOF
[sshd]
enabled = true
port = $SSH_PORT
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600
EOF
    systemctl restart fail2ban
    systemctl enable fail2ban
}

install_docker() {
if ! command -v docker &> /dev/null; then
    echo "Instalando Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    systemctl start docker
    systemctl enable docker
else
    echo "Docker já está instalado."
fi

if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose &> /dev/null; then
    echo "Instalando Docker Compose standalone..."
    curl -fL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
else
    echo "Docker Compose já está disponível."
fi
}

clone_repository() {
    if [ -d "$APP_DIR" ]; then
        mv "$APP_DIR" "$APP_DIR-backup-$(date +%Y%m%d_%H%M%S)"
    fi
    # Código versionado navegável/legível, mesmo se o sudo herdou umask 077.
    (umask 022; git clone "$REPO_URL" "$APP_DIR")
    chown root:root "$APP_DIR"
    chmod 755 "$APP_DIR"
    if [ "$APP_DIR" = /opt/fullpassword ]; then
        chmod 755 /opt
    fi
    cd "$APP_DIR"
}

generate_env() (
    umask 077
cat > "$APP_DIR/.env" << EOF
INSTALL_MODE=$INSTALL_MODE
NGINX_HTTP_BIND=$NGINX_HTTP_BIND
NGINX_HTTPS_BIND=$NGINX_HTTPS_BIND
# Configurações de Banco de Dados
DB_HOST=db
DB_PORT=5432
DB_USER=fullpassword_user
DB_PASSWORD=$DB_PASSWORD
DB_NAME=fullpassword_db

# Configurações do Backend
PORT=3000
NODE_ENV=production
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=8h
ADMIN_BOOTSTRAP_TOKEN=$ADMIN_BOOTSTRAP_TOKEN
CONFIG_ENCRYPTION_KEY=$CONFIG_ENCRYPTION_KEY
SUPER_ADMIN_EMAIL=$SUPER_ADMIN_EMAIL
APP_ORIGIN=https://$DOMAIN

# Google Drive Backup (fallback opcional; configuração principal disponível pela UI)
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REDIRECT_URI=https://$DOMAIN/api/integrations/google-drive/oauth/callback

# Configurações de Backup v2
BACKUP_CHUNK_SIZE_MB=$BACKUP_CHUNK_SIZE_MB
BACKUP_MAX_UPLOAD_MB=$BACKUP_MAX_UPLOAD_MB
BACKUP_TEMP_DIR=$BACKUP_TEMP_DIR
BACKUP_RESTORE_TIMEOUT_MS=$BACKUP_RESTORE_TIMEOUT_MS

# Configurações do Frontend
VITE_API_URL=https://$DOMAIN/api

# Configuração runtime do Nginx gerada pelo instalador
NGINX_CONF_PATH=$RUNTIME_NGINX_CONF
EOF
chmod 600 "$APP_DIR/.env"
chown root:root "$APP_DIR/.env"
)

provision_letsencrypt_certificate() {
# Verificar IP Público
PUBLIC_IP=$(curl -fsS https://ifconfig.me)
[ -n "$PUBLIC_IP" ] || fail 'Não foi possível determinar o IP público.'
echo -e "${BLUE}Seu IP público atual é: $PUBLIC_IP${NC}"

# Verificar apontamento DNS
DOMAIN_IP=$(dig +short "$DOMAIN" | tail -n 1)
if [ "$DOMAIN_IP" != "$PUBLIC_IP" ]; then
    echo -e "${RED}ERRO CRÍTICO: O domínio $DOMAIN aponta para $DOMAIN_IP, mas o IP desta VPS é $PUBLIC_IP.${NC}"
    echo -e "${YELLOW}Por favor, corrija o apontamento DNS no seu provedor (Cloudflare, Registro.br, etc) e aguarde a propagação antes de rodar este script novamente.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ DNS aponta corretamente para o IP da VPS.${NC}"

# Avisar sobre portas externas (Firewall de Nuvem)
echo -e "\n${YELLOW}ATENÇÃO: O Certbot requer as portas 80 e 443 abertas externamente.${NC}"
echo -e "${YELLOW}Se você estiver usando AWS, Oracle Cloud, Google Cloud ou Azure, certifique-se de que as portas 80 e 443 estão liberadas nas regras de segurança (Security Groups / Ingress Rules) do painel web da nuvem.${NC}"
echo -e "${YELLOW}O UFW local já foi configurado, mas o bloqueio em nuvem impedirá a emissão do certificado.${NC}"
read -p "Você já liberou as portas 80 e 443 no painel do seu provedor de nuvem? (s/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    echo -e "${RED}Instalação abortada. Por favor, libere as portas e rode o script novamente.${NC}"
    exit 1
fi

echo -e "\n${GREEN}Provisionando Certificado SSL Let's Encrypt para $DOMAIN...${NC}"

# Parar o nginx temporariamente se estiver rodando para liberar a porta 80
systemctl stop nginx 2>/dev/null || true

    certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" \
        || fail 'Falha no Certbot. Verifique DNS e firewall externo nas portas 80/443.'
}

generate_nginx_config() {
    local proxy_proto='https'
    if [ "$INSTALL_MODE" = public_ip ]; then
        proxy_proto='$scheme'
        cat > "$APP_DIR/docker/nginx.runtime.conf" << EOF
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

EOF
    else
        cat > "$APP_DIR/docker/nginx.runtime.conf" << EOF
server {
    listen 80;
    server_name $DOMAIN;
EOF
    fi
    cat >> "$APP_DIR/docker/nginx.runtime.conf" << EOF
    # Frontend estático (React)
    location / {
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "display-capture=(), camera=(), microphone=(), geolocation=()" always;

        proxy_pass http://frontend:80;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $proxy_proto;
    }

    # Restore usa streaming para disco e possui limite dedicado.
    location ^~ /api/system/backup/restore {
        client_max_body_size $((BACKUP_MAX_UPLOAD_MB + 1))m;
        proxy_read_timeout $((BACKUP_RESTORE_TIMEOUT_MS / 1000))s;
        proxy_send_timeout $((BACKUP_RESTORE_TIMEOUT_MS / 1000))s;
        proxy_pass http://backend:3000;
        proxy_request_buffering off;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $proxy_proto;
    }

    # Backend API (Node.js). O backend aplica 2 MB por padrão e 10 MB no vault.
    location /api/ {
        client_max_body_size 12m;
        proxy_read_timeout $((BACKUP_RESTORE_TIMEOUT_MS / 1000))s;
        proxy_send_timeout $((BACKUP_RESTORE_TIMEOUT_MS / 1000))s;
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $proxy_proto;
    }
}
EOF
}

install_cloudflared() {
    INSTALL_STAGE=cloudflared
    mkdir -p --mode=0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
    chmod 644 /usr/share/keyrings/cloudflare-main.gpg
    printf '%s\n' 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
        > /etc/apt/sources.list.d/cloudflared.list
    chmod 644 /etc/apt/sources.list.d/cloudflared.list
    run_apt update
    run_apt install -y cloudflared
}

configure_cloudflare_tunnel() {
    INSTALL_STAGE=cloudflared
    export HOME=/root
    printf '\n%b================================================================%b\n' "$GREEN" "$NC"
    printf '%bABRA O LINK NO NAVEGADOR, FAÇA LOGIN NA CLOUDFLARE, SELECIONE A ZONE CORRETA E VOLTE AO TERMINAL.%b\n' "$GREEN" "$NC"
    printf '%b================================================================%b\n' "$GREEN" "$NC"
    printf '%bA próxima saída em inglês é gerada pelo próprio cloudflared. Não feche o terminal. Ele ficará aguardando até o login ser concluído.%b\n' "$YELLOW" "$NC"
    printf '%bDepois do login, o cloudflared salvará o certificado automaticamente e o instalador continuará.%b\n\n' "$BLUE" "$NC"
    # Sem pipe/wrapper: preserva URL, interatividade e código de saída nativos.
    (umask 077; cloudflared tunnel login) || fail 'Falha na autenticação Cloudflare.'
    [ -s /root/.cloudflared/cert.pem ] || fail 'Autenticação não gerou /root/.cloudflared/cert.pem.'
    chmod 600 /root/.cloudflared/cert.pem
    TUNNEL_NAME="fullpassword-$(printf '%s' "$DOMAIN" | tr '.' '-' | tr -cd 'a-zA-Z0-9_-')"
    local credentials_dir
    credentials_dir=$(mktemp -d /root/.cloudflared/fullpassword.XXXXXX)
    chmod 700 "$credentials_dir"
    # Caminho explícito e JSON: não depende de parsing do stdout da CLI.
    # Marcar antes da chamada: uma falha de rede pode ocorrer após a criação remota.
    CLOUDFLARE_RESOURCES_MAY_EXIST=true
    cloudflared tunnel create --credentials-file "$credentials_dir/tunnel.json" "$TUNNEL_NAME" \
        || fail 'Falha ao criar túnel; verifique se o nome já existe.'
    [ -s "$credentials_dir/tunnel.json" ] || fail 'Arquivo de credenciais do túnel não encontrado.'
    chmod 600 "$credentials_dir/tunnel.json"
    TUNNEL_UUID=$(jq -er '.TunnelID | strings' "$credentials_dir/tunnel.json") || fail 'UUID ausente nas credenciais.'
    [[ "$TUNNEL_UUID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
        || fail 'UUID do túnel inválido.'
    echo 'Remova registros A/AAAA conflitantes deste hostname no painel Cloudflare.'
    echo 'A próxima etapa criará um CNAME apontando para o túnel.'
    read -r -p 'Removeu os registros conflitantes e confirma que o domínio está na Cloudflare? (s/n) ' confirmation
    [[ "$confirmation" =~ ^[Ss]$ ]] || fail 'Rota DNS não criada. O túnel já criado permanece na sua conta.'
    cloudflared tunnel route dns "$TUNNEL_UUID" "$DOMAIN" || fail 'Falha ao criar rota DNS; revise os registros na Cloudflare.'
    mkdir -p /etc/cloudflared
    chmod 755 /etc/cloudflared
    install -m 600 "$credentials_dir/tunnel.json" "/etc/cloudflared/$TUNNEL_UUID.json"
    (umask 077; cat > /etc/cloudflared/config.yml << EOF
tunnel: $TUNNEL_UUID
credentials-file: /etc/cloudflared/$TUNNEL_UUID.json

ingress:
  - hostname: $DOMAIN
    service: http://localhost:80
  - service: http_status:404
EOF
    )
    chmod 600 /etc/cloudflared/config.yml
    cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate || fail 'Configuração ingress inválida.'
    cloudflared tunnel --config /etc/cloudflared/config.yml ingress rule "https://$DOMAIN" || fail 'Hostname não corresponde ao ingress.'
    # Só identificadores públicos; nunca credenciais ou tokens no .env.
    printf '\nCLOUDFLARE_TUNNEL_NAME=%s\nCLOUDFLARE_TUNNEL_UUID=%s\n' "$TUNNEL_NAME" "$TUNNEL_UUID" >> "$APP_DIR/.env"
    rm -f "$credentials_dir/tunnel.json"
    rmdir "$credentials_dir"
}

start_cloudflared_service() {
    INSTALL_STAGE=cloudflared
    if ! cloudflared --config /etc/cloudflared/config.yml service install \
        || ! systemctl enable cloudflared \
        || ! systemctl restart cloudflared \
        || ! systemctl is-active --quiet cloudflared; then
        journalctl -u cloudflared --no-pager -n 80 >&2 || true
        fail 'Serviço cloudflared não iniciou. Instalação incompleta.'
    fi
    cloudflared tunnel info "$TUNNEL_UUID" || true
}

wait_for_container_health() {
    local container_name="$1" timeout_seconds="${2:-300}" elapsed=0 status
    while [ "$elapsed" -lt "$timeout_seconds" ]; do
        status=$(docker inspect "$container_name" --format '{{.State.Health.Status}}' 2>/dev/null || true)
        if [ "$status" = healthy ]; then
            printf '%b%s está healthy.%b\n' "$GREEN" "$container_name" "$NC"
            return 0
        fi
        printf '%bAguardando %s ficar healthy... (%s/%ss). Status atual: %s%b\n' \
            "$YELLOW" "$container_name" "$elapsed" "$timeout_seconds" "${status:-indisponível}" "$NC"
        sleep 5
        elapsed=$((elapsed + 5))
    done
    printf '%bERRO: O PostgreSQL não ficou saudável dentro do tempo limite.%b\n' "$RED" "$NC" >&2
    return 1
}

start_containers() {
    INSTALL_STAGE=docker
    systemctl disable nginx 2>/dev/null || true
    systemctl stop nginx 2>/dev/null || true
    export VITE_APP_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    compose config >/dev/null || fail 'Docker Compose inválido.'
    local db_failure_marker
    db_failure_marker=$(mktemp)
    # Mantém o build visível e preserva seu exit code. O arquivo temporário
    # contém somente o marcador "db", nunca a saída ou segredos do build.
    if (set -o pipefail; compose up -d --build 2>&1 | awk -v marker="$db_failure_marker" '
        { print; fflush() }
        tolower($0) ~ /db failed|dependency failed|unhealthy|fullpassword_db.*(error|fail)|(error|fail).*fullpassword_db/ {
            print "db" > marker
        }
    '); then
        rm -f "$db_failure_marker"
        wait_for_container_health fullpassword_db 300 \
            || fail 'O container PostgreSQL `fullpassword_db` não ficou saudável após 300 segundos.'
    else
        if [ ! -s "$db_failure_marker" ]; then
            rm -f "$db_failure_marker"
            fail 'Falha ao subir containers; erro não identificado como inicialização do PostgreSQL.'
        fi
        rm -f "$db_failure_marker"
        docker inspect fullpassword_db --format '{{.State.Status}}' >/dev/null 2>&1 \
            || fail 'Falha no Compose e container fullpassword_db ausente ou inacessível; não será feita retentativa.'
        printf '%bDocker Compose retornou falha de dependência. Aguardando PostgreSQL por até 300 segundos...%b\n' "$YELLOW" "$NC"
        if wait_for_container_health fullpassword_db 300; then
            printf '%bPostgreSQL ficou saudável. Reexecutando docker compose up -d...%b\n' "$GREEN" "$NC"
            compose up -d || fail 'Falha ao subir serviços dependentes após PostgreSQL healthy.'
        else
            fail 'O container PostgreSQL `fullpassword_db` não ficou saudável após 300 segundos.'
        fi
    fi
    [ "$(docker inspect fullpassword_db --format '{{.State.Health.Status}}' 2>/dev/null || true)" = healthy ] \
        || fail 'PostgreSQL perdeu o estado healthy; instalação incompleta.'
INSTALL_STAGE=healthcheck
echo -e "${GREEN}Aguardando o backend responder ao healthcheck...${NC}"
BACKEND_READY=false
for attempt in $(seq 1 30); do
    if compose exec -T backend node -e \
        "fetch('http://127.0.0.1:3000/api/health', {signal: AbortSignal.timeout(2000)}).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))" \
        >/dev/null 2>&1; then
        BACKEND_READY=true
        break
    fi
    echo -e "${YELLOW}Backend ainda não está pronto (tentativa $attempt/30).${NC}"
    sleep 2
done

if [ "$BACKEND_READY" != "true" ]; then
    echo -e "${RED}ERRO: o backend não respondeu ao healthcheck após 30 tentativas.${NC}"
    fail 'Backend não respondeu ao healthcheck; instalação incompleta.'
fi
}

create_initial_super_admin() {
INSTALL_STAGE=docker
compose exec -T \
    -e INITIAL_SUPER_ADMIN_EMAIL="$SUPER_ADMIN_EMAIL" \
    -e INITIAL_SUPER_ADMIN_PASSWORD="$INITIAL_SUPER_ADMIN_PASSWORD" \
    -e INITIAL_SUPER_ADMIN_NAME="Super Admin" \
    backend node scripts/create-super-admin.js || fail 'Falha ao criar o Super Admin.'
}

show_install_summary() (
umask 077
cat > /root/fullpassword-install-info.txt << EOF
Modo de instalação: $INSTALL_MODE
URL: https://$DOMAIN
Diretório da instalação: $APP_DIR
E-mail do Super Admin: $SUPER_ADMIN_EMAIL
Senha temporária: $INITIAL_SUPER_ADMIN_PASSWORD
Aviso: No primeiro login será obrigatório trocar a senha temporária.
EOF
if [ "$INSTALL_MODE" = cloudflare_tunnel ]; then
    cat >> /root/fullpassword-install-info.txt << EOF
Tunnel name: $TUNNEL_NAME
Tunnel UUID: $TUNNEL_UUID
Cloudflared config: /etc/cloudflared/config.yml
Cloudflared service: cloudflared
EOF
    echo 'Instalação concluída com Cloudflare Tunnel.'
    echo 'Sem IP público ou portas 80/443 externas; Cloudflare encaminha para http://localhost:80.'
    echo 'sudo systemctl status cloudflared'
    echo 'sudo journalctl -u cloudflared --no-pager -n 80'
    echo "sudo cloudflared tunnel info $TUNNEL_UUID"
fi
chmod 600 /root/fullpassword-install-info.txt

echo -e "\n${BLUE}======================================================${NC}"
echo -e "${GREEN}  Instalação Concluída com Sucesso! ${NC}"
echo -e "${BLUE}======================================================${NC}"
echo -e "\n${YELLOW}Credenciais de Banco de Dados geradas e salvas no .env.${NC}"
echo -e "\n${GREEN}Link de acesso: https://$DOMAIN${NC}"
echo -e "${YELLOW}Usuário Super Admin: $SUPER_ADMIN_EMAIL${NC}"
echo -e "${YELLOW}Senha temporária: $INITIAL_SUPER_ADMIN_PASSWORD${NC}"
echo -e "${YELLOW}No primeiro login será obrigatório trocar a senha temporária.${NC}"
echo -e "${YELLOW}Uma cópia root-only foi salva em: /root/fullpassword-install-info.txt${NC}"
echo -e "${BLUE}======================================================${NC}"
)

main() {
    [ "$EUID" -eq 0 ] || fail 'Execute como root: sudo ./install.sh'
    trap 'fail "Comando da instalação falhou; instalação incompleta."' ERR
    detect_os
    select_install_mode
    collect_install_settings
    install_base_dependencies
    INSTALL_STAGE=secrets
    generate_secrets
    INSTALL_STAGE=firewall
    configure_firewall
    configure_fail2ban
    INSTALL_STAGE=docker
    install_docker
    INSTALL_STAGE=repository
    clone_repository
    generate_env
    if [ "$INSTALL_MODE" = public_ip ]; then
        INSTALL_STAGE=certbot
        provision_letsencrypt_certificate
    fi
    INSTALL_STAGE=nginx
    generate_nginx_config
    if [ "$INSTALL_MODE" = cloudflare_tunnel ]; then
        install_cloudflared
        configure_cloudflare_tunnel
    fi
    start_containers
    if [ "$INSTALL_MODE" = cloudflare_tunnel ]; then
        start_cloudflared_service
    fi
    create_initial_super_admin
    INSTALL_STAGE=summary
    show_install_summary
}

# Permite testes das funções sem executar instalação.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
