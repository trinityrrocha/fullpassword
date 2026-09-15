#!/bin/sh

set -u
umask 077

REQUEST_ROOT="${UPDATER_REQUEST_DIR:-/var/lib/fullpassword-updater}"
REQUEST_DIR="$REQUEST_ROOT/requests"
CHECK_DIR="$REQUEST_ROOT/check-requests"
CHECK_PROCESSING_DIR="$REQUEST_ROOT/check-processing"
PROCESSING_DIR="$REQUEST_ROOT/processing"
PROCESSED_DIR="$REQUEST_ROOT/processed"
FAILED_DIR="$REQUEST_ROOT/failed"
LOCK_DIR="$REQUEST_ROOT/update.lock"
APP_DIR="${APP_DIR:-/opt/fullpassword}"
export UPDATER_STATE_DIR="$REQUEST_ROOT"
CHECK_INTERVAL="${UPDATER_CHECK_INTERVAL_SECONDS:-86400}"
case "$CHECK_INTERVAL" in ''|*[!0-9]*) CHECK_INTERVAL=86400 ;; esac
[ "$CHECK_INTERVAL" -ge 60 ] || CHECK_INTERVAL=86400
last_check=0
daemon_version="$(cksum "$APP_DIR/scripts/updater-daemon.sh")"

check_updates() {
  UPDATER_LOCK_HELD=1 node "$APP_DIR/scripts/check-update-status.js" check "$@"
  last_check="$(date +%s)"
}

log() {
  printf '%s [FullPassword Updater Daemon] %s\n' "$(date -Is)" "$*"
}

validate_request() {
  node "$APP_DIR/scripts/validate-updater-request.js" "$1" "$2"
}

mkdir -p "$REQUEST_DIR" "$CHECK_DIR" "$CHECK_PROCESSING_DIR" "$PROCESSING_DIR" "$PROCESSED_DIR" "$FAILED_DIR"
chmod 700 "$REQUEST_ROOT" "$REQUEST_DIR" "$CHECK_DIR" "$CHECK_PROCESSING_DIR" "$PROCESSING_DIR" "$PROCESSED_DIR" "$FAILED_DIR"
rmdir "$LOCK_DIR" 2>/dev/null || true

# Recupera solicitações interrompidas por reinício do container.
for interrupted in "$PROCESSING_DIR"/*.json; do
  [ -f "$interrupted" ] || continue
  mv "$interrupted" "$REQUEST_DIR/$(basename "$interrupted")"
done
for interrupted in "$CHECK_PROCESSING_DIR"/*.json; do
  [ -f "$interrupted" ] || continue
  mv "$interrupted" "$CHECK_DIR/$(basename "$interrupted")"
done

log "Daemon iniciado; aguardando solicitações."

while true; do
  request=""
  for candidate in "$REQUEST_DIR"/*.json; do
    [ -f "$candidate" ] || continue
    request="$candidate"
    break
  done

  if [ -z "$request" ]; then
    check_request=""
    for candidate in "$CHECK_DIR"/*.json; do
      [ -f "$candidate" ] || continue
      check_request="$candidate"
      break
    done
    now="$(date +%s)"
    if [ -n "$check_request" ] || { [ -f "$REQUEST_ROOT/installed-commit" ] && [ "$((now - last_check))" -ge "$CHECK_INTERVAL" ]; }; then
      if mkdir "$LOCK_DIR" 2>/dev/null; then
        if [ -n "$check_request" ]; then
          name="$(basename "$check_request")"
          processing="$CHECK_PROCESSING_DIR/$name"
          mv "$check_request" "$processing"
          if node "$APP_DIR/scripts/check-update-status.js" validate-request "$processing" "${name%.json}"; then
            check_updates "${name%.json}"
            mv "$processing" "$PROCESSED_DIR/check-$name"
          else
            mv "$processing" "$FAILED_DIR/check-$name"
            log "Solicitação de verificação inválida recusada."
          fi
        else
          check_updates
        fi
        rmdir "$LOCK_DIR" 2>/dev/null || true
      fi
    fi
    sleep 2
    continue
  fi

  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    sleep 2
    continue
  fi

  name="$(basename "$request")"
  processing="$PROCESSING_DIR/$name"
  log_file="$PROCESSING_DIR/${name%.json}.log"
  mv "$request" "$processing"

  request_id="${name%.json}"
  if ! validate_request "$processing" "$request_id"; then
    mv "$processing" "$FAILED_DIR/$name"
    log "Solicitação inválida recusada."
    rmdir "$LOCK_DIR" 2>/dev/null || true
    continue
  fi

  log "Processando solicitação $request_id."
  if UPDATER_LOCK_HELD=1 APP_DIR="$APP_DIR" UPDATE_SERVICES="db backend frontend nginx" sh "$APP_DIR/scripts/update.sh" >"$log_file" 2>&1; then
    mv "$processing" "$PROCESSED_DIR/$name"
    mv "$log_file" "$PROCESSED_DIR/${name%.json}.log"
    log "Solicitação $request_id concluída com sucesso."
  else
    status=$?
    mv "$processing" "$FAILED_DIR/$name"
    mv "$log_file" "$FAILED_DIR/${name%.json}.log"
    log "Solicitação $request_id falhou com status $status."
  fi

  # Recalcula inclusive após falha: HEAD pode ter avançado sem deploy concluído.
  check_updates

  rmdir "$LOCK_DIR" 2>/dev/null || true
  # Carrega o daemon publicado somente depois de concluir e arquivar a solicitação.
  if [ "$daemon_version" != "$(cksum "$APP_DIR/scripts/updater-daemon.sh")" ]; then
    exec sh "$APP_DIR/scripts/updater-daemon.sh"
  fi
done
