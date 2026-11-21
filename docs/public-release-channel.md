# Canal público de atualizações

Decisão do mantenedor (2026-11-21): FullPassword é open source. Toda release
estável publicada deve ser anunciada igualmente para todas as instalações,
sem lista de clientes, domínio autorizado, token GitHub ou aprovação individual
para **descobrir** a atualização.

## Descoberta não é autorização de implantação

O backend consulta, anonimamente, o mesmo arquivo para todos:
`https://raw.githubusercontent.com/trinityrrocha/fullpassword/main/releases/stable.json`.
O envelope contém payload base64 e assinatura RSA/SHA-256. A chave pública
está embarcada em `backend/src/config/release-public.pem`; não vem da rede.
O payload fixa repositório, canal stable, SHA completo, imagens por digest,
histórico de ancestrais e notas. Não contém origin, approval ou comandos.

A consulta usa TLS, destino fixo, redirects proibidos, limite de 512 KiB e
timeout de 3 segundos. Cache/single-flight por processo: 15 minutos no sucesso,
1 minuto depois de falha. Não envia conta, domínio da instalação, cookies ou
segredos. O provedor de hospedagem vê o IP de saída como em qualquer acesso HTTPS.
Nenhum `.git`, PAT, scheduler antigo ou Docker socket é necessário no backend.

O painel mostra a versão pública mesmo sem agente/aprovação local. Histórico
completed de outra atualização não oculta uma release nova. Fork, revisão à
frente ou desconhecida não são tratados como pedido seguro de downgrade.
Falha/expiração da consulta nunca significa “sistema atualizado”. Cache antigo
é explicitamente identificado; metadados expirados não são apresentados.

O POST continua aceitando apenas approvalId/revision/manifestHash da aprovação
local protegida. O catálogo público não cria fila, policy, migration ou deploy.
As verificações de recuperação, origem da instalação, privilégios, CSRF,
assinatura de implantação, digests e ledger one-shot permanecem intactas.
Se a versão pública não estiver aprovada localmente, o painel explica a
preparação necessária, sem apresentar botão que atualize outra revisão.

## Publicação obrigatória de cada release

Commit de desenvolvimento não é release instalável. O canal anuncia releases
com imagens publicadas e verificadas, não qualquer push para main ou branch.

1. Concluir revisão/CI; publicar backend/frontend do SHA exato, verificar OCI
   revision, `/version.json` e pull anônimo por digest.
2. Preparar e assinar externamente o manifesto revisado, como no fluxo atual.
3. Gerar o anúncio global com o mesmo signatário, **sem copiar a chave privada**:

   ```sh
   node scripts/prepare-public-release.js MANIFEST.json MANIFEST.sig /CAMINHO/EXTERNO/CHAVE.pem /ARQUIVO/NOVO/stable.json
   ```

4. Revisar o payload, atualizar `releases/stable.json` e publicar em main por PR.
   O arquivo único evita leitura de manifesto e assinatura de gerações diferentes.
   A preparação recusa sobrescrever saída existente. Não versionar a chave privada.
5. Confirmar download anônimo do canal e a assinatura com a chave embarcada.
   A publicação só está completa quando **imagens + canal** estão disponíveis.
6. Preparar as condições de implantação em cada ambiente antes do clique do seu
   administrador. Esta mudança não autoriza modificar instalações de terceiros.

A assinatura de descoberta vale por 90 dias para limitar replay/freeze de
metadados. Se não houver release nova nesse prazo, renovar o anúncio da mesma
release (sem reconstruir imagens) e publicar o envelope. Monitorar a validade
é responsabilidade da publicação; erro de validade é visível no painel.
Uma revisão mais antiga não substitui uma mais nova já vista no processo.
A detecção de rollback não é persistente entre reinicializações; este canal é
informativo, não uma autoridade de execução. A aprovação protegida continua
sendo a barreira contra instalação/rollback não autorizados.

## Adoção em instalações existentes

Instalações antigas só conhecem o catálogo local. Precisam receber **uma vez**
uma release contendo este leitor e o novo painel, pelo seu procedimento seguro
de atualização. Depois, consultam o canal público por padrão, independentemente
do domínio. Novas instalações a partir deste código já incluem a descoberta.
Não é possível mudar retroativamente código executando em máquinas de terceiros.

Não substituir a preparação do agente por `git pull` privilegiado, script remoto
ou remoção da restrição test do deployer. Automatizar a preparação/recuperação e
homologar deployment de produção são trabalhos distintos; não foram liberados
implicitamente pela descoberta pública.

## Evidência reproduzível

- `node backend/scripts/test-public-release.js`: assinatura/adulteração,
  escopo global, duas instalações, limites, expiração, cache, erro e histórico.
- `node backend/scripts/test-release-agent.js`: approval, consumo e replay.
- `node backend/scripts/test-release-no-db-reconcile.js`: PostgreSQL preservado.
- `npm --prefix frontend run test:system-update`: projeção e renderização.
- `npm --prefix frontend run test:system-update:browser`: fixture localhost,
  sem instalação real, claro/escuro/mobile/teclado e ausência de POST na descoberta.
