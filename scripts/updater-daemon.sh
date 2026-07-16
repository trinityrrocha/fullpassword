#!/bin/sh

set -u

REQUEST_ROOT="${UPDATER_REQUEST_DIR:-/var/lib/fullpassword-updater}"
REQUEST_DIR="$REQUEST_ROOT/requests"
PROCESSING_DIR="$REQUEST_ROOT/processing"
PROCESSED_DIR="$REQUEST_ROOT/processed"
FAILED_DIR="$REQUEST_ROOT/failed"
LOCK_DIR="$REQUEST_ROOT/update.lock"
APP_DIR="${APP_DIR:-/opt/fullpassword}"

log() {
  printf '%s [FullPassword Updater Daemon] %s\n' "$(date -Is)" "$*"
}

mkdir -p "$REQUEST_DIR" "$PROCESSING_DIR" "$PROCESSED_DIR" "$FAILED_DIR"
rmdir "$LOCK_DIR" 2>/dev/null || true

# Recupera solicitações interrompidas por reinício do container.
for interrupted in "$PROCESSING_DIR"/*.json; do
  [ -f "$interrupted" ] || continue
  mv "$interrupted" "$REQUEST_DIR/$(basename "$interrupted")"
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

  log "Processando solicitação $name."
  if APP_DIR="$APP_DIR" UPDATE_SERVICES="db backend frontend nginx" sh "$APP_DIR/scripts/update.sh" >"$log_file" 2>&1; then
    mv "$processing" "$PROCESSED_DIR/$name"
    mv "$log_file" "$PROCESSED_DIR/${name%.json}.log"
    log "Solicitação $name concluída com sucesso."
  else
    status=$?
    mv "$processing" "$FAILED_DIR/$name"
    mv "$log_file" "$FAILED_DIR/${name%.json}.log"
    log "Solicitação $name falhou com status $status."
  fi

  rmdir "$LOCK_DIR" 2>/dev/null || true
done
