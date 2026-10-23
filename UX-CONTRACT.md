# UX Contract — fatia de homologação PR #3

## Product context

Console administrativa existente, pt-BR, claro/escuro. Objetivo de acessibilidade:
WCAG 2.2 AA; esta documentação não declara auditoria global das telas antigas.

## Business-context sources

| Escopo | Fonte autoritativa | Revisão |
|---|---|---|
| Update aprovado e recuperação | docs/crypto-recovery-release.md e revisão UX autorizada pelo responsável | 2026-10-13 |
| Permissão por cofre | backend/src/services/accessControlService.js | 2026-10-05 |
| Compartilhamento por item | database/migrations/24_scope_legacy_item_shares.sql e vaultCryptoController.js | 2026-10-05 |
| Implantação isolada | docs/security-audit-deployment.md | 2026-10-05 |

## Visual contract

DESIGN.md espelha Tailwind/index.css; runtime é canônico. Não alterar tokens globais.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Form | FormDialog / ReauthDialog | frontend/src/components/FormDialog.jsx / ReauthDialog.jsx | perfil/equipe; confirmação sensível, sem valores persistidos | ESLint/build; browser isolado |
| Form/Dialog | FormDialog | frontend/src/components/FormDialog.jsx | perfil, membro, cliente, grupo; filho, obrigatório, descarte | browser isolado: hit test, foco, scroll, 320/390/768/1280 light/dark |
| Groups | GroupMembershipSelector | frontend/src/pages/TeamList.jsx | disclosure inline, checkboxes nativos, Escape retorna ao trigger | browser create/edit |
| CRUD | API/backend | releaseController.js, vaultCryptoController.js | pedido pessimista; leitura somente para item | HTTP + PostgreSQL |
| Scrollbar | frontend/src/index.css | CSS runtime existente | fluxo natural; sem novo scroller de tabela | revisão estática |
| Select/Listbox | select nativo | SecurityCard / PasswordPolicyCard; DESIGN.md | popup do SO aceito, h35, labels reais | browser 1280/390/320 claro/escuro e teclado |

## Flow ledger

| Operação | Pendente | Sucesso | Falha/retorno | Fonte |
|---|---|---|---|---|
| Solicitar release | botão bloqueado; POST com sessão/CSRF, sem reauth extra | 202; acompanha GET | resultado incerto não repete POST; consulta estado | releaseController |
| Configurar identidade | senha atual + segredo independente; MFA só quando mfa_enabled=true | identidade persistida; segredo em memória | erro inline; backend confere MFA real | UserCryptoIdentitySetup + vaultCryptoController |
| Implantação | deploying/stabilizing, sem porcentagem | digests + SHAs + saúde depois de 60s | recovery_required; intervenção operador | release-agent |
| Ler item | loading; cancela leitura anterior | snapshot exato em memória | permanece na lista; mensagem amigável | sharedItemService |
| Bloquear identidade | cancela request e invalida geração | conteúdo removido | não restaura plaintext antigo | useClearOnVaultLock |

## Navigation and responsive behavior

WebUpdate: status e versões curtas no resumo; detalhes técnicos em disclosure
inline “Mais informações”, fechado inicialmente, operável por teclado e com
aria-expanded/aria-controls. Atualizar sistema conserva o POST existente;
Consultar progresso é somente leitura. Completed confirmado oculta a ação de
novo pedido, mesmo com request one-shot preservado. Falha de consulta não é
falha de implantação; progresso antigo não representa uma aprovação nova.

Nenhuma rota criada. Painéis seguem Settings/Clientes existentes; sem mudança no
shell. SHA quebra linha. Itens diretos não navegam para um cofre não autorizado.
Negação de cofre responde 404 deliberadamente para não divulgar sua existência.

## Overlays and feedback

Clientes → Cadastrar Novo Cliente e Equipe → Novo/Editar Grupo usam FormDialog
(2026-10-23). O painel posicionado fica acima do backdrop no portal, com foco
contido/restaurado, Escape, corpo rolável, ações persistentes e descarte protegido.
Campos e payloads existentes são preservados; nome obrigatório e e-mail opcional
válido continuam usando a validade dos controles, com erro inline em vez de bolha
nativa. Falha de save conserva o formulário; um ref bloqueia submit duplicado.
O grupo Administradores mantém nome/permissões bloqueados. Fonte: ClientsList,
GroupModal e contratos existentes de /clients e /groups. Evidência reproduzível:
frontend/scripts/test-modal-interaction-browser.js (1280/768/390, claro/escuro,
clique/digitação reais, hit-test, membros/permissões, save/retry/cancel e teclado).

ReauthDialog é portal no body e torna root inert. Trap de Tab, Escape condicionado
ao request, foco devolvido ao trigger ou painel quando trigger estiver disabled.
Erros inline persistentes; não há toast contendo conteúdo do cofre.

## Async and resilience

Perfil: nome/e-mail/senhas/MFA/preferências/sessões nessa ordem. E-mail readonly
abre fluxo existente de código e confirmação de posse; senha de login usa o
PUT profile existente, mantém rewrap legado e não modifica crypto_identity v2.
forcePasswordChange abre diretamente o formulário obrigatório, sem Cancelar.

Troca do segredo independente: microcopy distingue login de desbloqueio.
O formulário solicita login/TOTP para o serviço de reauth existente; o login
também permite comparar localmente os segredos sem enviar o segredo dos cofres.
É variante de captura para a mesma autorização purpose/action/session, não um
novo mecanismo de autenticação. ReauthDialog permanece o fallback global.
Novo endpoint só aceita envelope/KDF/salt/hash esperado, own-user, CAS JSONB,
CSRF e rate limit. Nenhum campo imutável pode ser enviado/substituído.
Invariantes de domínio: vaultCryptoV2.js, identityUnlockController.js e testes
test-identity-unlock-change.js / identity-unlock-change-fixture.js.
Sucesso limpa chaves, clipboard e callbacks, incrementa epoch e exige unlock.
Cada unlock v2 recarrega o envelope atual; uma geração impede conclusão antiga
de restaurar chaves depois do bloqueio. Falha conserva o diálogo, não os segredos.
Um 409 orienta fechar/reabrir: não há overwrite forçado nem retry automático.

Pessimista, um request por aprovação, ledger externo antes dos efeitos.
Polling somente GET, um request de leitura por vez, abort ao desmontar.
Timeout não significa falha de implantação e não dispara retry de POST.
Nenhuma aprovação vira novamente disponível depois de crash sem reconciliação.

## Validation and permission

WebUpdate: Super Admin autenticado + CSRF; sem reauth/MFA adicional. O painel não
aprova releases, somente solicita uma approval externa com IDs/SHA/checksum exatos.
Outras operações sensíveis mantêm reauth vinculado a propósito/ação/sessão e MFA.
Itens leem seu grant original; chave isolada,
sem permissão de escrita e sem envelope do cofre. Sensitive values em memória.
Senha de reauth não é segredo de desbloqueio e não é escrita na fila.

## Migration status

Política de senhas (2026-10-15): fonte de domínio `docs/password-security-policy.md`,
passwordPolicyService e passwordPolicySchema. Settings usa somente Segurança →
Política de Senhas. Edição pessimista dos quatro números, inline error/retry,
draft preservado ao recolher o accordion e warning de unload enquanto editado.
Login vencido reutiliza o diálogo obrigatório; cofre vencido mostra aviso e abre
o reenvelopamento existente. AuthProvider impede unlock e limpa chaves; sucesso
da troca continua bloqueado. Esta evolução exige schema-migrate em release futura;
as declarações de ausência de migração abaixo referem-se à fatia anterior do PR #5.

Fatia atual: update e leitura scoped. Não migrar globalmente componentes legados
com alert/confirm nesta tarefa. Superfícies novas não podem introduzir esses bypasses.
Retenção de ciphertexts e grants antigos é intencional, sem destruição para migração.

## Verification

Trusted Client IP (2026-10-21): Segurança contém ClientIpStatus, somente leitura
Super Admin, GET cancelável/timeout, erro inline com retry. Origem administrativa
vem de docs/trusted-client-ip.md; nenhuma preferência de banco altera topologia.
Loading/status/error preservam região, IPv6 longo quebra linha e dark/light usam
tokens existentes. Nenhum formulário, select, modal ou CRUD novo nesta fatia.

Perfil/Equipe são exercitados em fixture localhost isolada usando componentes,
CSS e criptografia reais, APIs fictícias e bloqueio de acesso externo. Isso não
é teste da instalação nem autorização para VM. PostgreSQL integrado é nativo,
temporário e localhost, com dados fictícios. Nenhuma migration nova é necessária.

Node checks, testes de assinatura/agente, HTTP/PostgreSQL, frontend ESLint/build,
audit_project strict focado nos novos painéis. Navegador Windows é proibido pela
skill para gerenciador de senhas/autenticação; roteiro manual em docs. Nenhum
resultado manual ou da VM deve ser presumido pelo sucesso dos testes locais.
