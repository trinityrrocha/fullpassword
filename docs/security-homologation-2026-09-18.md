# Continuação de homologação — 2026-09-18

Base conferida: 11d4347a3865b6e1520f0e6d000ff9cf63d2bb0e.
Correções de código desta revisão: 0eb6dd1ccc5bc57f22faa175ae995b0a3f837076.
Os testes/documentação complementares estão nos commits seguintes do mesmo PR.
O SHA final e o CI correspondente devem ser consultados no PR #3 e no
manifesto do ZIP de entrega; não confundir com o SHA base.

Branch security/audit-remediation-2026-09-17; PR continua draft, sem merge.
Ambiente local: Windows, Node 24.19.0, PostgreSQL nativo 15.18 em loopback,
portas/diretórios/bases descartáveis. Somente dados sintéticos.

## Resultado principal

Foram corrigidos riscos encontrados na revisão e executadas validações locais.
**Não houve implantação nem validação autenticada em pw.sti1.com.br.**
A exclusividade de homologação e a autorização estão confirmadas pelo responsável.
A skill computer-use proíbe automação de gerenciadores de senhas e autenticação;
não foi usada outra via HTTP/browser para contornar isso.

A atualização web antiga é incompatível com FP-11: API desativada e frontend
enganoso prometendo instalar main. O frontend foi corrigido; não representa um
agente web novo. Foi preparado o contrato de uma ponte segura em
[security-web-update-design.md](security-web-update-design.md), ainda sem
implementação, instalação ou teste operacional. O deploy assinado por operador
foi endurecido, mas não foi executado no host.

## Defeitos corrigidos nesta revisão

| Cenário | Esperado | Observado após alteração | Evidência |
|---|---|---|---|
| Compartilhamento direto legado por item durante migração | Não remover grants nem ampliá-los para todo cofre | 409 LEGACY_DIRECT_SHARES_REQUIRE_REVIEW; bloqueia antes e durante ativação; originais preservados | test-vault-integrated-postgres.js |
| Inclusões acumuladas e tombstones | Cofre não pode exceder a capacidade suportada na rotação | Limite 20.000 registros e 64 MiB de ciphertext; excesso 413 com rollback de dados/revisão | Mesmo teste; fronteiras e 20.000 tombstones reais no PG |
| ID de registro malformado | Erro de cliente, não 500 PostgreSQL | 400 INVALID_RECORD_ID antes da consulta | Mesmo teste, UUID inválido |
| Papel runtime com privilégio DDL | Modo verify deve recusar CREATE/ownership/BYPASSRLS | Guarda ampliada; teste concede CREATE, observa rejeição e revoga | Mesmo teste em conexão SET ROLE |
| Deploy com frontend diferente/unknown | Não registrar sucesso só com backend saudável | SHA completo de frontend e backend obrigatório, schema_ready=true | test-approved-release.js + version.json emitido pelo Vite |
| Deploy concorrente/sem limite de comando | Serializar e limitar subprocessos | Lock exclusivo; timeout 10 min; arquivo de política deve ser regular | Revisão de código; ensaio Docker do deploy ainda pendente |
| UI de update antiga | Não prometer main nem tratar 60 segundos como sucesso | Painel somente leitura, versões e limitação explícita; removido reload por contador | test-update-notifications.js, teste cloud-backup, ESLint/build |
| CI construindo merge sintético | Validar artefato do HEAD exato pedido | Checkout e metadados das imagens usam pull_request.head.sha | Workflow security-regression.yml; resultado final no PR |

Limite de capacidade não é quota global de histórico/conta. Cofres legados acima
do limite permanecem bloqueados, não truncados. Necessitam plano de migração em
partes e testes de escala antes de produção. Não há expurgo automático de dados.

## Matriz FP-01 a FP-13

Todos os resultados locais referem-se ao código desta continuação, não à
instalação. Evidências anteriores estão preservadas no relatório principal.
Revisão direcionada não é declaração de auditoria exaustiva dos plugins/UI.

| Achado | Revisão de código | Implementação | Local/CI: esperado e observado | Implantação teste | Validação remota | Pendências |
|---|---|---|---|---|---|---|
| FP-01 | Identidade independente e API revisadas | Preservada | Login não abre identidade; segredo ausente dos payloads; testes passaram | Não | Não | Navegador, recuperação completa e revisão cripto independente |
| FP-02 | DEK/envelopes, migração, rotação revistos | V2 preservado; bloqueio de shares diretos legado acrescentado | Isolamento A/B, AAD/destinatário, grupos/revogação/rotação passaram | Não | Não | Compartilhamento direto v2 não implementado; bloqueio evita perda mas não entrega o fluxo pedido |
| FP-03 | Deltas/CAS/limites revistos | Limite cumulativo e UUID corrigidos | Inclusão sem edição/exclusão, editor sem delete, 413 e rollback passaram | Não | Não | Percorrer todas as abas; quotas de histórico e cofres grandes |
| FP-04 | Interseção/grupos/revogações revista | Preservada | Dois grupos mantêm acesso; último caminho nega/rota; suíte PG passou | Não | Não | Caminhos diretos por item continuam bloqueados para migração |
| FP-05 | Reauth vinculada a ação/sessão revista | Preservada | Ausência, payload adulterado e reuso negados; confirmação de e-mail/sessões passaram | Não | Não | Matriz visual de ações sensíveis e entrega em caixa dedicada |
| FP-06 | Transações reservadas/staging revistos | Preservada | Concorrência CAS, falha após DELETE, rollback e retomada passaram | Não | Não | Escala/lock global; todos os writers externos à API |
| FP-07 | Runtime/compose/papel DB revistos | Verify recusa DDL/ownership adicional | Role DML aceita; CREATE recusado; CI valida backend não-root | Não | Não | Runtime/proxy do host; modo verify precisa ser provisionado |
| FP-08 | Fluxos sensíveis e testes de consumo revistos | Preservada | MFA concorrente/replay/expiração e orçamento persistente passaram | Não | Não | Todos os fluxos por navegador |
| FP-09 | Política KDF/compatibilidade revisada | Preservada | Primitivas, backups legados/novos e restauração passaram | Não | Não | Benchmark e titulares ausentes |
| FP-10 | Lockfiles preservados | Sem nova dependência | Suítes SMTP/TLS passaram; audit do HEAD no CI | Não | Não | Comparar inventário realmente instalado |
| FP-11 | Deploy e UI revisados | SHA frontend+backend, lock e UI honesta | Assinatura/origem/digest/revisão inválidos recusados; build passou | Não | Não | Agente web só desenhado; assinatura/registry/bootstrap/rollback/rulesets operacionais |
| FP-12 | Controles anteriores preservados/retestados | Sem downgrade adicionado | Capturadores locais recusam STARTTLS ausente/certificados inválidos e aceitam TLS válido | Não | Não | Certificados/provedores reais |
| FP-13 | Guard/limites/lease revistos | Preservada | Auth antes multipart, espaço/timeout/aborto/crash e limpeza passaram | Não | Não | Nginx/disco/rede da homologação |

## Validações executadas

- 21 hashes do pacote original conferidos; README, índices e T01–T10 lidos.
  Código/lockfiles antigos do ZIP não foram importados.
- Backend: os 17 scripts de npm test executados via Node com TZ America/Sao_Paulo.
- Frontend: os 16 scripts de npm test, test-vault-crypto-v2.js e
  test-update-notifications.js.
- PostgreSQL real: test-audit-postgres.js e test-vault-integrated-postgres.js.
  Incluem sessão/CSRF via HTTP loopback, permissões, migração, reauth,
  restauração em segunda base e MFA/configuração cifrada.
- Testes adicionais de migração incluem identidade ausente, duas versões
  históricas e anexo sintético comparado após descriptografia, com preservação
  dos ciphertexts originais. Isso não comprova a UX de download na instalação.
- Capturadores locais SMTP/FTPS: test-audit-tls.js; release: test-approved-release.js.
- git diff --check, node --check nos arquivos backend/deploy, ESLint dos
  arquivos frontend alterados e build Vite. Build aprovado, com aviso conhecido
  de chunk maior que 500 kB.

CI da revisão 1d2164f2753963e5b8bf274dfd37527f9513ec1f:
https://github.com/trinityrrocha/fullpassword/actions/runs/35360621312
aprovado nos jobs regression e images. Os audits de dependências indicaram
zero vulnerabilidades. Backend não-root e SHA completo dos dois serviços
foram comprovados nas imagens de CI; elas não foram publicadas ou implantadas.
O frontend nginx não foi declarado não-root por esse teste.

As primeiras execuções PG no sandbox concluíram as asserções mas ficaram presas
ao encerrar processos Windows; foram interrompidas, não contadas como sucesso.
Execuções posteriores autorizadas fora do sandbox concluíram com exit 0 e
limpeza. Foi adicionado encerramento explícito de conexões HTTP do teste.
Um teste estático antigo exigia o botão de update removido; passou a exigir
painel sem POST/botão. As demais asserções foram preservadas.

## Não executado e risco residual

- Docker local indisponível; compose/deploy/rollback não ensaiados localmente.
  O CI constrói imagens e inicia backend com PG isolado; isso não é deploy.
- Navegador, login e API da instalação, update web, backup/restore do host,
  identificação de infraestrutura/revisões/digests instalados.
- Horários de acionamento/fim e espera de 60 segundos: **não aplicável**,
  pois não houve atualização. Revisão instalada: **não comprovada**.
- Agente web descrito no desenho: não implementado, nem declarado disponível.
- Compartilhamento direto por item no modelo v2 requer decisão de granularidade:
  não é seguro converter acesso a um item em chave de todo o cofre. O guard
  atual preserva e bloqueia; o operador não deve apagar grants para “passar”.
- Validação visual de todas as abas/anexos, escala, recuperação do host e revisão
  criptográfica independente ainda são critérios abertos.

**Recomendação: manter draft e não usar esta revisão com dados sensíveis ainda.**
O responsável pode executar o roteiro manual de implantação/validação, mas
primeiro é necessário concluir/provisionar a ponte web ou autorizar de forma
explícita o bootstrap por operador. Não substituí o update web silenciosamente.
