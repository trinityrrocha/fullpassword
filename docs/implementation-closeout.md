# Fechamento de implementação — 2026-10-13

Base: de3bc952, branch security/audit-remediation-2026-09-17, PR #3 OPEN/DRAFT.
Escopo: código/dependências/documentação e uma bateria local consolidada. P0.6
suspensa. Nenhum acesso à VM, main, merge, approval ou release operacional.

## FP-10: análise e decisão técnica

Audits iniciais atuais: backend produção 0/full 3 high; frontend produção
0/full 5 high + 2 moderate. Causas:

| Pacote/cadeia instalada | Advisory | Patch disponível / decisão |
| --- | --- | --- |
| nodemon 3.1.14 → chokidar 3.6.0 → braces 3.0.3 (backend dev) | GHSA-vfj7-8cjw-p6xm, high, recursão/DoS | braces não tem patch (latest 3.0.3); nodemon atual continua chokidar 3. Downgrade para nodemon 1 não é correção aceitável. Remover watcher npm e usar Node 24 --watch; produção inalterada. |
| Tailwind 3.4.19 → chokidar 3.6.0 → braces 3.0.3 | mesma high | nenhum patch/minor Tailwind 3 elimina a cadeia. Chokidar major por override remove suporte de glob e não é compatível com callers. |
| Tailwind 3.4.19 → fast-glob 3.3.3 → micromatch 4.0.8 → braces 3.0.3 | mesma high, propagada aos pais | atualizar somente chokidar não resolve a segunda cadeia; vendoring/renomear pacote para esconder audit é recusado. |
| Tailwind 3.4.19 → postcss-nested 6.2.0 → postcss-selector-parser 6.1.4; Tailwind também usa parser | GHSA-rj75-hqrm-r3gf, moderate, complexidade quadrática | fix 7.1.6; override isolado cruzaria major e não resolveria braces. Migração controlada Tailwind 4.3.3 + plugin Vite elimina ambas as raízes. |

Referências primárias: [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[PostCSS advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf),
[guia oficial Tailwind](https://tailwindcss.com/docs/upgrade-guide).
Metadados npm/version/tree/audits atuais são guardados nas evidências locais da
tarefa; não usar números históricos como audit atual.

Risco contextual: padrões/seletores entram no tooling de build/dev de fontes
confiáveis, não no handler HTTP de produção. Ainda assim advisories não são
aceitos/ignorados: as cadeias foram removidas. O downgrade automático sugerido
pelo audit e audit fix --force não foram usados. Tailwind 4 é a única mudança
major adotada; paleta, radius, shadow/blur, defaults e spacing antigos mantidos.
Os lockfiles foram regenerados pelo npm, sem edição manual/pnpm.

## Reset

Evento futuro preserved, label explícito, código histórico retained com label
neutro. Não há migration de logs nem modificação do mecanismo criptográfico.
Teste acrescido ao harness HTTP/PostgreSQL real: nova senha/hash, revogação das
sessões anteriores/token_version, token consumido/replay, byte-identity de
identidade e todas as tabelas de ciphertext/envelopes/grants, unlock e leitura
de cofre sintético, novo audit sem segredos e evento histórico preservado.

## Varredura direcionada (não nova auditoria geral)

| Classe | Achado e tratamento |
| --- | --- |
| A — bug funcional concreto | Nenhum adicional comprovado além das incompatibilidades de tooling introduzidas e corrigidas nesta migração. |
| B — código/documentação | Reset chamado rotated; README afirma nova identidade, KDF de login e updater/main; docs anteriores dizem agente/publicação inexistentes. Corrigido no contrato vigente; histórico marcado e preservado. |
| C — segurança não implementada | FP-10, tratado removendo as cadeias sem fix. Sem nova evidência de bypass que justifique reescrever FP-01..13. |
| D — dívida não bloqueante | Defines Vite Share2/handleShareClick e VaultShareModal sem imports/usos atuais removidos; o compartilhamento ativo continua no VaultSharingManager/VaultSession, sem alterar crypto. Inicialização de GroupModal cancelável evita commits de resposta após fechamento/troca de edição, sem mudar permissões/payload. Helpers crypto reset antigos e transforms restantes preservados; bundle grande permanece aviso. |
| E — teste/homologação | WebUpdate E2E, casos humanos, permissões completa, SMTP/cloud reais, restore operacional/proxy/carga/mobile: deferidos para a homologação única após SHA candidato. |
| F — histórico/resolvido | Arquivos e resultados datados, migrations legadas e compatibilidade crypto preservados. “pending” de estado assíncrono/“placeholder” de input/config não são implementação faltante. |

## Documentação e fontes de verdade

Ver crypto-recovery-release.md e DESIGN.md. README alinhado; guias antigos de
crypto/instalação/deploy/matrizes datadas marcados históricos, sem reescrever
resultados passados. Login password, unlock secret, identidade, DEK/epoch,
release/manifest/approval, agente externo, runtime role e schema operator têm
significados separados. Essa documentação não confirma implantação do HEAD.

## Bateria local congelada

Executar depois de terminar código/docs: backend/frontend npm ci + npm test,
PostgreSQL audit e vault integrado (inclui o novo reset), approved-release,
release-agent, TLS, WebCrypto v2, update notifications, build, native-dev-watch,
tooling compat test, syntax checks, ESLint da fatia e global separadamente,
audit de produção/full de cada projeto e git diff --check. Evidências exatas
ficam no relatório externo da tarefa, ligado ao hash da working tree/commits.
Resultado não é presumido por essa lista de comandos.

Docker local indisponível: ensaio Docker de upgrade fica no CI do SHA candidato.
Não usar a VM como substituto. Não liberar CI/gates artificialmente. Os scripts
novos só usam fixtures sintéticas locais e não aceitam PostgreSQL remoto.
