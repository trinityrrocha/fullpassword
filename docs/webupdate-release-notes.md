# Notas assinadas do WebUpdate

`changes` é metadata opcional do manifesto assinado. Manifests históricos sem o
campo continuam válidos sem alteração dos bytes, assinaturas ou snapshots.
Não há migration ou mudança de schema.

## Preparação offline

Antes da assinatura externa, produzir e revisar os bytes do manifesto:

```sh
node scripts/prepare-release-manifest.js manifest-base.json FROM_SHA TO_SHA > manifest.json
```

Os dois SHAs devem ser completos, FROM deve ser ancestral de TO, e TO deve ser
igual à revisão do manifesto. O script não faz fetch, não consulta GitHub e não
executa deployment. Usa commits no range exato, ordem cronológica do Git e remove
duplicatas. Seleciona somente Conventional Commits fix/feat/security/perf/release
(incluindo escopo e breaking marker). Merge subjects e commits builder sem tipo
explícito não entram. Test/ci/docs/chore/refactor são omitidos.

O argumento opcional `reviewed-changes.json` substitui a lista derivada por notas
explicitamente revisadas. Para uma mudança interna relevante ao administrador,
usar `change` (label Alteração), ou uma categoria relevante. Builder não é
descoberto fora do range; sua nota só entra se explicitamente classificada como
`release` ou fornecida no arquivo revisado. Não truncar silenciosamente listas.

Formato: array com no máximo 50 objetos `{type,title}`; type em
fix/feat/security/perf/release/change, título entre 1 e 200 caracteres, trimado,
sem HTML, controles, substituição de shell, separadores de comando ou caminhos
executáveis. Preparação e validação do manifesto rejeitam entradas inválidas.
O operador revisa o resultado e assina esses bytes usando o processo homologado;
este script não possui chave, não cria approval e não publica catálogo.

## Cadeia de confiança e retenção

Manifesto assinado → validateManifest → approval/release-agent → catálogo
root-owned montado read-only → backend Super Admin → React (texto escapado).
Qualquer mudança de título invalida a assinatura. A fila continua aceitando
somente approvalId/revision/manifestHash/requestId; a API do navegador continua
aceitando somente approvalId/revision/manifestHash. Metadata nunca influencia
comandos, imagens, paths, autorização, migration ou execução.

Depois de deploy e verificação de estabilidade, o agente grava atomicamente
`installed-release.json` no diretório público protegido. Contém apenas a release
validada, vinculada a revisão/approval/checksum, não dados do request. A expiração
do catálogo não remove esse arquivo. Falha de release posterior não o substitui.
O frontend só usa essas notas quando ambos os runtimes confirmam a revisão
instalada; releases antigas sem notas recebem mensagem vazia amigável. Não é
um histórico completo. Não há armazenamento de notas no navegador.

O agente do host precisa ser atualizado pelo operador com os dois arquivos
versionados, hashes e timer parado/idle conforme bootstrap homologado, antes de
publicar o catálogo com notas. Atualizar apenas as imagens não atualiza o agente.
Não é permitido improvisar request por API ou arquivo de fila. Nesta tarefa,
merge/upgrade do agente/preparação operacional dependem da autorização pertinente;
o clique final de WebUpdate permanece humano.
