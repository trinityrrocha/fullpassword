# Estudo: compartilhar um cofre direto com usuários (além de grupos)

Estado: **fase 1 e 2 implementadas** (usuário + grupo no mesmo cofre, seletor com busca); a fase 3 (lote) segue como estudo. Ver "Implementado" no fim. Motivação: hoje, para dar acesso por empresa a pessoas diferentes, é preciso um grupo por
empresa (100 empresas = 100 grupos). Meta: compartilhar um cofre com **usuários e grupos selecionados**, sem enfraquecer a segurança atual.

## Como funciona hoje (resumo verificado no código)

Duas camadas independentes, que um novo tipo de concessão precisa atender **ao mesmo tempo**:

1. **ACL no servidor** (`backend/src/services/accessControlService.js`, `getClientPermissions`): quem pode ler o texto cifrado e gravar
   registros. Para usuários comuns é a interseção `groups.can_* × client_group_access.can_*`, somada (OU) entre os grupos do usuário;
   o dono (`clients.created_by`) e o Super Admin têm acesso total.
2. **Criptografia** (`vault_crypto_envelopes`): a DEK de cada cofre/época é gerada **só no navegador do dono** e embrulhada com a chave
   pública RSA de cada destinatário. O servidor apenas valida o formato. Quem não tem envelope não decifra, mesmo passando na ACL.

Fatos que moldam o desenho:

- Conceder ou revogar é sempre uma **rotação completa** feita pelo **dono** (nova DEK, época+1, todos os registros recifrados,
  ativação atômica em `activateEpoch`). Não existe "adicionar um destinatário" incremental.
- Não existe estado "pendente" persistido: usuário novo num grupo passa na ACL mas fica sem envelope até o dono "Ressincronizar chaves".
- Usuário sem identidade criptográfica (`users.crypto_identity`) **bloqueia a operação inteira** (409 `RECIPIENT_IDENTITY_MIGRATION_REQUIRED`).
  Todo usuário novo nasce sem identidade.
- Revogação: triggers removem os envelopes de quem perdeu **todos** os caminhos e marcam `rotation_required`; a escrita fica bloqueada
  até o dono rotacionar. Quem já copiou chave/texto continua com o que copiou (documentado na auditoria de segurança).
- O compartilhamento direto **por item** (`vault_shares`) existe só como legado, nunca entrega a DEK do cofre, e a criação nova está
  bloqueada (`VAULT_V2_REQUIRED`). A homologação registrou que converter acesso a um item em chave do cofre inteiro **não é seguro**:
  por isso a proposta abaixo é de **cofre inteiro**, não de item.
- O seletor de compartilhamento só conhece grupos (`VaultSharingManager.jsx`, `GET /groups/options`); `GET /users` é só de admin.

## Proposta

Nova concessão **usuário → cofre**, paralela à de grupo, com a **mesma criptografia**.

### Modelo de dados
`client_user_access(client_id, user_id, can_view, can_edit, can_add, can_delete, granted_by, created_at, updated_at)`,
PK `(client_id, user_id)`, `ON DELETE CASCADE` para cofre e usuário. Entra em `init.sql`, migração, `ensureSecuritySchema`,
`verifyRuntimeSchema`, `backupTables` (tabela opcional, para backups antigos) e nas listas de prontidão.

### Autorização
- `getClientPermissions`: permissão efetiva = **OU** entre (grupos: interseção atual) e (concessão do usuário: as permissões gravadas).
  Nova `source: 'user'`. A concessão direta **não** passa pela interseção com o grupo (ela já é por usuário).
- `getClients` (filtro do `EXISTS`), `getClientShares` (listagem) e qualquer SQL próprio precisam enxergar a nova tabela.
- Quem pode compartilhar: **continua só o dono** (`manage_share`), como hoje; o Super Admin não-dono não consegue rotacionar
  (não é destinatário nem dono). Isso já é uma limitação existente e precisa de decisão (ver "Decisões").

### Criptografia (o ponto sensível)
- `recipients()` passa a ser a união: dono ∪ membros dos grupos com `can_view` ∪ usuários com concessão `can_view`, todos **ativos e com
  identidade**. O formato de `shares` ganha o tipo (`{type:'group'|'user', id, can_*}`); `recipients_hash`/manifesto passam a cobrir os dois.
- `activateEpoch` reescreve `client_group_access` **e** `client_user_access` na mesma transação, junto com os envelopes (hoje faz isso só
  para grupos). Mesmo `pg_advisory_xact_lock(8142027)`.
- `vault_recipient_allowed(vault, user)` ganha o ramo "concessão direta" e um trigger na nova tabela com o mesmo comportamento
  (remove envelope de quem perdeu todos os caminhos + `rotation_required` + `crypto_revision+1`).
- Nenhuma mudança nos parâmetros (DEK por época, RSA-OAEP 3072, AES-GCM com AAD). O servidor continua sem ver a DEK.

### Interface
- `VaultSharingManager.jsx`: segundo seletor **Usuários** ao lado de **Grupos**, com busca (são centenas), permissões por usuário
  (ver / editar / adicionar / excluir) e aviso por linha quando o usuário **ainda não criou a identidade** (não selecionável).
- Novo endpoint de diretório para donos de cofre (não-admin): só `id`, `name`, indicador de identidade/impressão digital. Nunca e-mail
  completo nem chave privada. (A revisão R-03 já recomenda exatamente esse formato mínimo.)
- Ação em lote (fase 3): aplicar o mesmo usuário/grupo a **vários cofres** de uma vez. É o que realmente resolve "100 empresas": hoje
  cada cofre é um compartilhamento separado. Como a rotação é no navegador do dono, o lote roda cofre a cofre, com progresso e retomada.

### Auditoria
Novos eventos `vault_user_share_granted` / `vault_user_share_revoked` (quem, cofre, alvo; sem chaves). O R-07 já aponta que mudanças de
membership hoje não são auditadas: aproveitar para auditar as duas.

## Segurança: o que se mantém e o que muda

Mantido: ACL no servidor + envelopes criados só pelo dono no navegador; revogação por rotação; identidade independente do login;
trigger de invalidação; lock global; backup/restauração; sem plaintext no servidor.

Riscos novos / a testar:
1. **Dois caminhos de acesso** ao mesmo cofre (grupo e usuário): a revogação só vale quando **todos** os caminhos caem (já é a regra).
2. **Concessão sem envelope** (ACL passa, chave pendente): é o estado atual dos grupos; recomendo marcar `rotation_required` quando uma
   concessão for gravada sem rotação, para o dono ser avisado em vez de descobrir pelo usuário.
3. **Usuário sem identidade bloqueando o compartilhamento inteiro**: com seleção individual isso vira ruído; o seletor deve **recusar antes**
   (e a API manter o 409).
4. **Diretório de usuários** para não-admins amplia a enumeração de contas: expor o mínimo e só para donos de cofre.
5. **Super Admin sem envelope**: continua sem poder abrir cofres que não são dele (isso é uma propriedade de segurança, não um defeito).

## Testes necessários (nenhum cobre hoje concessão por usuário)
PostgreSQL real, no padrão de `test-vault-integrated-postgres.js`: concessão só por usuário; usuário+grupo juntos; revogar um caminho
mantém o outro; revogar o último remove envelope e bloqueia escrita até rotação; permissões por usuário (só adicionar, só ver);
identidade ausente; usuário inativo/excluído; backup/restore com a tabela nova; backend anterior em modo `verify` com a tabela presente
(o rollback automático de imagens depende disso); seletor e diretório (frontend).

## Plano em fases
1. **Backend + esquema + trigger + testes** (a parte de risco). Sem UI nova: ativável por API para teste.
2. **Interface**: seletor de usuários, aviso de identidade, diretório mínimo.
3. **Lote**: aplicar usuários/grupos a vários cofres, com progresso e retomada.

Estimativa de esforço: fase 1 é a maior (resolver, trigger, `activateEpoch`, `recipients`, formato de `shares`); as fases 2 e 3 são
de interface.

## Decisões que preciso de você
1. As permissões de uma concessão por usuário são **por usuário** (ver/editar/adicionar/excluir escolhidos) ou fixas (só leitura/leitura+escrita)?
2. **Quem pode compartilhar** continua sendo só o **dono** do cofre? (O Super Admin não-dono hoje não consegue rotacionar nem decifrar.)
3. Quer um "break-glass" de recuperação (Super Admin sempre destinatário)? **Não recomendo**: muda o modelo de confiança.
4. Prioridade: começo pela **fase 1 (usuário no cofre)** ou pela **fase 3 (lote)**? Para "100 empresas" o lote entrega mais valor
   imediato com o modelo atual (um grupo por equipe aplicado a muitos cofres), mas continua exigindo grupos.

## Implementado (branch work/fase5)

- Tabela `client_user_access` (migration 32), escrita **somente** pela ativação da rotação do dono (`activateEpoch`), na mesma transação
  dos envelopes. `vault_recipient_allowed` e o gatilho de revogação passaram a considerar a concessão direta.
- Permissão efetiva = **OU** entre o caminho por grupo (interseção atual) e a concessão do usuário (`source`: `group`, `user`, `group+user`).
- `recipients` = dono + membros dos grupos + usuários escolhidos (ativos e com identidade). Usuário indisponível ou sem identidade é
  recusado (409), nunca descartado em silêncio. Se `userShares` não vier no corpo, as concessões diretas permanecem como estão.
- Decisões adotadas (as do estudo): permissões **por usuário** (ver/editar/adicionar/excluir); **só o dono** rotaciona; **sem** break-glass.
- Diretório mínimo para o dono: `GET /crypto/vaults/:id/user-directory?q=` (2+ caracteres, 20 resultados, e-mail mascarado, sem chaves) e
  `GET /crypto/vaults/:id/user-shares`. Auditoria: `vault_user_share_granted` / `vault_user_share_revoked`.
- Backup: `client_user_access` é tabela opcional (backups antigos continuam restaurando).
- Risco conhecido: o `vault_recipient_allowed` é recriado a cada partida; um backend **anterior** a esta versão, ao subir em modo de
  migração, voltaria a definição antiga (sem a concessão direta) e as revogações por gatilho ignorariam usuários diretos. O rollback
  automático de imagens só usa o modo de verificação, que não recria a função.
