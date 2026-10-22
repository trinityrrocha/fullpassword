# Trusted Client IP — contrato de implantação

## Fonte única e fronteira de confiança

```text
direct:             Internet -- TCP source ----------> Nginx
cloudflare_proxy:   Internet -> Cloudflare oficial ---> Nginx
cloudflare_tunnel:  Internet -> Cloudflare -> cloudflared -> loopback -> Nginx
                                                        |
                    XFF substituído por UM endereço <----+
                               |
                    backend privado (um hop)
                               |
                    clientIpMiddleware / req.clientIp
                               |
          auditoria, sessões, regras IP, login/MFA, recuperação e limites
```

`CF-Connecting-IP` **nunca é confiado somente por existir**. No Proxy, o Nginx
valida o endereço TCP original contra os ranges oficiais. No Tunnel, o origin
deve estar publicado exclusivamente em loopback e confiar no peer local específico
descoberto na rede Docker. Endereços de gateway não são constantes do produto.
Outros containers/processos locais fazem parte da fronteira administrativa:
não execute workloads não confiáveis na rede/host do origin.

O backend **não pode ter porta publicada**. `trust proxy = 1` permanece porque
existe exatamente um Nginx imediatamente anterior; não é `true`. A camada central
valida um XFF único, nunca interpreta uma cadeia arbitrária. Todos os locations
Nginx (incluindo restore) substituem XFF/X-Real-IP e os marcadores internos.
Expor o backend diretamente invalidaria esse contrato; a API não autentica
headers de um atacante que contorne o Nginx. Os testes de Compose verificam que
backend/frontend/banco não são publicados.

## Configuração

`CLIENT_IP_MODE`: `direct`, `cloudflare_proxy` ou `cloudflare_tunnel`. Qualquer
outro valor impede startup. Ausência mantém `direct` seguro, com aviso no startup;
não há detecção por header. Em direct, metadados CF são descartados.

Os modos Cloudflare rejeitam peers não confiáveis no Nginx. A API recusa origem
não validada ou CF-Connecting-IP diferente do endereço canônico (403); endereços
inválidos/listas/duplicatas são recusados (400/403). Não existe fallback para
confiar cegamente em CF ou para usar uma chave compartilhada `unknown` no limiter.
O healthcheck local sem headers encaminhados é uma exceção somente de saúde.

IPv4, IPv6 e IPv4-mapped IPv6 convergem na mesma normalização (`net.isIP` e
ipaddr.js); CIDR, hostname, zona, porta, formatos abreviados/octal e múltiplos IPs
não são endereços de requisição válidos. Regras CIDR existentes continuam no
ipSecurityService. Rate limiting conserva o agrupamento IPv6 /64 anti-rotação;
clientes IPv4 distintos não compartilham contador.

O Nginx também escuta IPv6. Em **direct com IPv6 público**, a rede Docker precisa
ser dual-stack (`DOCKER_IPV6_ENABLED=true`, com suporte IPv6 no daemon/host e
porta publicada preservando a origem). Não altere a rede de uma instalação
existente automaticamente: prepare a mudança de infraestrutura separadamente.
O default false preserva a rede IPv4 já instalada. O proxy IPv6→IPv4 do Docker
pode mascarar o peer como gateway; nenhum header público pode reconstruí-lo de
forma segura. O teste Nginx exercita TCP IPv6 em rede dual-stack isolada. Nos
modos Cloudflare, um cliente IPv6 é preservado mesmo com origin/bridge IPv4,
pois o endereço delegado vem da cadeia Cloudflare validada.

`CF-Ray` sanitizado é acrescentado como `metadata.cloudflare_ray_id` no JSONB
de auditoria existente, somente em requisições Cloudflare validadas. Não autentica
ninguém. Country também exige cadeia validada e
`TRUSTED_COUNTRY_HEADER_ENABLED=true`; direct ignora o header mesmo com a opção
habilitada. Nenhuma alteração de schema/migration.

## Instalação nova

O instalador pergunta: 1 acesso direto, 2 Cloudflare Proxy, 3 Cloudflare Tunnel.
Proxy conserva o caminho de IP público/Certbot e exige DNS proxied; acesso
direto ao origin é rejeitado pelo Nginx (inclusive sem header CF).
Tunnel conserva o fluxo seguro de configuração cloudflared existente, publica
HTTP/HTTPS em loopback e descobre o gateway da rede recém-criada; não há gateway
universal embutido. Nenhum token é introduzido pelo gerador Client IP.

`scripts/configure-client-ip.py` gera o Nginx autocontido e grava atomicamente.
O instalador grava como root:root, 0644 (sem segredos), executa `nginx -t` antes
de iniciar os serviços e falha se a configuração não for válida.

Exemplos (geração apenas, sem iniciar/recarregar serviços):

```sh
sudo python3 scripts/configure-client-ip.py --mode direct \
  --template docker/nginx.conf --output docker/nginx.runtime.conf
sudo python3 scripts/configure-client-ip.py --mode cloudflare_proxy \
  --template docker/nginx.conf --output docker/nginx.runtime.conf
sudo python3 scripts/configure-client-ip.py --mode cloudflare_tunnel \
  --tunnel-peer <GATEWAY_LOCAL_DESCOBERTO> --origin-bind 127.0.0.1 \
  --template docker/nginx.conf --output docker/nginx.runtime.conf
```

Em instalação TLS, usar como template a configuração TLS original com os mesmos
locations/limites; não substituir por um template HTTP e perder TLS. Não usar
uma configuração já gerada como template.

## Ranges oficiais

Fonte única versionada: `docker/cloudflare-ranges.txt`, snapshot verificado em
2026-10-21 de [IPv4](https://www.cloudflare.com/ips-v4) e
[IPv6](https://www.cloudflare.com/ips-v6). O snapshot permite instalação offline
sem download silencioso. Atualização administrativa explícita:

```sh
sudo python3 scripts/configure-client-ip.py --refresh-ranges
```

Download HTTPS limitado/timeout, validação de CIDR/família, rejeição de resposta
vazia/HTML/ranges inseguros e substituição atômica **apenas depois de validar as
duas famílias**. Falha preserva o arquivo anterior. Revisar o diff dos ranges,
regenerar config e executar nginx -t antes de reload. Atualização de snapshot
versionado segue PR; não há scheduler baixando política de confiança.

Referências de semântica: [Nginx real IP](https://nginx.org/en/docs/http/ngx_http_realip_module.html),
[headers Cloudflare](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

## Upgrade existente — operação explícita, não realizada por este PR

Uma release de backend/frontend não troca sozinha o Nginx ou o Compose protegido.
Não executar update presumindo que um header ativará Cloudflare automaticamente.
Instalações antigas sem modo seguem direct com aviso; configurações legadas que
anexam cadeias XFF precisam ser canonicalizadas **antes** de atualizar a API,
senão a API falha fechada em vez de aceitar cadeia ambígua.

1. Inventariar cloudflared, binds, peers, Nginx ativo e Compose protegido; salvar
   cópia root-only restaurável. Não imprimir `.env`/tokens.
2. Escolher o modo explicitamente e gerar configuração do Nginx a partir do
   template correto. No Tunnel, preparar bind loopback no serviço Nginx e
   descobrir gateway por `docker network inspect` da rede real.
3. Validar `docker compose config` sem imprimir segredos e `nginx -t`; preparar
   rollback da configuração/bind. Não reconciliar ou recriar PostgreSQL.
4. Aplicar somente infraestrutura aprovada e definir CLIENT_IP_MODE no ambiente
   protegido do backend. Depois instalar a release aprovada pelo mecanismo normal.
5. Confirmar HTTP/health e diagnóstico Super Admin; verificar novos eventos e
   sessões (histórico antigo não é reescrito). Em falha, restaurar configuração.

Não executar o instalador inteiro sobre instalação existente. Não modificar
JWT_SECRET, CONFIG_ENCRYPTION_KEY, dados, approvals ou ledgers. A UI apenas mostra
diagnóstico; não existe select no banco que mude a fronteira de confiança.

## Diagnóstico e validação

`GET /api/system/client-ip-status`: sessão válida e Super Admin obrigatório;
retorna somente modo, client_ip, cloudflare, cf_ray_present e indicação de que é
definido na implantação. Não retorna configuração de cloudflared ou segredos.
Segurança usa ClientIpStatus, leitura cancelável, erro persistente/retry, layout
natural responsivo e tokens existentes. Nenhum controle de topologia na UI.

Testes dedicados:

```sh
node backend/scripts/test-trusted-client-ip.js
node backend/scripts/test-trusted-client-ip-postgres.js
python3 scripts/tests/client-ip-config.py
python3 scripts/tests/client-ip-nginx.py
```

O último exige Docker e imagem `fullpassword-audit-backend` construída do candidato
(ou CLIENT_IP_TEST_IMAGE explícito). Usa rede/containers temporários próprios,
bind loopback e dados sintéticos. O peer Cloudflare dos testes isolados é uma
simulação explícita; ranges oficiais também passam por nginx -t. Isso não deve
ser confundido com segundo IP público real. A prova pelo Tunnel real e a avaliação
da instalação são registradas separadamente no relatório da tarefa.
