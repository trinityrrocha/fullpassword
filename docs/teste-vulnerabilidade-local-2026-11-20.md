# Teste de vulnerabilidade dinâmico — instância local — 2026-11-20

## Escopo e ambiente

- **Alvo único:** `http://localhost:8080` (127.0.0.1), autorizado pelo responsável.
- **Containers:**
  - `fullpassword_nginx` (nginx 1.31.9, porta 127.0.0.1:8080);
  - `fullpassword_backend` (healthy);
  - `fullpassword_db` (healthy);
  - `fullpassword_frontend`.
- **Versão:** `/api/health` respondeu `schema_version: vault-identity-v2`, `commit: unknown`. A revisão exata da imagem não foi comprovada. O código cruzado é a `main` em `67c236e`.
- **Ferramentas:**
  - curl para a API;
  - `playwright-cli` 0.1.25 com o Chrome local, em duas sessões isoladas. Foi instalado globalmente com autorização; nada mudou no repositório.
- **Contas:** duas contas de teste criadas pelo responsável.
  - **A** (`suporte77`): papel `admin`, não Super Admin.
  - **B** (`suporte44`): papel `user`, no grupo "Comum", só leitura.
  - Os logins foram feitos pelo responsável nas janelas. Nenhuma senha passou pelo chat ou por arquivos. A conta Super Admin não foi usada.
- **Dados fictícios criados pelo teste** (prefixo `TESTE-FP`, dono A):
  - "TESTE-FP Cliente A privado" (com payload XSS no nome);
  - "TESTE-FP Compartilhado Comum";
  - três clientes de sondagem: `TESTE-FP dup2`, `TESTE-FP proto` e um chamado `{"a","b"}`.
  - **Não foram apagados**, por regra. Remover manualmente.
- **Não executado, por regra:** restauração de backup, WebUpdate, scripts de deploy, exclusões, leitura do `.env`.

### Incidentes durante o teste (registrados por transparência)

1. **Bloqueio de IP causado pelo teste.**
   - Às 20:32 UTC, três requisições de limite de entrada sem senha foram contadas como `login_failed` (`missing_credentials`). Eram corpo `text/plain`, form-urlencoded e JSON de 2 MB.
   - Com duas tentativas de e-mail inexistente, isso completou 5 falhas. O backend bloqueou `172.19.0.1`, o gateway do Docker, por 30 minutos. O bloqueio trancou também o responsável.
   - O responsável desativou a regra (`is_active=false`, sem exclusão). Isso virou o achado **L-01**.
2. **Exposição de token de teste na saída da sessão.**
   - Ao listar cookies da sessão B, o mascaramento falhou e os valores de `fp_session` (truncado) e `fp_csrf` apareceram na saída da ferramenta.
   - Os dois foram revogados logo em seguida pelo logout. O servidor confirmou com 401 ao reutilizar o token. Não houve gravação em arquivo.

## Resumo executivo

A instância local está bem protegida contra as classes clássicas:

- SQL injection: parametrização correta.
- XSS armazenado: React escapa, CSP sem `unsafe-inline`.
- CSRF: 403 sem token.
- IDOR entre contas: 404/403.
- Escalonamento para rotas de Super Admin: 403 em todas as testadas.
- Sessão: o JWT é revogado no servidor no logout.
- Cabeçalhos: CSP, HSTS, XFO, nosniff e CORS restrito à origem.

Quatro achados se confirmaram na prática:

- requisições triviais sem credencial disparam o bloqueio de IP de todos os que compartilham o endereço;
- um usuário comum lista todos os usuários, inclusive o e-mail do Super Admin e o fato de ele estar **sem MFA**;
- um usuário só-leitura consegue gravar no cofre (sobe a revisão e gera auditoria);
- falta validação de entrada (500 em UUID/JSON inválidos, tipos aceitos sem checagem).

**Nota geral de risco: média.** Não houve achado crítico nem alto confirmado dinamicamente.

## Achados

Os rótulos de confiança são:

- **confirmado**: reproduzido nesta instância;
- **provável**: lido no código, sem reprodução;
- **a verificar**: depende de fato não observado.

| ID | Sev. | Endpoint / arquivo:linha | Reprodução (sem segredos) | Impacto | Correção sugerida | Confiança |
|---|---|---|---|---|---|---|
| L-01 | média | `POST /api/auth/login` — `backend/src/controllers/authController.js:234-235` → `auditLoginFailure` → `services/ipSecurityService.js:56-71` | `curl -X POST -H 'Content-Type: text/plain' --data 'x' http://localhost:8080/api/auth/login`, cinco vezes em 15 min. Resposta 400 "Email e senha são obrigatórios", mas cada chamada grava `login_failed/missing_credentials`. Na 5ª falha, todo o `/api` daquele IP responde 403 "Acesso bloqueado." por 30 min. | Sem nenhuma credencial e com 5 requisições, um atacante tranca todos os usuários que compartilham o IP de saída (NAT corporativo, proxy, CGNAT, Docker local), inclusive o Super Admin. Reproduzido nesta instância, onde o responsável foi bloqueado. | Não contar `missing_credentials` (requisição malformada) para o bloqueio automático. Para o bloqueio, contar só falhas de senha. Considerar bloqueio por conta+IP em vez de IP global, e uma regra `allow` para a rede administrativa. | confirmado |
| L-02 | média | `GET /api/users` — `backend/src/controllers/userController.js:72-94`, `routes/userRoutes.js:9`. Também `GET /api/system/permissions` (devolve `super_admin_email`) e `GET /api/groups/options` | Logado como **B** (usuário comum): `fetch('/api/users')` → 200 com e-mail, `role`, `is_super_admin`, `mfa_enabled`, `must_change_password`, chave pública e grupos de todos os usuários. | Reconhecimento direcionado: B descobre que o Super Admin (`claude@…`) está **sem MFA**, qual é o e-mail dele e quem é admin. Isso serve de base para phishing ou credential stuffing contra a conta mais privilegiada. | Para não-admin, devolver só `id, name, email` e o fingerprint necessário ao compartilhamento. Remover `super_admin_email` de `/system/permissions` para não-admin. **Operacional:** habilitar MFA no Super Admin. | confirmado |
| L-03 | baixa | `POST /api/crypto/vaults/:id/records` — `backend/src/controllers/vaultCryptoController.js:241-280` | Como **B**, só leitura no "TESTE-FP Compartilhado Comum": `POST` com `{epoch:1, revision:"1", mutations:[]}` → **200 `{"saved":0}`**, e a revisão do cofre passou de 1 para 2. Um `create` real pelo mesmo B → 403, como esperado. | A checagem de permissão só roda dentro do laço de mutações. Com a lista vazia, um leitor faz uma escrita: incrementa `crypto_revision` e grava `vault_records_updated` em seu nome. Repetido, força `VAULT_VERSION_CONFLICT` para quem edita, o que é negação de edição, e polui a auditoria. Não lê nem altera registros. | Rejeitar `mutations` vazio (400) ou exigir `add`/`edit` antes de qualquer escrita. Não incrementar a revisão quando `saved=0`. | confirmado |
| L-04 | baixa | `GET /api/clients/:id/modules` (`clientController.js:87-93`), `GET /api/crypto/vaults/:id` e outros handlers com `:id` | `GET /api/clients/'%20OR%20'1'%3D'1/modules` → **500** "Erro ao buscar módulos da empresa". `GET /api/crypto/vaults/1%20OR%201=1` → **500** `CRYPTO_OPERATION_FAILED`. | Não é injeção: as consultas são parametrizadas, e o 500 vem do cast de UUID no PostgreSQL. Mas o erro interno é exposto como 500, gera ruído de log e mascara erros reais. | Validar o UUID na rota (middleware `param`) e responder 400 ou 404. | confirmado |
| L-05 | baixa | Qualquer `POST` JSON — `backend/src/server.js:159-165` | `curl -X POST -H 'Content-Type: application/json' --data '{bad' http://localhost:8080/api/auth/login` → **500** "Erro interno do servidor". | Igual a L-04: código de status errado, sem vazamento de detalhe. | No handler de erro, tratar `err.type === 'entity.parse.failed'` → 400. | confirmado |
| L-06 | baixa | `POST /api/clients` — `backend/src/controllers/clientController.js:37` | Como A: `{name:['a','b'], group_ids:'x'}` → **201**. O cliente foi criado com nome `{"a","b"}` (literal de array do PostgreSQL), e `group_ids` string foi aceito. | Falta validação de tipo na fronteira. Gera dados inconsistentes e caminhos não previstos. Sem impacto de autorização observado. | Validar tipos (`typeof name === 'string'`, `Array.isArray(group_ids)` com UUIDs), como já faz o `updateClient` (`:233-236`). | confirmado |
| L-07 | info | nginx / Express | `Server: nginx/1.31.9`. 404 de rota inexistente em `/api` responde HTML padrão do Express ("Cannot GET /api/debug"). `/api/health` expõe `commit` (aqui `unknown`). | Divulgação de versão e stack. | `server_tokens off;`, 404 JSON genérico em `/api`. | confirmado |

### Achados de código ainda não reproduzidos aqui

Detalhados em `docs/revisao-2026-11-20.md`:

| ID (revisão) | Sev. | Por que não foi reproduzido |
|---|---|---|
| R-01 (reset sem contador de MFA por conta) | média | Os usuários de teste não têm MFA, e o reset envia e-mail real para caixas `@example.com`. |
| R-02 (`can_delete` apaga o cofre inteiro) | média | Não havia usuário não-dono com `can_delete`. O teste não destrutivo é `DELETE` com `confirmation` inválida: se a permissão passar, o retorno é 400; se não, 403. |
| R-04 (exportar e restaurar backup sem reauth) | média | Exige a conta Super Admin, vetada para testes. |
| R-06 (credencial FTP/S3 reaproveitada com host novo) | baixa | Exige a conta Super Admin, vetada para testes. |
| R-07 (admin altera grupos sem reauth) | baixa | Exigiria alterar um grupo existente, sem autorização para isso. |
| R-11 (restauração v2 ignora o N do manifesto) | baixa | Restaurar é proibido por regra. |
| T-01 (suítes PG passam sem executar) | alta (processo) | Confirmado no ambiente de desenvolvimento, não nesta instância. |

## Testes que passaram (corretamente protegido)

**Cabeçalhos e configuração**
- Documento: `default-src 'self'; script-src 'self'` (sem `unsafe-inline`), `frame-ancestors 'none'`, `object-src 'none'`.
- API: `default-src 'none'`.
- HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cache-Control: no-store` na API, sem `X-Powered-By`.
- **CORS:** preflight e GET com `Origin: https://evil.example` devolvem `Access-Control-Allow-Origin: http://localhost:8080`. A origem maliciosa não é refletida.
- **Arquivos sensíveis:** `/.env`, `/.env.production`, `/.git/HEAD`, `/src/main.jsx`, `/node_modules/`, `/server-status` e afins caem no fallback da SPA (`index.html`, 522 B). Nada sensível é servido, e o conteúdo do `.env` não foi lido. Path traversal com `--path-as-is` (`/api/../../etc/passwd`, `%2e%2e`) → 400 do nginx.

**Limites de entrada**
- Corpo JSON acima de 2 MiB → 413, com ou sem `Content-Length` (chunked).
- `text/plain` e form-urlencoded não são interpretados.

**Autenticação**
- **Login:** a mesma mensagem e o mesmo status ("Credenciais inválidas", 401) para e-mail inexistente. A diferença de tempo existe no código (R-08) e não foi medida aqui, para não somar falhas de login.
- **Sessão:** depois do logout, o cookie antigo reaproveitado em `/api/auth/me` → **401**. O JWT é revogado no servidor. Antes do logout → 200. Uma escrita com o token antigo é barrada pelo CSRF (403).
- **Revogação por mudança de papel:** a sessão de B caiu ao trocar papel e grupo (`token_version`).
- **Cookie de sessão:** `HttpOnly; SameSite=Strict`. A flag `Secure` vem de `NODE_ENV=production` (`authController.js:43`) e não foi inspecionada nesta instância.
- **Bloqueio por tentativas:** dispara na 5ª falha. Foi observado aqui (no incidente) e também numa instância isolada.
- **CSRF:** `PUT /api/clients/:id` sem `x-csrf-token` → 403. Token forjado → 403 (instância isolada).

**Autorização: isolamento entre contas (B contra o cofre privado de A)**
- `GET /clients/:id/modules`, `GET /crypto/vaults/:id`, `GET /vault-items/:id` e `POST /crypto/vaults/:id/records|recipients` → **404**.
- `PUT /clients/:id`, `PUT .../modules` e `DELETE /clients/:id` → **403**.
- `GET /api/clients` de B lista só o cofre compartilhado.

**Autorização: cofre compartilhado só-leitura (B)**
- Lê (200, com envelope próprio).
- Editar, excluir e `create` de registro → 403.
- Stage e rotação → 403 `VAULT_OWNER_REQUIRED`.
- Exceção: a lista vazia (L-03).

**Autorização: escalonamento**
- B → `POST /users`, `PUT /users/<próprio>` (papel admin), `GET/POST /groups` e `/system/sessions` → 403.
- A (admin, não Super Admin) → `/system/sessions|smtp|password-policy|ip-rules|update/status|client-ip-status`, `/cloud-backup/status`, `/integrations/google-drive/status`, `POST /system/backup` e `PUT /system/password-policy` → **403**.
- `DELETE /users/:id` e `POST /users/:id/mfa-reset` → 403 `REAUTH_REQUIRED`.
- As mutações foram feitas contra UUID inexistente ou com payload inválido, sem efeito possível.

**Injeção**
- **SQL injection:** em path, query e ordenação, nenhuma consulta foi alterada (parâmetros ignorados ou 500 de cast, L-04).
- Parâmetro duplicado na query é inofensivo.
- Chave JSON duplicada: vale a última.
- `__proto__` sem efeito.
- **XSS armazenado:** cliente com nome `<img src=x onerror=window.__fpxss=1>`, renderizado na lista do navegador da sessão A. O texto aparece literal, nenhum `<img>` é criado, `window.__fpxss` continua indefinido e o console fica sem erros.

**Criptografia no cliente (parcial)**
- Nas 68 requisições de API capturadas na sessão A, incluindo a inicialização de 3 cofres (`recipients`, `stages`, `activate`), nenhum corpo ou resposta contém chave privada (`privateKey`, `BEGIN PRIVATE`, JWK `"d"`).

**Dependências (`npm audit`, mesmo dia)**
- Backend produção: 12 advisories (multer alta; nodemailer, basic-ftp, qs etc. moderadas).
- Frontend: follow-redirects alta (via axios; no navegador o axios usa XHR) e minimatch/eslint (dev).
- Análise detalhada em `docs/revisao-2026-11-20.md`.

## O que NÃO foi testado e por quê

- **"Servidor nunca recebe texto claro"** (marcador `TESTE-FP-MARCADOR-7781`): o item não foi salvo pela janela monitorada. Não houve nenhum `POST .../records` no tráfego capturado. O marcador não apareceu em nada, mas isso **não prova** a propriedade. Repetir: salvar o item na janela A e procurar o marcador nas requisições.
- **MFA** (bypass, replay, códigos de recuperação): as contas de teste não têm MFA, e habilitar exigiria um autenticador do responsável. Fica coberto por código e pelas suítes do projeto.
- **Reset de senha:** dispara e-mail real para endereços `@example.com`, fora do "só dados fictícios".
- **Bloqueio e rate limit até o limite:** por decisão do responsável, não foi rodado, porque o IP é compartilhado com a sessão de admin. O bloqueio ocorreu de qualquer forma (incidente 1).
- **Troca obrigatória de senha:** nenhuma conta de teste estava nesse estado.
- **SSRF** (S3/B2/FTP/SMTP/Google Drive), **upload de backup** (zip slip) e **exportação**: todos exigem Super Admin, vetado para testes. Ficam cobertos pela revisão de código (R-04, R-06, validação de nomes no v2).
- **R-02** (exclusão de cofre por não-dono com `can_delete`): não havia essa combinação de contas.
- **Injeção de cabeçalho ou e-mail:** `notify_emails` exige editar um cliente com módulo de domínio e enviaria e-mail real.
- **Flag `Secure` do cookie e HTTPS na 8443:** não inspecionados.

## Lista priorizada do que corrigir primeiro

1. **MFA no Super Admin** (operacional, imediato) e **L-02**: reduzir os campos de `/api/users`, `/system/permissions` e `/groups/options` para não-admin.
2. **L-01**: não contar requisição sem credencial no bloqueio automático. Rever o bloqueio por IP global quando o IP é compartilhado. Criar regra `allow` para a rede administrativa.
3. **L-03**: negar `mutations` vazio ou exigir permissão de escrita antes de incrementar a revisão.
4. **Pendências de código da revisão:** T-01, R-01, R-04 e R-02 (ver `docs/revisao-2026-11-20.md`).
5. **L-04, L-05, L-06**: validação de UUID, JSON e tipos na fronteira, com 400 em vez de 500.
6. **Dependências:** `npm audit fix` (multer, basic-ftp, qs, follow-redirects) e nodemailer 10.6.x.
7. **L-07**: `server_tokens off` e 404 JSON.
8. **Repetir** o teste do marcador em texto claro e, com contas preparadas, R-02 e o fluxo de MFA.
