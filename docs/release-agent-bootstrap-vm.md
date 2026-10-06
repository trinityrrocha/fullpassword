# Bootstrap do agente — VM Docker Compose existente

Autorização de teste já confirmada; não há Coolify. Nenhuma instrução abaixo foi
executada na VM por esta execução. Não usar o botão antigo que atualiza main.
Não presumir caminho do app, Compose, nome de projeto ou versão em execução.

## 1. Inventário privado, sem valores de ambiente

No checkout revisado fornecido pelo responsável:

```sh
node scripts/inventory-deployment.js
docker version
docker compose version
systemctl list-unit-files '*fullpassword*' '*updater*'
```

O primeiro comando mostra somente labels Compose, serviços, mounts, portas,
IDs/digests e versões Docker/Compose. Não mostra Config.Env. Identificar:
APP_DIR, PROJECT, COMPOSE_FILE(s), ENV_FILE já existente, DB_SERVICE,
BACKEND_SERVICE, FRONTEND_SERVICE, proxy/túnel, volumes e mecanismo antigo.
O relatório deve conter metadados sanitizados, não conteúdo de arquivos/env.

Conferir o SHA pelo health interno do backend e version.json do frontend:

```sh
docker compose --project-directory "$APP_DIR" -p "$PROJECT" -f "$COMPOSE_FILE" exec -T "$BACKEND_SERVICE" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(b=>console.log({commit:b.commit,schema_ready:b.schema_ready}))"
docker compose --project-directory "$APP_DIR" -p "$PROJECT" -f "$COMPOSE_FILE" exec -T "$FRONTEND_SERVICE" cat /usr/share/nginx/html/version.json
```

Com mais de um arquivo Compose, repetir -f na ordem encontrada; manter --env-file
do projeto quando usado. Se o serviço antigo não publica SHA, comparar hashes
dos arquivos executados com o objeto Git d9a7a3786143379df43ff1910263894df33449bf
e registrar imagem/config ID. HEAD do checkout sozinho não prova o container.
Não dizer que d9a7a37 foi confirmado se esses dados divergirem/forem unknown.

## 2. Recuperação consistente e exclusividade

Fechar entrada de escrita e parar apenas backend/agendadores/updater deste
projeto, pelos nomes confirmados. Nunca parar outro projeto por substring.
Se for container legado: compose stop NOME_CONFIRMADO; se systemd: systemctl stop
UNIDADE_CONFIRMADA e desabilitar seu timer. Registrar que não haverá updater
antigo concorrente. Não executar down -v.

Capturar banco com pg_dump como dono do schema; arquivos/volumes de anexos e
backup; Compose/proxy/túnel/certificados; configuração e segredos operacionais.
Usar ferramenta de backup cifrado com senha/chave por canal interativo. Exemplo
de pg_dump (o ambiente autenticado do container não aparece no comando):

```sh
umask 077
docker compose --project-directory "$APP_DIR" -p "$PROJECT" -f "$COMPOSE_FILE" exec -T "$DB_SERVICE" pg_dump -U "$DB_OWNER" --clean --if-exists "$DB_NAME" > "$RECOVERY_DIR/database.sql"
```

Não imprimir/copiar JWT_SECRET, CONFIG_ENCRYPTION_KEY, senha do banco, SMTP,
tokens cloud, backup passphrase ou chave de assinatura nos relatórios.
Preservar a configuração existente; não gerar novas chaves como fallback.
Compactar/cifrar a recuperação por ferramenta já provisionada pelo responsável.
Restaurar banco, volumes e configuração em OUTRO projeto/volumes e entrada
isolada; testar login, MFA, abertura de cofres e anexos antes de atestar restoreVerified.
Voltar só as imagens não é recuperação após migração de dados.

## 3. Preparar autoridade fora da aplicação

Construir/publicar backend e frontend dos SHAs exatos revisados; registrar
digests de registry, não IDs de configuração de imagens. Assinar os bytes exatos
do manifesto fora da aplicação com chave privada custodiada pelo operador.
Manifesto:

```json
{
  "repository": "trinityrrocha/fullpassword",
  "revision": "SHA_COMPLETO_REVISADO",
  "origin": "https://pw.sti1.com.br",
  "backend": "ghcr.io/trinityrrocha/fullpassword-backend@sha256:DIGEST_REAL",
  "frontend": "ghcr.io/trinityrrocha/fullpassword-frontend@sha256:DIGEST_REAL"
}
```

Placeholders acima não são uma release. Não foram inventados digests ou assinatura.
Chave pública, manifesto/assinatura, política, Compose resolvido e recuperação
devem estar em caminhos absolutos root-owned, sem escrita grupo/outros e sem
symlink em qualquer ancestral. A chave privada nunca entra no host/app/registry.

Provisionar papel runtime DML conforme database/provision-runtime-role.sql,
verificar se já existe antes de criar e definir senha por psql \password.
Configurar backend com DB_SCHEMA_MODE=verify e esse papel. Configurar serviço
schema-migrate separado com credenciais do dono; somente o operador tem essa
configuração. Comando do serviço: node scripts/migrate-schema.js. Ele usa a
imagem backend aprovada; o agente não aceita comandos da fila.

Adicionar o overlay docker-compose.release-agent.yml preservando todo o resto.
O Compose protegido deve incluir:
- backend com mounts public read-only e queue read-write;
- schema-migrate com profile operator, mesmo network/DB, sem socket;
- db/proxy/volumes/portas/domínio HTTPS existentes sem substituição.

Após preencher variáveis somente com caminhos já identificados:

```sh
install -d -o root -g root -m 0755 /etc/fullpassword
umask 077
docker compose --project-directory "$APP_DIR" -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$AGENT_OVERLAY" config --format json > /etc/fullpassword/compose.json
chmod 600 /etc/fullpassword/compose.json
```

Isso contém configuração operacional: fica somente root, não vai para Git/evidência.
Nunca executar config imprimindo seus segredos no relatório.

Política root /etc/fullpassword/release-policy.json:

```json
{
  "environment": "test",
  "origin": "https://pw.sti1.com.br",
  "approvedRevision": "SHA_COMPLETO_REVISADO",
  "approvalId": "UUID_NOVO_DA_APROVACAO",
  "expiresAt": "VALIDADE_UTC_ATE_7_DIAS",
  "publicKeyFile": "CAMINHO_ABSOLUTO_DA_CHAVE_PUBLICA",
  "manifestFile": "CAMINHO_ABSOLUTO_DO_MANIFESTO",
  "signatureFile": "CAMINHO_ABSOLUTO_DA_ASSINATURA",
  "composeFile": "/etc/fullpassword/compose.json",
  "recoveryArchive": "CAMINHO_ABSOLUTO_DA_RECUPERACAO_CIFRADA",
  "recoverySha256": "CHECKSUM_REAL",
  "restoreVerified": true,
  "migrateSchema": true,
  "queueDirectory": "/var/lib/fullpassword-release-queue",
  "publicDirectory": "/var/lib/fullpassword-release-public",
  "stateDirectory": "/var/lib/fullpassword-release-agent"
}
```

restoreVerified=true apenas DEPOIS do restore isolado comprovado. Expiração e
UUID são emitidos pelo operador, nunca por campo da API. Não usar registry
loopback-test na VM: existe somente para o ensaio CI em audit.example.invalid.

## 4. Instalação inicial repetível

Node compatível já provisionado no host, root-owned. Usar cópia revisada da
branch em staging root protegido, não diretório gravável pela aplicação.
Obter o GID real da imagem backend pelo digest aprovado (id -g), não adivinhar.

```sh
sudo bash "$CHECKOUT_REVISADO/scripts/bootstrap-release-agent.sh" "$CHECKOUT_REVISADO" "$GID_BACKEND"
sudo node "$CHECKOUT_REVISADO/scripts/deploy-approved-release.js" "$MANIFEST_FILE" "$SIGNATURE_FILE"
sudo node /usr/local/lib/fullpassword-release/release-agent.js
sudo systemctl enable --now fullpassword-release-agent.timer
```

Primeira implantação é do operador, com assinatura, recuperação e policy; não
é atualização web comprovada. O bootstrap instala arquivos/dirs com modos
explícitos e deixa timer parado. Repeti-lo preserva fila, ledger, status e dados;
para o novo timer enquanto troca código. Não remove locks/consumed automaticamente.

O agente é root/Docker no host, fora do backend. Aplicação não recebe socket,
manifestos graváveis, política, chave privada, shell ou opção de branch/URL/image/path.

## 5. Homologação manual pelo painel entre DUAS revisões

Publicar segunda release, SHA/digests reais e manifesto assinado, nova aprovação
root e checksum/restore prévio. Registrar revisão do agente e dos dois serviços.
Em Settings/WebUpdater:
1. Conferir origin, SHA e digests da release aprovada.
2. Solicitar uma vez como Super Admin; reauth com senha de login e MFA fresco.
3. Conferir requested -> deploying -> stabilizing -> completed.
4. Falha/recovery_required/timeout: consultar estado, não repetir POST.
5. Confirmar full SHA frontend/backend, digests executados e schema_ready.
6. O agente espera 60s e revalida antes de completed. Registrar healthyAt,
   finishedAt e evidência da espera antes dos testes funcionais.
7. Contas sintéticas: login/unlock/CRUD, leitor/add-only/editor, grupo e item,
   revogação, staging interrompido/retomado, MFA, backup/restore em segunda instância.
8. Conferir grants/contagens/AAD pela API, não somente aparência da tela.

Sem automação de autenticação/password manager pela skill Windows. Não há teste
remoto atribuído ao PR enquanto esse roteiro não tiver evidências sanitizadas.

## 6. Falha/interrupção

Status persistente recovery_required e ledger consumido impedem novo deploy da
mesma aprovação. Parar timer, manter escritores pausados, coletar metadados,
preservar estado de falha cifrado e restaurar DB+volumes+config/segredos+imagens
compatíveis em procedimento controlado. Verificar antes de reabrir.
Somente após reconciliação o operador arquiva locks/estado de falha e emite
NOVA aprovação. Não apagar consumed ou grants para “tentar de novo”.

Entradas indispensáveis ainda ausentes: inventário sanitizado real; SHAs/digests
instalados; acesso operacional pelo responsável; custódia de signer/public key;
registry aprovado; checksum e restore isolado da recuperação. Não é uma nova
solicitação de autorização de ambiente — são dependências técnicas concretas.
