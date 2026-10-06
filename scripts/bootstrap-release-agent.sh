#!/usr/bin/env bash
set -euo pipefail
# No guessed application directory; caller supplies the reviewed checkout and queue GID.
if [[ $# -ne 2 || $EUID -ne 0 ]]; then
  echo 'Uso: sudo bash bootstrap-release-agent.sh CHECKOUT_REVISADO GID_BACKEND' >&2
  exit 1
fi
SOURCE=$(realpath -- "$1")
GID=$2
[[ $GID =~ ^[0-9]+$ ]] || { echo 'GID inválido' >&2; exit 1; }
NODE=$(command -v node)
[[ -n $NODE && $NODE == /* ]] || { echo 'Node do host indisponível' >&2; exit 1; }
[[ -f /etc/fullpassword/release-policy.json ]] || { echo 'Política protegida ainda não provisionada' >&2; exit 1; }
install -d -o root -g root -m 0755 /usr/local/lib/fullpassword-release
install -o root -g root -m 0644 "$SOURCE/scripts/release-agent.js" /usr/local/lib/fullpassword-release/release-agent.js
install -o root -g root -m 0644 "$SOURCE/scripts/deploy-approved-release.js" /usr/local/lib/fullpassword-release/deploy-approved-release.js
install -d -o root -g root -m 0700 /var/lib/fullpassword-release-agent
install -d -o root -g root -m 0755 /var/lib/fullpassword-release-public
install -d -o root -g "$GID" -m 0770 /var/lib/fullpassword-release-queue
for directory in /var/lib/fullpassword-release-agent /var/lib/fullpassword-release-public; do
  if [[ ! -e "$directory/.operator-owned" ]]; then
    install -o root -g root -m 0644 /dev/null "$directory/.operator-owned"
  fi
done
# Deliberately stop an existing NEW agent while replacing its code. Do not guess legacy service names.
systemctl stop fullpassword-release-agent.timer 2>/dev/null || true
systemctl stop fullpassword-release-agent.service 2>/dev/null || true
umask 077
printf '[Unit]\nDescription=FullPassword signed release agent\n[Service]\nType=oneshot\nExecStart=%s /usr/local/lib/fullpassword-release/release-agent.js\nUser=root\nUMask=0077\nTimeoutStartSec=30min\n' "$NODE" > /etc/systemd/system/fullpassword-release-agent.service
printf '[Unit]\nDescription=Poll approved FullPassword release requests\n[Timer]\nOnBootSec=30s\nOnUnitInactiveSec=10s\nUnit=fullpassword-release-agent.service\n[Install]\nWantedBy=timers.target\n' > /etc/systemd/system/fullpassword-release-agent.timer
systemctl daemon-reload
echo 'Agente instalado, timer parado. Verifique política, restauração e exclusividade antes de habilitar.'
echo 'Habilitação: systemctl enable --now fullpassword-release-agent.timer'
