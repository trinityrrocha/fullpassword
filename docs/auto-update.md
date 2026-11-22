# Atualização automática pelo painel (WebUpdate)

Objetivo: qualquer instalação do FullPassword (open source, sem política por instalação) atualiza com **um clique** do Super Admin em
*Configurações → Atualização do Sistema*, sem acesso à VPS depois da ativação única.

## Como funciona

1. O mantenedor publica uma release: o workflow **Release candidate** constrói as imagens e as envia ao GHCR **por digest**; o mantenedor assina
   o canal **offline** (a chave privada nunca entra no GitHub) e commita `releases/stable.json`.
2. Em cada instalação, o agente de host (`scripts/auto-update-agent.js`, systemd timer, root) baixa `releases/stable.json`, verifica a
   assinatura com a chave pública gravada em `/etc/fullpassword/release-public.pem`, confere o esquema estrito, a validade (≤ 90 dias),
   o anti-rollback (`ancestors`) e que as imagens são `ghcr.io/trinityrrocha/fullpassword-*@sha256:…`.
3. Se a instalação descende da release anunciada, o agente publica `catalog.json` (somente leitura para o app). O painel mostra
   **Atualização disponível** com as notas.
4. No clique, o backend (sem Docker, sem root) grava só `{approvalId, revision, manifestHash, requestId}` na fila. O agente confere que é
   exatamente o que ele anunciou e então executa: `pull` por digest → para o backend → **backup `pg_dump` verificado** → migração de
   esquema (role de dono, só em contêiner efêmero) → sobe backend/frontend → confere revisão + digests → estabiliza ≥ 60 s e reconfere.
5. Qualquer falha **restaura as imagens anteriores** e publica o estado `failed` (o painel permite tentar de novo). Falha de backup
   **recusa** a atualização e religa o serviço.
6. Queda do agente no meio: na próxima execução ele reconcilia sozinho olhando o que realmente roda (concluído, ou restaurado). Só pede
   humano (`recovery_required`) se o rollback também falhar.

O backend continua sem autoridade: não escolhe imagem, caminho, comando nem URL.

## Ativar (uma vez por instalação)

```bash
cd /caminho/da/instalacao
sudo bash scripts/setup-auto-update.sh          # instala o agente, cria o role de banco restrito e adota a release estável
```

O `install.sh` chama isso por padrão em instalações novas. A ativação padrão executa `--adopt`: **não é só ligar um timer**, é a primeira atualização (pode migrar o banco): faz backup, migra para o modo
`verify` com role sem DDL, monta a fila e valida; se algo falhar, volta ao estado anterior.

- **Desligar / ligar**: `sudo bash scripts/setup-auto-update.sh --disable` / `--enable` (arquivo `/etc/fullpassword/auto-update.disabled`).
- Recusa se existir o agente antigo (`/etc/fullpassword/release-policy.json` ou `fullpassword-release-agent.timer`): os dois não coexistem.
- Os `docker-compose.yml` e `.env` usados pelo agente são **cópias de propriedade do root** em `/etc/fullpassword/auto-update/`.
  Depois de editar o `.env`, rode `setup-auto-update.sh` de novo para atualizar a cópia.

## Instalações com o agente antigo (policy + timer por instalação)

Instalações novas usam apenas `setup-auto-update.sh`; não execute
`bootstrap-release-agent.sh` nelas. O bootstrap legado é mantido para
recuperação de instalações ainda não migradas e recusa execução quando
encontra configuração ou timer do agente novo.

Antes de desativar o legado, confirme que o último pedido foi concluído e
que backend e frontend executam a revisão de transição. Se a atualização
ainda estiver disponível no painel, use o legado para concluí-la primeiro:
parar o timer antes disso impede o consumo do pedido existente.

`setup-auto-update.sh` **recusa** se existir `/etc/fullpassword/release-policy.json` ou o timer `fullpassword-release-agent.timer`:
os dois agentes nunca rodam juntos. A transição exige um inventário somente leitura antes (qual compose e quais credenciais de runtime
o agente antigo usa, versão instalada, histórico em `/var/lib/fullpassword-release-*`) e um procedimento explícito que **preserve** a
policy e o estado antigos (arquivados, não apagados). Não há transição automática nesta versão.

## Backups

`/var/backups/fullpassword/fullpassword-pre-update-<UTC>.dump` (formato custom do `pg_dump`, modo 0600), os **3 mais recentes**.
O agente confere que o arquivo é **legível** (`pg_restore --list` lista as tabelas); isso **não** comprova uma restauração completa, que nunca é feita
automaticamente (restaurar o banco diante de qualquer falha poderia sobrescrever dados sem necessidade): é decisão humana.
É **local**: não protege contra perda do disco. Restaurar: `docker compose exec -T db pg_restore -U <owner> -d <db> --clean --if-exists < arquivo.dump`.
O rollback automático reverte **imagens**, não o banco; as migrações são aditivas, e o backup cobre o pior caso.

## Publicar uma release (mantenedor)

1. `main` verde → Actions → **Release candidate** → *Run workflow*. Informe o SHA completo revisado em `expected_revision`. Baixe `release-candidate.json` somente após build, pull anônimo e revisão interna de ambas as imagens passarem.
2. Offline: `node scripts/release-candidate.js sign release-candidate.json /caminho/FORA/do/checkout/release-private.pem`
3. PR com `releases/stable.json`. Só então as instalações enxergam a versão.

### Checklist para Claude Code e outros agentes

- Abra PR para as alterações e aguarde a CI. Se houver migrações, documente o caminho de upgrade e prove em PostgreSQL isolado a preservação dos dados, a restauração e a compatibilidade com rollback de imagens.
- Depois do merge, não confunda push, tag ou imagens publicadas com anúncio concluído. Gere o candidato do SHA revisado, entregue o artefato e as notas ao mantenedor para assinatura offline e abra o PR do canal com o envelope assinado. Nunca copie a chave privada para o checkout, GitHub Actions ou VPS.
- Depois do merge do anúncio, confirme acesso anônimo, assinatura e revisão no canal público. Registre SHA, digests, links da CI/PR e o resultado da descoberta no WebUpdate. Não anuncie deploy concluído antes de verificar o runtime instalado.
- Não faça SSH nem crie aprovações locais a cada release em instalações já migradas. Para provar a adoção, publique uma segunda release e verifique descoberta e instalação pelo painel sem alteração no host.

## Limites conhecidos

- Instalações em versões anteriores ao leitor do canal público precisam de **uma** atualização manual até receberem o agente.
- Mudanças em `docker-compose.yml`/nginx/chave pública entre releases **não** são aplicadas pelo agente (só as imagens); isso exige
  rodar `setup-auto-update.sh` de novo ou uma nota explícita na release.
- Troca da chave pública de assinatura exige ação do operador (a chave é fixada em `/etc/fullpassword/release-public.pem`).
- O ensaio Docker (`backend/scripts/test-auto-update-docker.js`, job *images* da CI) prova o fluxo com PostgreSQL e nginx reais.
