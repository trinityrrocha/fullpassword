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
  backup_max_upload_mb="${BACKUP_MAX_UPLOAD_MB:-200}"
  backup_restore_timeout_ms="${BACKUP_RESTORE_TIMEOUT_MS:-1800000}"

  [ -n "$domain" ] || fail "Não foi possível derivar o domínio a partir de APP_ORIGIN"

  log "Regenerando configuração runtime do Nginx para frontend estático em $runtime_conf_path"
  case "$backup_max_upload_mb" in ''|*[!0-9]*) fail "BACKUP_MAX_UPLOAD_MB inválido no .env" ;; esac
  case "$backup_restore_timeout_ms" in ''|*[!0-9]*) fail "BACKUP_RESTORE_TIMEOUT_MS inválido no .env" ;; esac
  if [ "$backup_max_upload_mb" -gt 512 ]; then
    log "BACKUP_MAX_UPLOAD_MB legado acima do limite seguro; usando 200 MB nesta atualização"
    backup_max_upload_mb=200
    BACKUP_MAX_UPLOAD_MB=$backup_max_upload_mb
    export BACKUP_MAX_UPLOAD_MB
  fi
  [ "$backup_max_upload_mb" -ge 1 ] && [ "$backup_max_upload_mb" -le 512 ] \
    || fail "BACKUP_MAX_UPLOAD_MB deve estar entre 1 e 512"
  [ "$backup_restore_timeout_ms" -ge 60000 ] && [ "$backup_restore_timeout_ms" -le 14400000 ] \
    || fail "BACKUP_RESTORE_TIMEOUT_MS deve estar entre 60000 e 14400000"
  backup_restore_timeout_seconds=$((backup_restore_timeout_ms / 1000))
  backup_nginx_max_upload_mb=$((backup_max_upload_mb + 1))

  mkdir -p "$(dirname "$runtime_conf_path")"

  case "${INSTALL_MODE:-public_ip}" in
    public_ip) proxy_proto='$scheme' ;;
    cloudflare_tunnel) proxy_proto=https ;;
    *) fail "INSTALL_MODE inválido" ;;
  esac

  if [ "${INSTALL_MODE:-public_ip}" = public_ip ]; then
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

EOF
  else
    cat > "$runtime_conf_path" <<EOF
server {
    listen 80;
    server_name $domain;
EOF
  fi
  cat >> "$runtime_conf_path" <<EOF
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
        client_max_body_size ${backup_nginx_max_upload_mb}m;
        proxy_read_timeout ${backup_restore_timeout_seconds}s;
        proxy_send_timeout ${backup_restore_timeout_seconds}s;
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
        proxy_read_timeout ${backup_restore_timeout_seconds}s;
        proxy_send_timeout ${backup_restore_timeout_seconds}s;
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $proxy_proto;
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

config_encryption_key_is_placeholder() {
  case "${CONFIG_ENCRYPTION_KEY:-}" in
    GERE_*|gere_*|changeme|CHANGE_ME|change-me|CHANGE-ME|example|EXAMPLE) return 0 ;;
    *) return 1 ;;
  esac
}

config_encryption_key_is_valid() {
  [ -n "${CONFIG_ENCRYPTION_KEY:-}" ] || return 1
  config_encryption_key_is_placeholder && return 1
  node -e "
    const value = String(process.env.CONFIG_ENCRYPTION_KEY || '').trim();
    const key = Buffer.from(value, 'base64');
    process.exit(
      value.length % 4 === 0
      && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
      && key.length === 32
      && key.toString('base64') === value
        ? 0
        : 1
    );
  " >/dev/null 2>&1
}

ensure_config_encryption_key() {
  if config_encryption_key_is_valid; then
    return
  fi

  CONFIG_ENCRYPTION_KEY="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")" \
    || fail "CONFIG_ENCRYPTION_KEY ausente. Gere com: openssl rand -base64 32"
  export CONFIG_ENCRYPTION_KEY

  env_tmp="$(mktemp .env.config-key.XXXXXX)" || fail "Não foi possível preparar a atualização segura do .env"
  chmod 600 "$env_tmp"
  awk '!/^[[:space:]]*(export[[:space:]]+)?CONFIG_ENCRYPTION_KEY[[:space:]]*=/' .env > "$env_tmp" \
    || { rm -f "$env_tmp"; fail "Não foi possível preservar o .env atual"; }
  printf '\n# Criptografia de segredos de configuração (SMTP)\nCONFIG_ENCRYPTION_KEY=%s\n' \
    "$CONFIG_ENCRYPTION_KEY" >> "$env_tmp"
  mv "$env_tmp" .env
  chmod 600 .env

  log "CONFIG_ENCRYPTION_KEY ausente; uma nova chave foi gerada no .env."
  log "Preserve essa chave: trocá-la impede descriptografar senhas SMTP já salvas."
}

ensure_config_encryption_key

required_vars="DB_HOST DB_USER DB_PASSWORD DB_NAME JWT_SECRET ADMIN_BOOTSTRAP_TOKEN CONFIG_ENCRYPTION_KEY SUPER_ADMIN_EMAIL APP_ORIGIN"
for var_name in $required_vars; do
  eval var_value=\${$var_name:-}
  [ -n "$var_value" ] || fail "Variável obrigatória ausente no .env: $var_name"
done

[ "$DB_PASSWORD" != "fullpassword_pass" ] || fail "DB_PASSWORD padrão é proibida"
[ ${#JWT_SECRET} -ge 64 ] || fail "JWT_SECRET curto demais"
[ ${#ADMIN_BOOTSTRAP_TOKEN} -ge 48 ] || fail "ADMIN_BOOTSTRAP_TOKEN curto demais"
config_encryption_key_is_valid \
  || fail "CONFIG_ENCRYPTION_KEY inválida. Gere uma chave base64 de 32 bytes com: openssl rand -base64 32"

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

origin_url="$(git remote get-url origin 2>/dev/null)" \
  || fail "Remote origin não configurado"
case "$origin_url" in
  https://github.com/trinityrrocha/fullpassword|https://github.com/trinityrrocha/fullpassword.git|git@github.com:trinityrrocha/fullpassword.git)
    ;;
  *)
    fail "Remote origin não autorizado para o WebUpdater"
    ;;
esac

dirty_tracked="$(git status --porcelain --untracked-files=no)"
if [ -n "$dirty_tracked" ]; then
  printf '%s\n' "$dirty_tracked"
  fail "Existem alterações locais rastreadas. O atualizador foi bloqueado para evitar perda de alterações."
fi

log "Atualizando código-fonte a partir da branch main"
PRE_UPDATE_COMMIT="$(git rev-parse HEAD)"
UPDATER_STATE_DIR="${UPDATER_STATE_DIR:-/var/lib/fullpassword-updater}"
export UPDATER_STATE_DIR
owns_update_lock=0
legacy_daemon_request=""
# Compatibilidade com o daemon anterior, que mantém o lock mas não exporta o protocolo.
# Só adota o lock quando este processo foi iniciado diretamente pelo daemon conhecido.
if [ "${UPDATER_LOCK_HELD:-}" != 1 ] && [ -d "$UPDATER_STATE_DIR/update.lock" ] \
  && [ -r "/proc/${PPID:-0}/cmdline" ] \
  && [ "$(tr '\000' '\n' < "/proc/${PPID:-0}/cmdline" | tail -n 1)" = "$APP_DIR/scripts/updater-daemon.sh" ]; then
  for pending_request in "$UPDATER_STATE_DIR/processing"/*.json; do
    [ -f "$pending_request" ] || continue
    pending_name="$(basename "$pending_request" .json)"
    node "$APP_DIR/scripts/validate-updater-request.js" "$pending_request" "$pending_name" \
      || fail "Solicitação legada inválida"
    [ -z "$legacy_daemon_request" ] || fail "Mais de uma solicitação legada em processamento"
    legacy_daemon_request="$pending_name"
  done
  [ -n "$legacy_daemon_request" ] || fail "Não foi possível identificar a solicitação legada"
  export UPDATER_LOCK_HELD=1
fi
if [ "${UPDATER_LOCK_HELD:-}" != 1 ]; then
  mkdir -p "$UPDATER_STATE_DIR"
  chmod 700 "$UPDATER_STATE_DIR"
  mkdir "$UPDATER_STATE_DIR/update.lock" || fail "Outra operação do updater está em andamento"
  owns_update_lock=1
fi
export UPDATER_LOCK_HELD=1
finish_update() {
  update_exit=$?
  trap - EXIT
  if [ "$owns_update_lock" = 1 ] || [ -n "$legacy_daemon_request" ]; then node "$APP_DIR/scripts/check-update-status.js" check || true; fi
  if [ "$owns_update_lock" = 1 ]; then rmdir "$UPDATER_STATE_DIR/update.lock" 2>/dev/null || true; fi
  exit "$update_exit"
}
trap finish_update EXIT
# Migração: capturar ANTES de fetch/pull, sem sobrescrever marcador existente.
node "$APP_DIR/scripts/check-update-status.js" initialize-installed "$PRE_UPDATE_COMMIT"
node "$APP_DIR/scripts/check-update-status.js" updating
git fetch origin main
git checkout main
git pull --ff-only origin main

[ "$(git branch --show-current)" = "main" ] \
  || fail "O WebUpdater somente pode executar na branch main"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
  || fail "O commit local não corresponde ao commit publicado em origin/main"

APP_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export VITE_APP_COMMIT="$APP_COMMIT"
export APP_COMMIT="$APP_COMMIT"
export GIT_COMMIT="$APP_COMMIT"
log "Preparando build do frontend para o commit $APP_COMMIT"

write_runtime_nginx_conf

log "Validando Docker Compose"
compose config >/dev/null

log "Reconstruindo e reiniciando containers"
if [ -n "${UPDATE_SERVICES:-}" ]; then
  # O daemon não recria o próprio container durante uma solicitação em andamento.
  # A lista é definida internamente pelo updater, não por entrada HTTP.
  set -f
  for service in $UPDATE_SERVICES; do
    case "$service" in
      db|backend|frontend|nginx) ;;
      *) fail "Serviço não autorizado para atualização: $service" ;;
    esac
  done
  # shellcheck disable=SC2086
  compose up -d --build --remove-orphans $UPDATE_SERVICES
  set +f
else
  compose up -d --build --remove-orphans
fi
sleep 5
compose restart nginx
compose ps

log "Validando banco, backend e frontend antes de registrar a versão instalada"
ready=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  attempt=$((attempt + 1))
  if [ "$(docker inspect fullpassword_db --format '{{.State.Health.Status}}' 2>/dev/null || true)" = healthy ] \
    && compose exec -T backend node -e "Promise.all(['http://127.0.0.1:3000/api/health', 'http://frontend/'].map(url => fetch(url, {signal: AbortSignal.timeout(2000)}).then(r => {if (!r.ok) throw new Error('unhealthy')}))).then(() => process.exit(0)).catch(() => process.exit(1))" >/dev/null 2>&1 \
    && compose exec -T nginx nginx -t >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" = 1 ] || fail "Deploy não ficou saudável; a versão instalada anterior foi preservada"
if [ -n "$legacy_daemon_request" ]; then
  node "$APP_DIR/scripts/check-update-status.js" schedule-daemon-restart "$legacy_daemon_request"
fi
node "$APP_DIR/scripts/check-update-status.js" record-installed "$(git rev-parse HEAD)"
log "Atualização concluída com sucesso"
