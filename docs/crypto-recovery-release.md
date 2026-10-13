# Contrato vigente — identidade, recuperação e release

Este documento descreve o código do PR #3, não atesta que o HEAD está implantado.
Documentos antigos marcados HISTÓRICO preservam fatos de suas datas. main, código
revisado, builder, imagem publicada, approval e revisão instalada são identidades
distintas. Testes locais/CI não substituem homologação operacional.

## Autenticação não é desbloqueio

- A senha de login é enviada via HTTPS para autenticação/hash Argon2id. A sessão
  usa cookie HttpOnly; CSRF e reauth recente controlam operações sensíveis.
- O segredo independente de desbloqueio (mínimo 16 caracteres, diferente da
  senha de login) permanece no navegador. A identidade v2 usa PBKDF2-SHA-256
  com 600.000 iterações, salt de 32 bytes, MK aleatória AES-256 e RSA-OAEP 3072.
- `vaultCryptoV2.js` é a fonte dos parâmetros ativos. `cryptoService.js` e
  `cryptoParameters.js` retêm parâmetros 100.000/310.000 para envelopes legados;
  não representam o KDF da identidade independente nem motivo para reescrevê-los.
- A MK pessoal protege a chave privada e arquivo legado. Cada cofre usa DEK por
  epoch, envelopada a destinatários autorizados; registros usam AES-GCM com AAD
  de cofre/registro/categoria/epoch/revisão. Compartilhamento direto de item não
  entrega a DEK do cofre. ACL é verificada no servidor.
- Chaves/conteúdo aberto ficam em memória; bloqueio/logout limpa o estado. Não
  persistir segredo, MK, private key ou plaintext de cofre em storage/logs.

## Reset e auditoria histórica

`completePasswordReset` muda hash_senha_login, incrementa token_version, revoga
sessões e consome os reset tokens. Não substitui crypto_identity, MK/RSA,
envelopes, cofres, histórico ou grants. MFA habilitado exige fator válido pelo
mecanismo persistente já existente. Nenhuma mudança do modelo crypto nesta etapa.

Eventos futuros: `password_reset_completed` e
`password_reset_crypto_identity_preserved`. Label: “Senha de login redefinida;
identidade criptográfica preservada”. O código antigo
`password_reset_crypto_identity_rotated` continua filtrável/visível como “Reset
de senha — registro histórico de identidade”. Não reescrever logs: esse código
foi usado em versões com semântica diferente e não prova sozinho uma rotação.

Reset de login não recupera um segredo de desbloqueio perdido. Recovery codes
validam MFA, não descriptografam cofres. Abertura após reset exige o segredo
independente existente. Backup V2 usa scrypt N=131072,r=8,p=1; leitores preservam
apenas os custos legados conhecidos. Recovery completa preserva banco, volumes,
identidades/envelopes e segredos operacionais cifrados, com custódia fora do host.

## Autoridade de release

- Backend não tem Docker socket nem poder de montar/manipular containers. A API
  aceita somente IDs/SHA/hash de uma release já aprovada pelo operador, com
  Super Admin, CSRF e reauth/MFA vinculada à ação/sessão.
- Manifesto assinado fixa repository/revision/origin/backend/frontend, com
  SHA completo e imagens por digest. A chave privada fica fora da aplicação,
  VM e imagens. A trust key não pode vir do pedido do navegador.
- Policy root-owned define ambiente test, origin, approvalId UUID, expiry UTC
  até 7 dias, paths protegidos e recovery/checksum restore-tested. O agente
  externo grava ledger one-shot antes dos efeitos, impedindo replay/crash retry.
- Catálogo/status são somente leitura para o backend; fila é separada e não é
  autoridade. Importar exports puros para validação não executa o agent main.
- Agente deploya somente backend/frontend com `--no-deps`, inclusive rollback.
  PostgreSQL não é reconciliado. `migrateSchema=false` para releases sem mudança
  de schema. Quando necessária, migration é explicitamente autorizada, separada
  e feita por schema operator; o runtime usa papel DML e `DB_SCHEMA_MODE=verify`.
- Runtime backend non-root/read-only/cap_drop/no-new-privileges, Node 24 por
  digest. Bootstrap host-side exige Node 24.19+ e GID backend comprovado.
- Health/SHA/digests são verificados antes/depois da estabilização de 60s.
  Rollback de imagem não reverte o banco; falhas podem exigir recovery explícita.
- Builders dedicadas publicam imagens reais por GITHUB_TOKEN. Assinatura e
  approval são externas ao CI; o workflow de regressão não emite autoridade.

## Estado operacional de referência (não atualizado nesta tarefa)

P0.5 preparou release de3bc952 e agente/policy corrigidos; aplicação instalada
continuava fef7756, PostgreSQL intacto e timer disabled/inactive. P0.6 está
suspensa durante o fechamento de implementação. Esta tarefa não acessa VM,
não emite nova approval, não publica release, não migra/deploya nem habilita timer.
Um novo HEAD do PR precisa de artefatos/approval próprios em etapa autorizada.

## Tooling e compatibilidade

Node 24 `--watch` substitui nodemon apenas em desenvolvimento. Não altera o CMD
de produção. Tailwind 4.3.3/Vite removem as cadeias sem patch braces/PostCSS;
tokens v3, dark/hover, defaults e seletores de spacing/dividers são preservados
por adaptadores documentados em DESIGN.md. Lockfiles canônicos são npm.
Sem audit fix --force, gates removidos ou advisory ignorado por ser devDependency.

Tailwind 4 exige navegadores modernos (Safari 16.4+, Chrome/Edge 111+, Firefox
128+); compatibilidade visual integral/mobile é parte da homologação agrupada,
não inferida somente do build. A migração de tooling não muda criptografia.

## Governança e próxima homologação

Manter PR #3 OPEN/DRAFT, sem merge/main/deploy automático. Rulesets/proteção de
branch são operação do mantenedor, não um arquivo JSON ou CI que prova aplicação.
Depois do SHA candidato definitivo, agrupar WebUpdate E2E, LOGIN/MFA/UNLOCK/VAULT/
DECRYPTION humanos, matriz completa de permissões, SMTP/cloud reais, recovery
operacional, proxy/rede, benchmark/carga e matriz mobile/claro/escuro. Cada prova
deve indicar SHA/ambiente/dados fictícios e distinguir implementação, local,
CI, implantação e validação na instalação.
