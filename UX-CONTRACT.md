# UX Contract — fatia de homologação PR #3

## Product context

Console administrativa existente, pt-BR, claro/escuro. Objetivo de acessibilidade:
WCAG 2.2 AA; esta documentação não declara auditoria global das telas antigas.

## Business-context sources

| Escopo | Fonte autoritativa | Revisão |
|---|---|---|
| Update aprovado e recuperação | docs/security-web-update-design.md e pedido do responsável em 2026-10-05 | 2026-10-05 |
| Permissão por cofre | backend/src/services/accessControlService.js | 2026-10-05 |
| Compartilhamento por item | database/migrations/24_scope_legacy_item_shares.sql e vaultCryptoController.js | 2026-10-05 |
| Implantação isolada | docs/security-audit-deployment.md | 2026-10-05 |

## Visual contract

DESIGN.md espelha Tailwind/index.css; runtime é canônico. Não alterar tokens globais.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Form | ReauthDialog | frontend/src/components/ReauthDialog.jsx | confirmação sensível, sem valores persistidos | ESLint/build; browser pendente |
| CRUD | API/backend | releaseController.js, vaultCryptoController.js | pedido pessimista; leitura somente para item | HTTP + PostgreSQL |
| Scrollbar | frontend/src/index.css | CSS runtime existente | fluxo natural; sem novo scroller de tabela | revisão estática |

## Flow ledger

| Operação | Pendente | Sucesso | Falha/retorno | Fonte |
|---|---|---|---|---|
| Solicitar release | botão bloqueado; reauth comum | 202; acompanha GET | resultado incerto não repete POST; consulta estado | releaseController |
| Implantação | deploying/stabilizing, sem porcentagem | digests + SHAs + saúde depois de 60s | recovery_required; intervenção operador | release-agent |
| Ler item | loading; cancela leitura anterior | snapshot exato em memória | permanece na lista; mensagem amigável | sharedItemService |
| Bloquear identidade | cancela request e invalida geração | conteúdo removido | não restaura plaintext antigo | useClearOnVaultLock |

## Navigation and responsive behavior

Nenhuma rota criada. Painéis seguem Settings/Clientes existentes; sem mudança no
shell. SHA quebra linha. Itens diretos não navegam para um cofre não autorizado.
Negação de cofre responde 404 deliberadamente para não divulgar sua existência.

## Overlays and feedback

ReauthDialog é portal no body e torna root inert. Trap de Tab, Escape condicionado
ao request, foco devolvido ao trigger ou painel quando trigger estiver disabled.
Erros inline persistentes; não há toast contendo conteúdo do cofre.

## Async and resilience

Pessimista, um request por aprovação, ledger externo antes dos efeitos.
Polling somente GET, um request de leitura por vez, abort ao desmontar.
Timeout não significa falha de implantação e não dispara retry de POST.
Nenhuma aprovação vira novamente disponível depois de crash sem reconciliação.

## Validation and permission

Super Admin + CSRF + reauth vinculado a propósito/ação/sessão e MFA habilitado.
Somente IDs/SHA/checksum aceitos. Itens leem seu grant original; chave isolada,
sem permissão de escrita e sem envelope do cofre. Sensitive values em memória.
Senha de reauth não é segredo de desbloqueio e não é escrita na fila.

## Migration status

Fatia atual: update e leitura scoped. Não migrar globalmente componentes legados
com alert/confirm nesta tarefa. Superfícies novas não podem introduzir esses bypasses.
Retenção de ciphertexts e grants antigos é intencional, sem destruição para migração.

## Verification

Node checks, testes de assinatura/agente, HTTP/PostgreSQL, frontend ESLint/build,
audit_project strict focado nos novos painéis. Navegador Windows é proibido pela
skill para gerenciador de senhas/autenticação; roteiro manual em docs. Nenhum
resultado manual ou da VM deve ser presumido pelo sucesso dos testes locais.
