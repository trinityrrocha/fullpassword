#!/bin/sh
# Mutable branch updates are intentionally removed.
set -eu
APP_DIR="${APP_DIR:-/opt/fullpassword}"
if [ "$#" -ne 2 ]; then
  printf '%s\n' 'Atualização exige manifesto assinado e assinatura. Use o fluxo de release aprovado pelo operador.' >&2
  exit 1
fi
exec node "$APP_DIR/scripts/deploy-approved-release.js" "$1" "$2"
