#!/bin/sh

# ==============================================================================
# FullPassword - Atualização segura para uso pelo painel/WebUpdater
# Objetivo: atualizar sem exigir SSH recorrente e sem sobrescrever segredos locais.
# ==============================================================================

set -eu

APP_DIR="${APP_DIR:-/opt/fullpassword}"
LOG_PREFIX="[FullPassword Updater]"

log() {
  printf '%s %s %s\n' "$(date -Is)" "$LOG_PREFIX" "$*"
}

fail() {
  log "ERRO: $*"
  exit 1
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    fail "Docker Compose não está disponível"
  fi
}

write_runtime_nginx_conf() {
  runtime_conf_path="${NGINX_CONF_PATH:-./docker/nginx.runtime.conf}"
  domain="$(printf '%s' "$APP_ORIGIN" | sed 's#^https://##;s#/$##')"

  [ -n "$domain" ] || fail "Não foi possível derivar o domínio a partir de APP_ORIGIN"

  log "Regenerando configuração runtime do Nginx para frontend estático em $runtime_conf_path"
  mkdir -p "$(dirname "$runtime_conf_path")"

  cat > "$runtime_conf_path" <<EOF
server {
    listen 80;
    server_name $domain;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $domain;

    ssl_certificate /etc/letsencrypt/live/$domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Frontend estático (React)
    location / {
        proxy_pass http://frontend:80;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Backend API (Node.js)
    location /api/ {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
}

cd "$APP_DIR" || fail "Diretório do projeto não encontrado: $APP_DIR"

[ -d .git ] || fail "Diretório Git não encontrado em $APP_DIR"
[ -f .env ] || fail "Arquivo .env não encontrado. Execute a instalação inicial antes de usar o atualizador."

chmod 600 .env 2>/dev/null || true

# Carrega variáveis locais geradas pelo instalador.
# O arquivo .env é controlado pela instalação e não deve conter comandos.
set -a
. ./.env
set +a

required_vars="DB_HOST DB_USER DB_PASSWORD DB_NAME JWT_SECRET ADMIN_BOOTSTRAP_TOKEN SUPER_ADMIN_EMAIL APP_ORIGIN"
for var_name in $required_vars; do
  eval var_value=\${$var_name:-}
  [ -n "$var_value" ] || fail "Variável obrigatória ausente no .env: $var_name"
done

[ "$DB_PASSWORD" != "fullpassword_pass" ] || fail "DB_PASSWORD padrão é proibida"
[ ${#JWT_SECRET} -ge 64 ] || fail "JWT_SECRET curto demais"
[ ${#ADMIN_BOOTSTRAP_TOKEN} -ge 48 ] || fail "ADMIN_BOOTSTRAP_TOKEN curto demais"

case "$JWT_SECRET" in
  sua_chave_secreta_super_segura_aqui|SEU_JWT_SECRET_GERADO_AQUI|change-me|changeme)
    fail "JWT_SECRET inseguro ou placeholder"
    ;;
esac

case "$APP_ORIGIN" in
  https://*) ;;
  *) fail "APP_ORIGIN deve usar HTTPS" ;;
esac

case "$SUPER_ADMIN_EMAIL" in
  *@*) ;;
  *) fail "SUPER_ADMIN_EMAIL inválido" ;;
esac

log "Validando estado do repositório"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

dirty_tracked="$(git status --porcelain --untracked-files=no)"
if [ -n "$dirty_tracked" ]; then
  printf '%s\n' "$dirty_tracked"
  fail "Existem alterações locais rastreadas. O atualizador foi bloqueado para evitar perda de alterações."
fi

log "Atualizando código-fonte a partir da branch main"
git fetch origin main
git checkout main
git pull --ff-only origin main

write_runtime_nginx_conf

log "Validando Docker Compose"
compose config >/dev/null

log "Reconstruindo e reiniciando containers"
if [ -n "${UPDATE_SERVICES:-}" ]; then
  # O daemon não recria o próprio container durante uma solicitação em andamento.
  # A lista é definida internamente pelo updater, não por entrada HTTP.
  # shellcheck disable=SC2086
  compose up -d --build --remove-orphans $UPDATE_SERVICES
else
  compose up -d --build --remove-orphans
fi
sleep 5
compose restart nginx
compose ps

log "Atualização concluída com sucesso"
