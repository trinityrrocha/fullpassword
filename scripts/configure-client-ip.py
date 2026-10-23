#!/usr/bin/env python3
"""Generate one self-contained Nginx trust policy; never starts/reloads services.

Root-owned output is atomically replaced only after all input is validated.
No user-supplied Nginx syntax, DNS names, or wildcard trusted networks allowed.
"""
import argparse
import ipaddress
import os
from pathlib import Path
import re
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
MODES = ('direct', 'cloudflare_proxy', 'cloudflare_tunnel')

def parse_ranges(text):
    values = [line.strip() for line in text.splitlines() if line.strip() and not line.startswith('#')]
    if not values or len(values) > 256:
        raise ValueError('Lista de ranges vazia ou excessiva.')
    result = []
    for value in values:
        if '/' not in value:
            raise ValueError('Somente CIDRs explícitos são aceitos.')
        network = ipaddress.ip_network(value, strict=True)
        if network.prefixlen == 0 or network.is_loopback or network.is_multicast or network.is_unspecified:
            raise ValueError('Range de confiança inseguro.')
        result.append(str(network))
    return list(dict.fromkeys(result))

def atomic_write(destination, text):
    destination = Path(destination)
    if destination.is_symlink():
        raise ValueError('Destino não pode ser symlink.')
    fd, name = tempfile.mkstemp(prefix='.client-ip-', dir=destination.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, 0o644)
        os.replace(name, destination)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def refresh_ranges(destination):
    lists = []
    for version in (4, 6):
        with urllib.request.urlopen(f'https://www.cloudflare.com/ips-v{version}', timeout=20) as response:
            if response.status != 200:
                raise ValueError('Falha ao obter ranges oficiais.')
            text = response.read(16385)
            if len(text) > 16384:
                raise ValueError('Resposta excessiva de ranges.')
            values = parse_ranges(text.decode('ascii'))
            if any(ipaddress.ip_network(v).version != version for v in values):
                raise ValueError('Família de IP inesperada.')
            lists.extend(values)
    atomic_write(destination, '# Sources: https://www.cloudflare.com/ips-v4 and /ips-v6\n' + '\n'.join(lists) + '\n')

def generate(mode, template, ranges, tunnel_peer=None, origin_bind=None):
    if mode not in MODES:
        raise ValueError('CLIENT_IP_MODE inválido.')
    if '# FULLPASSWORD TRUSTED CLIENT IP' in template:
        raise ValueError('Use o template original, não uma configuração já gerada.')
    prefix = '# FULLPASSWORD TRUSTED CLIENT IP: ' + mode + '\n'
    if mode == 'direct':
        prefix += 'map "" $fp_cloudflare { default 0; }\n'
    else:
        if mode == 'cloudflare_tunnel':
            if origin_bind not in ('127.0.0.1', '::1'):
                raise ValueError('Tunnel exige origin publicado em loopback.')
            peer = ipaddress.ip_address(tunnel_peer or '')
            if not (peer.is_private or peer.is_loopback) or peer.is_unspecified:
                raise ValueError('Peer do tunnel deve ser endereço local explícito.')
            networks = [str(peer) + ('/32' if peer.version == 4 else '/128')]
        else:
            networks = parse_ranges(ranges)
        prefix += 'geo $realip_remote_addr $fp_trusted_peer {\n    default 0;\n'
        prefix += ''.join('    ' + v + ' 1;\n' for v in networks) + '}\n'
        prefix += ''.join('set_real_ip_from ' + v + ';\n' for v in networks)
        prefix += 'real_ip_header CF-Connecting-IP;\nreal_ip_recursive off;\n'
        prefix += 'map "$fp_trusted_peer:$http_cf_connecting_ip" $fp_cloudflare {\n    default 0;\n    "~^1:[0-9a-fA-F:.]{2,45}$" 1;\n}\n'
        # Reject direct-origin traffic and malformed/list headers in both CF modes.
        template = re.sub(r'(server\s*\{)', r'\1\n    if ($fp_cloudflare = 0) { return 403; }', template)
    # Defer Docker DNS until requests, allowing nginx -t before dependencies start.
    template = template.replace('proxy_pass http://backend:3000;', 'set $backend_upstream backend:3000;\n        proxy_pass http://$backend_upstream;')
    template = template.replace('proxy_pass http://frontend:80;', 'set $frontend_upstream frontend:80;\n        proxy_pass http://$frontend_upstream;')
    if 'resolver 127.0.0.11' not in template:
        template = re.sub(r'(server\s*\{)', r'\1\n    resolver 127.0.0.11 valid=10s ipv6=off;', template)
    for header in ('X-Real-IP', 'X-Forwarded-For', 'CF-Connecting-IP', 'CF-Ray', 'CF-IPCountry', 'X-FullPassword-Cloudflare', 'X-FullPassword-Client-IP-Mode'):
        template = re.sub(r'^\s*proxy_set_header ' + re.escape(header) + r' [^;]*;\s*$', '', template, flags=re.M | re.I)
    cf_headers = {'CF-Connecting-IP': '$http_cf_connecting_ip', 'CF-Ray': '$http_cf_ray', 'CF-IPCountry': '$http_cf_ipcountry'}
    headers = {'X-Real-IP': '$remote_addr', 'X-Forwarded-For': '$remote_addr', 'X-FullPassword-Client-IP-Mode': mode, 'X-FullPassword-Cloudflare': '$fp_cloudflare', **{k: v if mode != 'direct' else '""' for k, v in cf_headers.items()}}
    addition = '\n'.join('        proxy_set_header ' + k + ' ' + v + ';' for k, v in headers.items())
    template, count = re.subn(r'(\s*proxy_set_header Host \$host;)', lambda m: m.group(1) + '\n' + addition, template)
    if count < 2:
        raise ValueError('Template sem locations proxy esperadas.')
    if '$proxy_add_x_forwarded_for' in template:
        raise ValueError('Cadeia pública XFF não pode ser preservada.')
    return prefix + template

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=MODES)
    parser.add_argument('--template', type=Path, default=ROOT / 'docker/nginx.conf')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--ranges', type=Path, default=ROOT / 'docker/cloudflare-ranges.txt')
    parser.add_argument('--tunnel-peer')
    parser.add_argument('--origin-bind')
    parser.add_argument('--refresh-ranges', action='store_true')
    args = parser.parse_args()
    if args.refresh_ranges:
        refresh_ranges(args.ranges)
        return
    if not args.mode or not args.output:
        parser.error('--mode e --output obrigatórios.')
    text = generate(args.mode, args.template.read_text(encoding='utf-8'), args.ranges.read_text(encoding='utf-8'), args.tunnel_peer, args.origin_bind)
    atomic_write(args.output, text)

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit('Configuração Client IP recusada: ' + str(error))
