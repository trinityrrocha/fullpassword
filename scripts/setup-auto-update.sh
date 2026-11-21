#!/usr/bin/env bash
# One command to enable click-to-update on an existing FullPassword install (open source, no per-install signing).
#   sudo bash scripts/setup-auto-update.sh [--project-dir DIR] [--no-adopt]
#   sudo bash scripts/setup-auto-update.sh --disable      (turns the automatic updater off)
#   sudo bash scripts/setup-auto-update.sh --enable
# Idempotent. Refuses to run next to the legacy per-install release policy.
set -euo pipefail

ETC=/etc/fullpassword
AUTO=$ETC/auto-update
LIB=/usr/local/lib/fullpassword-release
STATE=/var/lib/fullpassword-release-agent
PUBLIC=/var/lib/fullpassword-release-public
QUEUE=/var/lib/fullpassword-release-queue
BACKUPS=/var/backups/fullpassword
NODE_GID=1000   # gid of the unprivileged "node" user inside the backend image
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

die() { echo "ERRO: $*" >&2; exit 1; }

validate_host_node() {
  NODE=$(command -v node || true)
  [[ -n $NODE && $NODE == /* && -x $NODE ]] || die 'Node.js ausente no host (requer 24.x >= 24.19.0).'
  local version; version=$("$NODE" --version)
  [[ $version =~ ^v24\.([0-9]+)\.([0-9]+)$ ]] && (( 10#${BASH_REMATCH[1]} >= 19 )) || die "Node $version não suportado (requer 24.x >= 24.19.0)."
  local entry; entry=$(readlink -f "$NODE"); NODE=$entry
  while :; do
    [[ $(stat -c %u "$entry") == 0 && $(( 0$(stat -c %a "$entry") & 022 )) == 0 ]] || die "Node em caminho não confiável: $entry (precisa ser do root e sem escrita por outros)."
    [[ $entry == / ]] && break
    entry=$(dirname "$entry")
  done
}

# Host Node is only used by the root agent. If the system one is unsuitable, install the pinned official build.
install_pinned_node() {
  local arch sum dir=/usr/local/lib/fullpassword-node tmp
  case $(uname -m) in
    x86_64) arch=x64; sum=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6 ;;
    aarch64|arm64) arch=arm64; sum=6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2 ;;
    *) die "Arquitetura sem Node pinado: $(uname -m). Instale Node 24.x em caminho do root." ;;
  esac
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' RETURN
  echo "Instalando Node 24.21.0 ($arch) em $dir..."
  curl -fsSL "https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-$arch.tar.xz" -o "$tmp/node.tar.xz" || die 'Falha ao baixar o Node.'
  [[ $(sha256sum "$tmp/node.tar.xz" | cut -d' ' -f1) == "$sum" ]] || die 'Checksum do Node não confere; abortado.'
  rm -rf "$dir"; install -d -o root -g root -m 0755 "$dir"
  tar -xJf "$tmp/node.tar.xz" -C "$dir" --strip-components=1 --no-same-owner
  chown -R root:root "$dir"; chmod -R go-w "$dir"
  export PATH="$dir/bin:$PATH"
}
# validate_host_node also checks that node and every parent are root-owned and not group/other-writable.
ensure_node() { (validate_host_node) >/dev/null 2>&1 || install_pinned_node; validate_host_node; }

compose_base() { docker compose --project-directory "$PROJECT" --env-file "$AUTO/app.env" -f "$AUTO/docker-compose.yml" "$@"; }

main() {
  [[ $EUID -eq 0 && $(uname -s) == Linux ]] || die 'Execute como root em Linux (sudo).'
  local PROJECT="$HERE" ADOPT=1 MODE=install
  while [[ $# -gt 0 ]]; do
    case $1 in
      --project-dir) PROJECT=$(realpath -- "${2:?}"); shift 2 ;;
      --no-adopt) ADOPT=0; shift ;;
      --disable) MODE=disable; shift ;;
      --enable) MODE=enable; shift ;;
      *) die "Opção desconhecida: $1" ;;
    esac
  done
  if [[ $MODE == disable ]]; then
    install -d -m 0755 "$ETC"; : > "$ETC/auto-update.disabled"; chmod 0644 "$ETC/auto-update.disabled"
    echo 'Atualização automática DESLIGADA (o botão do painel deixa de instalar).'; return
  fi
  if [[ $MODE == enable ]]; then rm -f "$ETC/auto-update.disabled"; echo 'Atualização automática LIGADA.'; return; fi

  [[ -f $PROJECT/docker-compose.yml && -f $PROJECT/.env ]] || die "docker-compose.yml/.env não encontrados em $PROJECT (use --project-dir)."
  command -v docker >/dev/null && docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 é necessário.'
  [[ ! -e $ETC/release-policy.json ]] || die 'Existe uma política do agente antigo (/etc/fullpassword/release-policy.json). Remova o agente antigo antes (docs/release-agent-bootstrap-vm.md) — os dois não coexistem.'
  if systemctl is-enabled fullpassword-release-agent.timer >/dev/null 2>&1; then die 'O timer do agente antigo está habilitado (fullpassword-release-agent.timer). Desabilite-o antes.'; fi
  ensure_node

  local ORIGIN; ORIGIN=$(sed -n 's/^APP_ORIGIN=//p' "$PROJECT/.env" | tail -n1 | tr -d "\"'")
  [[ $ORIGIN =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die 'APP_ORIGIN no .env precisa ser https://dominio (sem barra final).'

  # Authoritative root-owned copies: the agent never executes compose/env files a non-root user can edit.
  install -d -o root -g root -m 0755 "$ETC" "$LIB"
  install -d -o root -g root -m 0700 "$AUTO"
  install -o root -g root -m 0644 "$PROJECT/docker-compose.yml" "$AUTO/docker-compose.yml"
  install -o root -g root -m 0644 "$HERE/docker-compose.release-agent.yml" "$AUTO/docker-compose.release-agent.yml"
  install -o root -g root -m 0600 "$PROJECT/.env" "$AUTO/app.env"
  install -o root -g root -m 0644 "$HERE/backend/src/config/release-public.pem" "$ETC/release-public.pem"
  chmod 0755 "$AUTO"
  install -o root -g root -m 0644 "$HERE/scripts/auto-update-agent.js" "$LIB/auto-update-agent.js"
  install -o root -g root -m 0644 "$HERE/scripts/deploy-approved-release.js" "$LIB/deploy-approved-release.js"
  install -d -o root -g root -m 0700 "$STATE" "$BACKUPS"
  install -d -o root -g root -m 0755 "$PUBLIC"
  install -d -o root -g "$NODE_GID" -m 0770 "$QUEUE"

  # Database must be up to provision the DML-only runtime role.
  compose_base up -d db >/dev/null
  for _ in $(seq 1 60); do compose_base exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 && break; sleep 2; done
  local RUNTIME_PASSWORD
  if [[ -f $STATE/release.env ]] && grep -q '^RUNTIME_DB_PASSWORD=' "$STATE/release.env"; then
    RUNTIME_PASSWORD=$(sed -n 's/^RUNTIME_DB_PASSWORD=//p' "$STATE/release.env")
  else
    RUNTIME_PASSWORD=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  fi
  compose_base exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v pw="$1"' _ "$RUNTIME_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE fullpassword_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fullpassword_runtime') \gexec
ALTER ROLE fullpassword_runtime PASSWORD :'pw';
GRANT USAGE ON SCHEMA public TO fullpassword_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fullpassword_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO fullpassword_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fullpassword_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO fullpassword_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
  if [[ ! -f $STATE/release.env ]]; then
    ( umask 077; printf 'RUNTIME_DB_USER=fullpassword_runtime\nRUNTIME_DB_PASSWORD=%s\n' "$RUNTIME_PASSWORD" > "$STATE/release.env" )
  fi
  "$NODE" -e '
    const fs=require("fs");const [project,origin]=process.argv.slice(1);
    fs.writeFileSync("/etc/fullpassword/auto-update.json",JSON.stringify({projectDir:project,envFile:"/etc/fullpassword/auto-update/app.env",
      baseFiles:["/etc/fullpassword/auto-update/docker-compose.yml"],overlayFile:"/etc/fullpassword/auto-update/docker-compose.release-agent.yml",
      origin,publicKeyFile:"/etc/fullpassword/release-public.pem",stateDirectory:"'$STATE'",publicDirectory:"'$PUBLIC'",
      queueDirectory:"'$QUEUE'",backupDirectory:"'$BACKUPS'",backupKeep:3},null,1)+"\n",{mode:0o644});' "$PROJECT" "$ORIGIN"

  umask 022
  printf '[Unit]\nDescription=FullPassword automatic updater (signed releases)\n[Service]\nType=oneshot\nExecStart=%s %s/auto-update-agent.js\nUser=root\nUMask=0077\nTimeoutStartSec=30min\n' "$NODE" "$LIB" > /etc/systemd/system/fullpassword-auto-update.service
  printf '[Unit]\nDescription=Poll FullPassword update requests\n[Timer]\nOnBootSec=30s\nOnUnitInactiveSec=10s\nUnit=fullpassword-auto-update.service\n[Install]\nWantedBy=timers.target\n' > /etc/systemd/system/fullpassword-auto-update.timer
  local SYSTEMD=0; [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null && SYSTEMD=1
  (( SYSTEMD )) && systemctl daemon-reload
  echo 'Agente instalado. Adotando a release estável atual (backup, migração, verificação e rollback automáticos)...'
  if (( ADOPT )); then
    : > "$STATE/adopt.consent"   # also covers installs ahead of the stable channel: adopt on the first eligible release
    "$NODE" "$LIB/auto-update-agent.js" --adopt || die 'A adoção falhou e foi revertida; veja o painel/estado e rode de novo.'
  fi
  if (( SYSTEMD )); then systemctl enable --now fullpassword-auto-update.timer
  else echo 'AVISO: systemd ausente; agende "node '"$LIB"'/auto-update-agent.js" a cada 10 s manualmente.'; fi
  echo 'Pronto. A atualização pelo painel (Super Admin) está ligada. Para desligar: sudo bash scripts/setup-auto-update.sh --disable'
}
main "$@"
