#!/bin/bash
# Testes isolados: sem root, Docker, rede ou alterações no sistema operacional.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO_DIR=$PWD
TEST_DIR=$(mktemp -d /tmp/fullpassword-test-XXXXXX)
trap 'rm -rf -- "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/root/.cloudflared" "$TEST_DIR/etc" "$TEST_DIR/app/docker"
mkdir -p "$TEST_DIR/etc/apt/sources.list.d" "$TEST_DIR/usr/share/keyrings"

# Apenas definições; caminhos de infraestrutura são redirecionados ao sandbox.
source <(sed "s|/root|$TEST_DIR/root|g;s|/etc/cloudflared|$TEST_DIR/etc/cloudflared|g;s|/etc/apt|$TEST_DIR/etc/apt|g;s|/usr/share/keyrings|$TEST_DIR/usr/share/keyrings|g" scripts/install.sh)
APP_DIR="$TEST_DIR/app"
DOMAIN=cofre.example.com
SUPER_ADMIN_EMAIL=admin@example.com
SSH_PORT=2222
DB_PASSWORD=TEST_ONLY
JWT_SECRET=TEST_ONLY
ADMIN_BOOTSTRAP_TOKEN=TEST_ONLY
CONFIG_ENCRYPTION_KEY=TEST_ONLY
LOG="$TEST_DIR/commands"

assert_has() { grep -Fq -- "$1" "$2" || { echo "Ausente: $1" >&2; exit 1; }; }
assert_lacks() { if grep -Eq -- "$1" "$2"; then echo "Conteúdo proibido: $1" >&2; exit 1; fi; }
ufw() { printf '%s\n' "$*" >> "$LOG"; }
apt-get() {
    printf '%s\n' "$*" >> "$LOG"
    if [ "${APT_FAIL:-no}" = yes ] && [ "$1" = "${APT_FAIL_COMMAND:-install}" ]; then
        echo 'E: Unable to locate package TEST_MISSING_PACKAGE' >&2
        return 100
    fi
}
systemctl() { printf '%s\n' "$*" >> "$LOG"; [ "$*" != 'is-active --quiet cloudflared' ] || [ "$SERVICE_OK" = yes ]; }
journalctl() { printf 'journal diagnostics\n' >> "$LOG"; }

# OS: todas as versões suportadas e rejeição antes de instalar em outro SO.
for os in ubuntu:20.04 ubuntu:22.04 ubuntu:24.04 debian:11 debian:12 debian:13; do
    printf 'ID=%s\nVERSION_ID=%s\nPRETTY_NAME="Test OS %s"\n' "${os%:*}" "${os#*:}" "$os" > "$TEST_DIR/os-release"
    detect_os "$TEST_DIR/os-release" >/dev/null
done
printf 'ID=fedora\nVERSION_ID=42\n' > "$TEST_DIR/os-release"
if (detect_os "$TEST_DIR/os-release") >/dev/null 2>&1; then echo 'SO não suportado aceito'; exit 1; fi
printf 'ID=debian\nVERSION_ID=13\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n' > "$TEST_DIR/os-release"
detect_os "$TEST_DIR/os-release" > "$TEST_DIR/os-output"
assert_has 'Debian GNU/Linux 13 (trixie) — suportado.' "$TEST_DIR/os-output"

unset FULLPASSWORD_APP_DIR
resolve_app_dir
[ "$APP_DIR" = /opt/fullpassword ]
FULLPASSWORD_APP_DIR=''
resolve_app_dir
[ "$APP_DIR" = /opt/fullpassword ]
FULLPASSWORD_APP_DIR="$TEST_DIR/newinstall"
resolve_app_dir
[ "$APP_DIR" = "$TEST_DIR/newinstall" ]
for FULLPASSWORD_APP_DIR in / /opt /home /root relative '/opt/with space' /opt/../root /opt/./app /opt//app; do
    if (resolve_app_dir) >/dev/null 2>&1; then echo 'Diretório inseguro aceito'; exit 1; fi
done

# Simula a coleta com apenas domínio, e-mail e SSH: não há quarto read do diretório.
read() { printf '%s\n' "$*" >> "$LOG"; builtin read "$@"; }
INSTALL_MODE=public_ip
FULLPASSWORD_APP_DIR="$TEST_DIR/newinstall"
: > "$LOG"
collect_install_settings <<< $'cofre.example.com\nadmin@example.com\n2222'
[ "$(wc -l < "$LOG" | tr -d ' ')" = 3 ]
assert_lacks 'Diretório de instalação' "$LOG"
mkdir -p "$FULLPASSWORD_APP_DIR/.git"
if (collect_install_settings <<< $'cofre.example.com\nadmin@example.com\n2222\nn') >/dev/null 2>&1; then
    echo 'Reinstalação aceita sem confirmação'; exit 1
fi
collect_install_settings <<< $'cofre.example.com\nadmin@example.com\n2222\nREINSTALAR' >/dev/null
unset -f read
unset FULLPASSWORD_APP_DIR
APP_DIR="$TEST_DIR/app"
echo 'OK: Debian 13/Ubuntu, diretório automático/avançado e proteção de reinstalação'

# Erro APT preserva diagnóstico original e contextual, sem dicas do túnel.
APT_FAIL=yes
if (install_base_dependencies) > "$TEST_DIR/apt-error" 2>&1; then echo 'Falha de APT ignorada'; exit 1; fi
assert_has 'Debian GNU/Linux 13 (trixie)' "$TEST_DIR/apt-error"
assert_has 'TEST_MISSING_PACKAGE' "$TEST_DIR/apt-error"
assert_has 'Falha no APT: apt-get install -y' "$TEST_DIR/apt-error"
assert_has 'Instalação incompleta' "$TEST_DIR/apt-error"
assert_has 'Não misture repositórios Debian' "$TEST_DIR/apt-error"
assert_lacks 'systemctl status cloudflared|journalctl -u cloudflared' "$TEST_DIR/apt-error"
APT_FAIL=no

# Instalação do pacote cloudflared simulada, sem rede ou alteração de /etc real.
curl() {
    printf '%s\n' "$*" >> "$LOG"
    [ "$1" = -fsSL ] && [ "$3" = -o ] || return 1
    printf 'TEST_GPG_KEY\n' > "$4"
}
: > "$LOG"
install_cloudflared
assert_has 'install -y cloudflared' "$LOG"
assert_has 'https://pkg.cloudflare.com/cloudflared any main' "$TEST_DIR/etc/apt/sources.list.d/cloudflared.list"
assert_lacks 'add-apt-repository|software-properties-common|certbot' "$LOG"
APT_FAIL=yes
if (install_cloudflared) > "$TEST_DIR/apt-error" 2>&1; then echo 'Falha de APT cloudflared ignorada'; exit 1; fi
assert_lacks 'systemctl status cloudflared|journalctl -u cloudflared' "$TEST_DIR/apt-error"
APT_FAIL=no
unset -f curl
INSTALL_STAGE=preflight
echo 'OK: diagnóstico de APT e cloudflared via repositório oficial any main'

for option in 1 2; do
    select_install_mode <<< "$option" >/dev/null
    : > "$LOG"
    configure_firewall >/dev/null
    install_base_dependencies
    assert_lacks 'software-properties-common|add-apt-repository' "$LOG"
    assert_has 'allow 2222/tcp' "$LOG"
    if [ "$option" = 1 ]; then
        [ "$INSTALL_MODE" = public_ip ]
        [ "$NGINX_HTTP_BIND" = 80 ]
        assert_has 'allow 80/tcp' "$LOG"
        assert_has 'allow 443/tcp' "$LOG"
        assert_has 'certbot python3-certbot-nginx' "$LOG"
    else
        [ "$INSTALL_MODE" = cloudflare_tunnel ]
        [ "$NGINX_HTTP_BIND" = 127.0.0.1:80 ]
        [ "$NGINX_HTTPS_BIND" = 127.0.0.1:443 ]
        assert_lacks 'allow (80|443)/tcp|certbot' "$LOG"
    fi
    generate_env
    assert_has "INSTALL_MODE=$INSTALL_MODE" "$APP_DIR/.env"
    assert_has 'APP_ORIGIN=https://cofre.example.com' "$APP_DIR/.env"
    assert_has 'VITE_API_URL=https://cofre.example.com/api' "$APP_DIR/.env"
    assert_has 'GOOGLE_DRIVE_REDIRECT_URI=https://cofre.example.com/api/integrations/google-drive/oauth/callback' "$APP_DIR/.env"
    generate_nginx_config
    conf="$APP_DIR/docker/nginx.runtime.conf"
    cp "$conf" "$TEST_DIR/$INSTALL_MODE.conf"
    assert_has 'client_max_body_size 201m;' "$conf"
    assert_has 'proxy_read_timeout 1800s;' "$conf"
    assert_has 'Content-Security-Policy' "$conf"
    assert_has 'proxy_pass http://frontend:80;' "$conf"
    if [ "$option" = 1 ]; then
        assert_has 'listen 443 ssl;' "$conf"
        assert_has 'return 301 https://' "$conf"
        assert_has 'proxy_set_header X-Forwarded-Proto $scheme;' "$conf"
    else
        assert_has 'listen 80;' "$conf"
        assert_has 'proxy_set_header X-Forwarded-Proto https;' "$conf"
        assert_lacks 'listen 443|ssl_certificate|letsencrypt|return 301' "$conf"
    fi
done
if (select_install_mode <<< 3) >/dev/null 2>&1; then echo 'Menu aceitou opção inválida'; exit 1; fi
echo 'OK: menu, firewall, dependências, HTTPS no env e Nginx nos dois modos'

# Simula CLI, inclusive credenciais ausentes, UUID inválido e falhas em cada fase.
UUID=11111111-2222-3333-4444-555555555555
FAIL_AT=none
cloudflared() {
    printf '%s\n' "$*" >> "$LOG"
    case "$*" in
        'tunnel login')
            [ "$FAIL_AT" != login ] || return 1
            [ "$FAIL_AT" = cert ] || printf 'TEST_CERT\n' > "$TEST_DIR/root/.cloudflared/cert.pem"
            ;;
        'tunnel create '*)
            [ "$FAIL_AT" != create ] || return 1
            [ "$FAIL_AT" = credentials ] || printf '{"TunnelID":"%s"}\n' "$UUID" > "$4"
            ;;
        'tunnel route dns '*) [ "$FAIL_AT" != dns ] || return 1 ;;
        *'ingress validate') [ "$FAIL_AT" != ingress ] || return 1 ;;
        *'service install') [ "$FAIL_AT" != service ] || return 1 ;;
    esac
    return 0
}
jq() { [ "$FAIL_AT" != json ] || return 1; printf '%s\n' "$UUID"; }
for FAIL_AT in login cert create credentials json dns ingress; do
    rm -f "$TEST_DIR/root/.cloudflared/cert.pem"
    if (configure_cloudflare_tunnel <<< s) >/dev/null 2>&1; then
        echo "Falha não detectada: $FAIL_AT"; exit 1
    fi
done
FAIL_AT=none
UUID=invalid
if (configure_cloudflare_tunnel <<< s) >/dev/null 2>&1; then echo 'UUID inválido aceito'; exit 1; fi
UUID=11111111-2222-3333-4444-555555555555
if (configure_cloudflare_tunnel <<< n) >/dev/null 2>&1; then echo 'DNS sem confirmação'; exit 1; fi
configure_cloudflare_tunnel <<< s >/dev/null
assert_has 'service: http://localhost:80' "$TEST_DIR/etc/cloudflared/config.yml"
assert_has 'service: http_status:404' "$TEST_DIR/etc/cloudflared/config.yml"
assert_has "CLOUDFLARE_TUNNEL_UUID=$UUID" "$APP_DIR/.env"
assert_lacks 'TEST_CERT|TunnelID|TunnelSecret|cert.pem|credentials-file' "$APP_DIR/.env"
SERVICE_OK=no
if (start_cloudflared_service) >/dev/null 2>&1; then echo 'Serviço inativo aceito'; exit 1; fi
SERVICE_OK=yes
start_cloudflared_service >/dev/null
echo 'OK: túnel, DNS, ingress, serviço e caminhos de falha (CLI simulada)'

# Valida o gerador usado pelo WebUpdater, sem executar seu fluxo de atualização.
(
    source <(sed '/^cd "\$APP_DIR" || fail/,$d' scripts/update.sh)
    APP_ORIGIN=https://cofre.example.com
    NGINX_CONF_PATH="$TEST_DIR/updater.conf"
    for INSTALL_MODE in public_ip cloudflare_tunnel; do
        write_runtime_nginx_conf >/dev/null
        # Ignora somente comentários/espaços e as três diretivas WebSocket que
        # já eram exclusivas do instalador antes desta mudança.
        filters='/^[[:space:]]*#/d;/^[[:space:]]*$/d;/proxy_set_header Upgrade /d;/proxy_set_header Connection /d;/proxy_cache_bypass /d'
        diff -u <(sed "$filters" "$TEST_DIR/$INSTALL_MODE.conf") \
            <(sed "$filters" "$NGINX_CONF_PATH")
    done
    unset INSTALL_MODE
    write_runtime_nginx_conf >/dev/null
    assert_has 'listen 443 ssl;' "$NGINX_CONF_PATH"
    INSTALL_MODE=invalid
    if (write_runtime_nginx_conf) >/dev/null 2>&1; then echo 'Modo inválido aceito pelo updater'; exit 1; fi
)
echo 'OK: WebUpdater preserva tunnel e padrão público legado'

# Docker/healthcheck não são executados: somente simulações.
compose() {
    printf '%s\n' "$*" >> "$LOG"
    case "$*" in
        config) [ "$FAIL_AT" != compose ] || return 1 ;;
        'exec -T backend '*) [ "$FAIL_AT" != health ] || return 1 ;;
    esac
}
sleep() { :; }
FAIL_AT=compose
if (start_containers) >/dev/null 2>&1; then echo 'Compose inválido aceito'; exit 1; fi
FAIL_AT=health
if (start_containers) >/dev/null 2>&1; then echo 'Backend indisponível aceito'; exit 1; fi
FAIL_AT=none
start_containers >/dev/null
echo 'OK: Compose/healthcheck e falhas sem instalação real'
