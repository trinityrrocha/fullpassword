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
| Form/Dialog | FormDialog | frontend/src/components/FormDialog.jsx | perfil, membro; filho, obrigatório, descarte | browser isolado: hit test, foco, scroll, 320/390/1280 light/dark |
| Groups | GroupMembershipSelector | frontend/src/pages/TeamList.jsx | disclosure inline, checkboxes nativos, Escape retorna ao trigger | browser create/edit |
| CRUD | API/backend | releaseController.js, vaultCryptoController.js | pedido pessimista; leitura somente para item | HTTP + PostgreSQL |
| Scrollbar | frontend/src/index.css | CSS runtime existente | fluxo natural; sem novo scroller de tabela | revisão estática |

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

Fatia atual: update e leitura scoped. Não migrar globalmente componentes legados
com alert/confirm nesta tarefa. Superfícies novas não podem introduzir esses bypasses.
Retenção de ciphertexts e grants antigos é intencional, sem destruição para migração.

## Verification

Perfil/Equipe são exercitados em fixture localhost isolada usando componentes,
CSS e criptografia reais, APIs fictícias e bloqueio de acesso externo. Isso não
é teste da instalação nem autorização para VM. PostgreSQL integrado é nativo,
temporário e localhost, com dados fictícios. Nenhuma migration nova é necessária.

Node checks, testes de assinatura/agente, HTTP/PostgreSQL, frontend ESLint/build,
audit_project strict focado nos novos painéis. Navegador Windows é proibido pela
skill para gerenciador de senhas/autenticação; roteiro manual em docs. Nenhum
resultado manual ou da VM deve ser presumido pelo sucesso dos testes locais.
