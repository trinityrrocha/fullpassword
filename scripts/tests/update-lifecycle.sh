#!/bin/bash
# Teste de deploy simulado: Git local real, Docker/serviços simulados, sem rede.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO_DIR=$PWD
TEST_DIR=$(mktemp -d /tmp/fullpassword-update-lifecycle-XXXXXX)
trap 'rm -rf -- "$TEST_DIR"' EXIT
GIT_BIN=$(command -v git)
export GIT_CONFIG_GLOBAL="$TEST_DIR/gitconfig"
export GIT_CONFIG_NOSYSTEM=1
"$GIT_BIN" init -q --bare "$TEST_DIR/origin.git"
mkdir -p "$TEST_DIR/app/scripts" "$TEST_DIR/app/backend/src/services" "$TEST_DIR/app/docker" "$TEST_DIR/state"
cp scripts/check-update-status.js "$TEST_DIR/app/scripts/"
cp backend/src/services/updateStatusStore.js "$TEST_DIR/app/backend/src/services/"
"$GIT_BIN" -C "$TEST_DIR/app" init -q -b main
"$GIT_BIN" -C "$TEST_DIR/app" -c user.name=Test -c user.email=test@example.invalid commit -q --allow-empty -m initial
OLD=$("$GIT_BIN" -C "$TEST_DIR/app" rev-parse HEAD)
"$GIT_BIN" -C "$TEST_DIR/app" -c user.name=Test -c user.email=test@example.invalid commit -q --allow-empty -m newer
NEW=$("$GIT_BIN" -C "$TEST_DIR/app" rev-parse HEAD)
"$GIT_BIN" -C "$TEST_DIR/app" push -q "$TEST_DIR/origin.git" main
"$GIT_BIN" -C "$TEST_DIR/app" checkout -q -b installed "$OLD"
"$GIT_BIN" -C "$TEST_DIR/app" branch -f main "$OLD"
"$GIT_BIN" -C "$TEST_DIR/app" checkout -q main
"$GIT_BIN" -C "$TEST_DIR/app" remote add origin https://github.com/trinityrrocha/fullpassword.git
export APP_DIR="$TEST_DIR/app"
# Node on Windows consumes native environment paths; shell arguments are converted by Git Bash.
if command -v cygpath >/dev/null 2>&1; then
  export UPDATER_STATE_DIR="$(cygpath -m "$TEST_DIR/state")"
else
  export UPDATER_STATE_DIR="$TEST_DIR/state"
fi
export UPDATE_SERVICES='db backend frontend nginx'
cat > "$APP_DIR/.env" <<'ENV'
DB_HOST=db
DB_USER=test
DB_PASSWORD=TEST_ONLY_PASSWORD
DB_NAME=test
JWT_SECRET=TEST_ONLY_JWT_SECRET_12345678901234567890123456789012345678901234567890
ADMIN_BOOTSTRAP_TOKEN=TEST_ONLY_BOOTSTRAP_1234567890123456789012345678901234567890
CONFIG_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
SUPER_ADMIN_EMAIL=admin@example.invalid
APP_ORIGIN=https://cofre.example.invalid
INSTALL_MODE=cloudflare_tunnel
NGINX_CONF_PATH=./docker/nginx.runtime.conf
ENV

git() {
  case "${1:-}" in
    config) return 0 ;;
    fetch|pull)
      # Marker must already exist and contain the PRE_UPDATE_COMMIT before networking.
      [ "$(tr -d '\r\n' < "$TEST_DIR/state/installed-commit")" = "$OLD" ] || return 90
      "$GIT_BIN" -c "url.$TEST_DIR/origin.git.insteadOf=https://github.com/trinityrrocha/fullpassword.git" "$@" ;;
    *) "$GIT_BIN" "$@" ;;
  esac
}
docker() {
  if [ "$1" = inspect ]; then
    if [ "$2" = fullpassword_backend ] && [ "${FAIL_BACKEND_HEALTH:-no}" = yes ]; then echo unhealthy; else echo healthy; fi
    return
  fi
  if [ "$1" = compose ] && [ "${2:-}" = up ] && [ "${FAIL_DEPLOY:-no}" = yes ]; then return 7; fi
  if [ "$1" = compose ] && [ "${2:-}" = exec ] && [ "${FAIL_HEALTH:-no}" = yes ]; then return 1; fi
  if [ "$1" = compose ] && [ "${2:-}" = exec ] && [ "${4:-}" = backend ]; then
    [ "${6:-}" = scripts/check-health.js ] && [ "${7:-}" = "$NEW" ] && [ "${8:-}" = --frontend ] || return 92
    [ "${FAIL_SCHEMA:-no}" != yes ] && [ "${FAIL_REVISION:-no}" != yes ] || return 1
  fi
  return 0
}
sleep() { :; }
export GIT_BIN TEST_DIR REPO_DIR OLD NEW
export -f git docker sleep

# Failure after real fetch/pull: previous marker survives, HEAD does advance.
if FAIL_DEPLOY=yes bash -c 'source "$REPO_DIR/scripts/update.sh"' > "$TEST_DIR/failure.log" 2>&1; then
  echo 'Deploy com falha foi aceito'; exit 1
fi
[ "$(tr -d '\r\n' < "$TEST_DIR/state/installed-commit")" = "$OLD" ]
[ "$("$GIT_BIN" -C "$APP_DIR" rev-parse HEAD)" = "$NEW" ]
[ ! -d "$TEST_DIR/state/update.lock" ]

# Failed healthcheck must also preserve the marker.
if FAIL_HEALTH=yes bash -c 'source "$REPO_DIR/scripts/update.sh"' > "$TEST_DIR/health.log" 2>&1; then
  echo 'Deploy sem healthcheck foi aceito'; exit 1
fi
[ "$(tr -d '\r\n' < "$TEST_DIR/state/installed-commit")" = "$OLD" ]

# Only a completed deployment advances the marker.
for failed_gate in FAIL_BACKEND_HEALTH FAIL_SCHEMA FAIL_REVISION; do
  if (export "$failed_gate=yes"; bash -c 'source "$REPO_DIR/scripts/update.sh"') > "$TEST_DIR/$failed_gate.log" 2>&1; then
    echo "Deploy com falha de $failed_gate foi aceito"; exit 1
  fi
  [ "$(tr -d '\r\n' < "$TEST_DIR/state/installed-commit")" = "$OLD" ]
done
bash -c 'source "$REPO_DIR/scripts/update.sh"' > "$TEST_DIR/success.log" 2>&1
[ "$(tr -d '\r\n' < "$TEST_DIR/state/installed-commit")" = "$NEW" ]
[ ! -d "$TEST_DIR/state/update.lock" ]
echo 'OK: migração antes de fetch/pull, falha de build/health preserva marcador, sucesso avança SHA e libera lock'
