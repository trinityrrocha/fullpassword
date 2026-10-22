#!/usr/bin/env python3
"""Real isolated Nginx -> Express tests. No existing installation is modified."""
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import random
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('client_ip_config', ROOT / 'scripts/configure-client-ip.py')
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)

def run(args, check=True):
    r = subprocess.run(args, capture_output=True, text=True, timeout=90)
    if check and r.returncode:
        raise RuntimeError('Test command failed: ' + ' '.join(args[:3]) + '\n' + r.stderr[:2000])
    return r.stdout.strip()

def main():
    image = os.environ.get('CLIENT_IP_TEST_IMAGE', 'fullpassword-audit-backend')
    run(['docker', 'image', 'inspect', image])
    prefix = 'fp-ip-' + uuid.uuid4().hex[:10]
    networks = json.loads(run(['docker', 'network', 'inspect', *run(['docker','network','ls','-q']).split()]))
    used = [ipaddress.ip_network(c['Subnet']) for n in networks for c in (n.get('IPAM',{}).get('Config') or []) if c.get('Subnet')]
    choices = [ipaddress.ip_network(f'198.19.{i}.0/24') for i in range(1,255)]
    random.shuffle(choices)
    subnet = next(n for n in choices if not any(n.version == u.version and n.overlaps(u) for u in used))
    gateway, backend_ip, nginx_ip, trusted_ip, untrusted_ip = [str(subnet.network_address+i) for i in range(1,6)]
    v6prefix='fd'+uuid.uuid4().hex[:2]+':'+uuid.uuid4().hex[:4]+':'+uuid.uuid4().hex[:4]+'::'
    v6network=v6prefix+'/64'
    v6nginx=str(ipaddress.ip_address(v6prefix)+3)
    v6client=str(ipaddress.ip_address(v6prefix)+5)
    containers = []
    results = []
    with tempfile.TemporaryDirectory(prefix='fp-ip-nginx-') as directory:
        directory = Path(directory)
        run(['docker','network','create','--subnet',str(subnet),'--gateway',gateway,'--ipv6','--subnet',v6network,prefix])
        try:
            # Exercise the real installer menu/functions without running main,
            # generating secrets, touching services or writing an .env.
            menu_results=[]
            for choice, expected in [('1','direct'),('2','cloudflare_proxy'),('3','cloudflare_tunnel')]:
                menu=subprocess.run(['bash','-c','source "$1"; select_install_mode >/dev/null; printf "%s" "$CLIENT_IP_MODE"','test',str(ROOT/'scripts/install.sh')],input=choice+'\n',capture_output=True,text=True,timeout=10)
                assert menu.returncode==0 and menu.stdout==expected,menu.stderr
                menu_results.append(expected)
            install_dir=directory/'installer';(install_dir/'docker').mkdir(parents=True)
            run(['bash','-c','source "$1"; APP_DIR="$2"; DOMAIN=client-ip.example.invalid; INSTALL_MODE=public_ip; generate_nginx_config','test',str(ROOT/'scripts/install.sh'),str(install_dir)])
            tls_template=(install_dir/'docker/nginx.runtime.conf').read_text()
            cert=directory/'cert';cert.mkdir()
            run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=client-ip.example.invalid','-keyout',str(cert/'privkey.pem'),'-out',str(cert/'fullchain.pem')])
            for tls_mode in ['direct','cloudflare_proxy']:
                tls_file=directory/(tls_mode+'-tls.conf')
                tls_file.write_text(config.generate(tls_mode,tls_template,(ROOT/'docker/cloudflare-ranges.txt').read_text()))
                run(['docker','run','--rm','--network',prefix,'-v',str(tls_file)+':/etc/nginx/conf.d/default.conf:ro','-v',str(cert)+':/etc/letsencrypt/live/client-ip.example.invalid:ro','nginx:alpine','nginx','-t'])
            for mode in config.MODES:
                backend, nginx = prefix+'-'+mode+'-backend', prefix+'-'+mode+'-nginx'
                template = (ROOT/'docker/nginx.conf').read_text().replace('backend:3000',backend+':3000').replace('frontend:80',backend+':3000')
                generated = config.generate(mode, template, trusted_ip+'/32', gateway, '127.0.0.1')
                file = directory/(mode+'.conf'); file.write_text(generated)
                source = str(ROOT/'backend/src/services/clientIpService.js')
                fixture = str(ROOT/'backend/scripts/client-ip-http-fixture.js')
                run(['docker','run','-d','--name',backend,'--network',prefix,'--ip',backend_ip,
                    '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
                    '-e','CLIENT_IP_MODE='+mode,'-e','TRUSTED_COUNTRY_HEADER_ENABLED=true',
                    '-v',source+':/usr/src/app/src/services/clientIpService.js:ro',
                    '-v',fixture+':/usr/src/app/scripts/client-ip-http-fixture.js:ro',
                    '--entrypoint','node',image,'scripts/client-ip-http-fixture.js'])
                containers.append(backend)
                sock=socket.socket(); sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]; sock.close()
                run(['docker','run','-d','--name',nginx,'--network',prefix,'--ip',nginx_ip,
                    '-p',f'127.0.0.1:{port}:80','-v',str(file)+':/etc/nginx/conf.d/default.conf:ro','nginx:alpine'])
                containers.append(nginx)
                syntax = run(['docker','exec',nginx,'nginx','-t'])
                # Also validate the production official-range configuration, not just a simulated peer.
                official = directory/'official.conf'
                official.write_text(config.generate('cloudflare_proxy',template,(ROOT/'docker/cloudflare-ranges.txt').read_text()))
                run(['docker','run','--rm','--network',prefix,'-v',str(official)+':/etc/nginx/conf.d/default.conf:ro','nginx:alpine','nginx','-t'])
                base='http://'+nginx+':80'
                def client(ip,headers=None,url='/api/probe',ipv6=False):
                    target=('http://['+v6nginx+']:80' if ipv6 else base)+url
                    js="fetch("+json.dumps(target)+",{headers:"+json.dumps(headers or {})+"}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.text()}))).catch(()=>process.exit(1))"
                    value=run(['docker','run','--rm','--network',prefix,'--ip',ip,*(['--ip6',v6client] if ipv6 else []),'--entrypoint','node',image,'-e',js])
                    r=json.loads(value)
                    try:r['body']=json.loads(r['body'])
                    except json.JSONDecodeError:pass
                    return r
                for attempt in range(25):
                    try:
                        run(['docker','exec',backend,'node','-e',"fetch('http://127.0.0.1:3000/api/health').then(()=>{}).catch(()=>process.exit(1))"])
                        break
                    except RuntimeError:time.sleep(.2)
                spoof={'CF-Connecting-IP':'8.8.8.8','X-Forwarded-For':'1.1.1.1','X-Real-IP':'9.9.9.9','X-FullPassword-Cloudflare':'1','CF-Ray':'0123456789abcdef-GRU','CF-IPCountry':'BR'}
                if mode == 'direct':
                    r=client(untrusted_ip,spoof)
                    assert r['status']==200 and r['body']['client_ip']==untrusted_ip,r
                    assert not r['body']['cloudflare'] and r['body']['country'] is None,r
                    # Assign a stable v6 address to Nginx for the actual TCP test.
                    nginx_data=json.loads(run(['docker','inspect',nginx]))[0]['NetworkSettings']['Networks'][prefix]
                    v6nginx=nginx_data['GlobalIPv6Address']
                    v6=client(untrusted_ip,spoof,ipv6=True)
                    assert v6['status']==200 and ipaddress.ip_address(v6['body']['client_ip'])==ipaddress.ip_address(v6client),v6
                    results.append({'mode':mode,'socketWinsForgedHeaders':True,'client_ip':untrusted_ip,'tcpIpv6SourceWinsSpoof':'PASS','nginxSyntax':'PASS'})
                elif mode == 'cloudflare_proxy':
                    assert client(untrusted_ip,spoof)['status']==403
                    good=client(trusted_ip,spoof)
                    assert good['status']==200 and good['body']['client_ip']=='8.8.8.8',good
                    assert good['body']['cloudflare_ray_id']=='0123456789abcdef-GRU'
                    for bad in ['', '1.1.1.1,2.2.2.2','1.1.1.1/32','999.1.1.1','2001:::1','arbitrary','x'*10000]:
                        assert client(trusted_ip,{'CF-Connecting-IP':bad})['status'] in (400,403,494)
                    for ip in ['2001:db8::123','::ffff:203.0.113.10']:
                        r=client(trusted_ip,{'CF-Connecting-IP':ip})
                        assert r['status']==200,r
                    results.append({'mode':mode,'untrustedPeerRejected':True,'trustedPeerAccepted':True,'malformedRejected':True,'IPv6Mapped':'PASS','officialRangesNginxSyntax':'PASS','nginxSyntax':'PASS'})
                else:
                    def local(ip,url='/api/probe'):
                        req=urllib.request.Request(f'http://127.0.0.1:{port}'+url,headers={'CF-Connecting-IP':ip,'CF-Ray':'0123456789abcdef-GRU'})
                        try:
                            with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.load(r)
                        except urllib.error.HTTPError as e:return e.code,None
                    a,b='203.0.113.10','198.51.100.20'
                    for _ in range(2):assert local(a,'/api/limited')[0]==200
                    assert local(a,'/api/limited')[0]==429
                    code,value=local(b,'/api/limited');assert code==200 and value['client_ip']==b,(code,value)
                    assert client(untrusted_ip,spoof)['status']==403
                    bindings=json.loads(run(['docker','inspect',nginx]))[0]['NetworkSettings']['Ports']['80/tcp']
                    assert all(p['HostIp']=='127.0.0.1' for p in bindings)
                    results.append({'mode':mode,'loopbackOnly':True,'localPeerAccepted':True,'otherPeerRejected':True,'rateLimitAExhaustedBAllowed':True,'gatewayNotClientIdentity':True,'nginxSyntax':'PASS'})
                for name in [nginx,backend]:run(['docker','rm','-f',name]);containers.remove(name)
            print(json.dumps({'result':'PASS','tests':results,'installerMenuModes':menu_results,'installerGeneratedDirectProxyTlsNginxSyntax':'PASS','simulatedCloudflarePeer':True,'liveInstallationModified':False}))
        finally:
            for name in containers:run(['docker','rm','-f',name],False)
            run(['docker','network','rm',prefix],False)

if __name__=='__main__':main()
