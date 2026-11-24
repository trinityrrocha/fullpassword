# Atualização automática pelo painel (WebUpdate)

Objetivo: qualquer instalação do FullPassword (open source, sem política por instalação) atualiza com **um clique** do Super Admin em
*Configurações → Atualização do Sistema*, sem acesso à VPS depois da ativação única.

## Como funciona

1. Após o merge, a CI de push da main protegida executa regression, images e o builder pelo SHA integrado. O builder testa o pull anônimo e a revisão interna antes de registrar os dois digests como passos públicos da execução.
2. Backend e agente consultam a API HTTPS do GitHub (repositório e ID do workflow fixos). Somente o push aprovado da própria main, no SHA atual e na tentativa exata, é elegível. PR, fork, tag, execução manual, CI incompleta, imagens mutáveis e histórico divergente não autorizam instalação.
3. O SHA instalado precisa ser ancestral do novo. O catálogo local é vinculado ao SHA e aos dois digests. A consulta tem cache de 15 minutos; indisponibilidade do GitHub não autoriza deploy. Sem agente o backend novo ainda pode anunciar a versão, mas não pode instalar.
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
sudo bash scripts/setup-auto-update.sh          # ativa a descoberta; não solicita deploy
```

O instalador prepara os mounts da fila e do catálogo antes de iniciar o backend. Não atualiza a aplicação sem o clique. Uma instalação já adotada com mounts pode receber uma atualização única do agente via setup da versão revisada. Se a instalação antiga não tem os mounts, prepare-os no Compose antes da transição. Aplicar imagens não substitui o executável de host.

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

## Publicar uma atualização

Abra o PR, valide migrações e rollback, faça merge na main protegida e aguarde **Security regression** no SHA de push, inclusive **release-candidate / candidate**. Não é necessário assinar arquivo, abrir segundo PR ou acessar instalações já migradas. Não trate build manual ou CI de PR como anúncio. Se falhar, corrija a CI; não desative os gates. A proteção de escrita/revisão da main, do workflow e das permissões GitHub é parte da autoridade de release.

Instalações ainda no protocolo assinado não descobrem este protocolo sozinhas. Usam o canal antigo até a transição única do agente pelo operador; uma release de transição para clientes exclusivamente assinados segue o fluxo offline anterior. Nunca troque a chave pública nesses clientes para forçar a adoção.

## Limites conhecidos

- Instalações em versões anteriores ao leitor do canal público precisam de **uma** atualização manual até receberem o agente.
- Mudanças em `docker-compose.yml`/nginx/chave pública entre releases **não** são aplicadas pelo agente (só as imagens); isso exige
  rodar `setup-auto-update.sh` de novo ou uma nota explícita na release.
- Troca da chave pública de assinatura exige ação do operador (a chave é fixada em `/etc/fullpassword/release-public.pem`).
- O ensaio Docker (`backend/scripts/test-auto-update-docker.js`, job *images* da CI) prova o fluxo com PostgreSQL e nginx reais.
