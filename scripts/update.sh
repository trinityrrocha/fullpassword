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

cd "$APP_DIR" || fail "Diretório do projeto não encontrado: $APP_DIR"

[ -d .git ] || fail "Diretório Git não encontrado em $APP_DIR"
[ -f .env ] || fail "Arquivo .env não encontrado. Execute a instalação inicial antes de usar o atualizador."

chmod 600 .env 2>/dev/null || true

# Carrega variáveis locais geradas pelo instalador.
# O arquivo .env é controlado pela instalação e não deve conter comandos.
set -a
. ./.env
set +a

required_vars="DB_HOST DB_USER DB_PASSWORD DB_NAME JWT_SECRET ADMIN_BOOTSTRAP_TOKEN APP_ORIGIN"
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

log "Validando Docker Compose"
compose config >/tmp/fullpassword-compose-config.txt

log "Reconstruindo e reiniciando containers"
compose up -d --build
sleep 5
compose restart nginx
compose ps

log "Atualização concluída com sucesso"
