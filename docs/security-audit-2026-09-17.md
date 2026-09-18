# Auditoria de segurança — entrega parcial, não liberada para implantação

Base auditada e desta branch: `d9a7a3786143379df43ff1910263894df33449bf`.
Branch: `security/audit-remediation-2026-09-17`.

**O escopo FP-01 a FP-13 NÃO está concluído. Não implantar esta branch como se
fosse a correção integral. Os P0 criptográficos ainda exigem integração.**
Nenhum acesso autenticado, alteração de dados ou deploy foi feito na instalação.
A senha fornecida não foi copiada para ferramentas, arquivos ou evidências.

## Evidências e ambiente

- Prompt e PDF de 22 páginas lidos; pacote FullPassword_Evidencias_2026-09-17.zip
  não encontrado entre os anexos disponíveis. Solicitado ao proprietário.
- Consulta pública de saúde: status ok, schema navigation-preferences-v1,
  commit unknown. Isso não identifica a revisão ou o host efetivamente instalado.
- A confirmação de que a URL é exclusiva de homologação e o mecanismo de
  implantação/recuperação continuam pendentes. Não executar WebUpdater:
  atualmente ele instala main, não esta branch.
- Windows, Node 24.19.0, PostgreSQL nativo 15.18 temporário via embedded-postgres.
  Usuários/cofres AUDIT_TEST e segredos aleatórios ou declaradamente sintéticos.
  Cluster local em loopback e diretório aleatório apagados ao concluir o teste.
- Sem Docker/WSL no host. Workflow preparado para construir imagens finais;
  não confundir sua existência com execução ou implantação.
- Skill computer-use proíbe automação de gerenciadores de senhas/autenticação.
  Navegador exige intervenção manual compatível. Nenhum fluxo visual foi validado.

## Matriz por achado

Todos os itens abaixo: **não implantados / não validados na instalação**.

| ID / causa | Alteração e arquivos principais | Evidência local e pendências |
|---|---|---|
| FP-01: segredo de autenticação também abre identidade | Primitivas inativas em frontend/src/services/vaultCryptoV2.js: segredo independente, Master Key/RSA gerados no cliente, envelopes com contexto autenticado | test-vault-crypto-v2.js recusa senha de login sintética; integração cadastro/convites/login/perfil/recuperação NÃO realizada. Caminho legado continua vulnerável. |
| FP-02: chave pessoal distribuída como chave de cofre | Primitivas de DEK aleatória por cofre/época, RSA-OAEP com label por destinatário e fingerprint, AES-GCM com AAD; migration 21 apenas staging aditivo | Testes isolam cofres e chave pessoal, adulteração e rotação futura; NÃO integrado ao diretório de chaves, ACL, UI, histórico e backups. Fingerprint autoconsistente não substitui autenticação do diretório. |
| FP-03: substituição de categoria opaca | vaultController.js exige add/edit/delete para escrita agregada como contenção; formato de registro individual preparado nas primitivas | Inclusão isolada e leitura recusadas em teste; perda temporária de capacidade para perfis restritos é intencional. API granular com IDs/CAS e adaptação das abas NÃO implementadas. Não é solução definitiva. |
| FP-04: permissões de grupo ignoradas/snapshot de membros | accessControlService.js resolve interseção grupo/concessão, união entre concessões completas, membros atuais do banco; listagem usa mesmo resolvedor | PostgreSQL real: delete legado não supera grupo, restrição por cofre, concessão independente e remoção de membro. Proprietário/Super Admin preservados. Matriz completa HTTP por todos os endpoints ainda necessária. |
| FP-05: rota admin contorna confirmação de e-mail próprio | userController.js recusa autoalteração de e-mail administrativo e direciona ao perfil existente | Teste HTTP autenticado/CSRF válido de Super Admin sintético; e-mail não muda. Reautenticação central com finalidade, confirmação do novo e-mail e notificação antiga NÃO implementadas. |
| FP-06: BEGIN/consultas em conexões diferentes e DDL por request | clientController, clientKeyController, vaultController reservam conexão; auxiliares userController recebem client; DDL de compartilhamento movido para startup securitySchema | PostgreSQL real com pelo menos duas conexões, falha após DELETE e commit concorrente: rollback isolado. Consistência atômica futura ACL/envelopes/época e todos os cenários de corrida ainda pendentes. |
| FP-07: runtime fora de suporte | Dockerfiles backend/frontend usam Node 24.21.0-alpine por digest; final nginx também fixado por digest | Suítes no Node 24.19.0 Windows; imagens Alpine, OAuth e updater não executados localmente. Workflow de imagens inclui Argon2 nativo e versão; verificar execução antes do aceite. |
| FP-08: desafio/TOTP reutilizáveis | mfaChallengeService.js, mfaController, mfaService, authController; migration 20 e schema guard; hash de jti, row locks, consumo, passo TOTP, limites persistentes | HTTP concorrente login/setup, reuso, expiração e tentativas em PostgreSQL real. Setup e códigos de recuperação na mesma transação. Outros usos sensíveis de TOTP ainda precisam unificação com FP-05. |
| FP-09: KDF insuficiente | Novo formato inativo usa PBKDF2-SHA256 600000; leitores legados não alterados | Cenário criptográfico sintético medido; KDF dos fluxos ativos e scrypt dos backups continuam antigos. Reenvelopamento integrado e benchmark de backups NÃO realizados. |
| FP-10: Nodemailer e árvore não reproduzível | Nodemailer 10.0.10, express/multer/router/postcss corrigidos, overrides pontuais, package-lock nos dois projetos, Docker npm ci | npm ci e npm audit sem avisos nos dois projetos. Sem audit fix --force. Testes SMTP locais e regressões; entrega real a caixa dedicada e imagem final ainda pendentes. |
| FP-11: main mutável/socket privilegiado | Workflow CI com actions por SHA e configuração proposta de proteção em docs/security-main-protection.json | GitHub consultado: main protected=false, rulesets=[]. Nenhuma proteção aplicada. Updater ainda depende de main/socket; releases aprovadas, isolamento e rollback operacional NÃO implementados. |
| FP-12: transporte opcional | emailService/smtpSettingsService exigem TLS/STARTTLS; ftpStorageProvider/cloudBackupSettingsService exigem FTPS; UI remove opção insegura | Servidores locais: downgrade SMTP/FTP recusado antes de credenciais, certificado SMTP inválido recusado. Certificado FTPS inválido e entrega SMTP bem-sucedida em capturador TLS ainda precisam teste próprio. Configurações antigas sem TLS passam a falhar com erro. |
| FP-13: multipart antes de Super Admin | requireSuperAdmin antes de parser; restoreUploadGuard com lock PostgreSQL entre instâncias, prazo, espaço/ocupação temporária e limpeza | HTTP com sessão/CSRF válidos: 403 correto, contador do multipart zero, nenhum arquivo. Lock em outra conexão produz 429 antes do parser. Abortos, crashes e limite de espaço sob todas as plataformas ainda pendentes. |

## Testes reproduzíveis

Resultado final local: 17 scripts backend e 16 frontend aprovados; integração
PostgreSQL/HTTP, TLS e primitivas v2 aprovadas; build, ESLint dos fontes frontend
alterados, sintaxe JavaScript e diff-check aprovados. Build avisa chunk maior que
500 kB. Registro sanitizado: security-audit-local-results.json.

Executar em ambiente isolado, sem variáveis de produção:

```sh
export TZ=America/Sao_Paulo
cd backend
npm ci
npm test
node scripts/test-audit-postgres.js
node scripts/test-audit-tls.js
npm audit
cd ../frontend
npm ci
npm test
node scripts/test-vault-crypto-v2.js
npm run build
npm audit
cd ..
git diff --check
```

O teste PostgreSQL usa binário real, não PGlite, para concorrência e rollback.
A suíte antiga também usa PGlite em testes específicos; isso não foi usado como
substituto da evidência de concorrência.

Falhas encontradas e tratadas nesta execução:
- Teste de exportabilidade esperava apenas InvalidAccessException; passou a
  aceitar também InvalidAccessError, mantendo assert.rejects e a não exportabilidade.
- Expectativas antigas de SMTP sem TLS e npm install foram atualizadas para a
  política nova; a validação de host FTP continua testada com secure=true.
- Build npm ci revelou import ServerPlus inexistente; NAS usa ServerCog e seu
  teste acompanha. Nenhuma regra de dispositivo foi alterada.
- pnpm tentou reinstalar dependências/scripts automaticamente; validação final
  foi feita por npm ci e npm test, via runtime npm disponibilizado por pnpm dlx.
  Os arquivos pnpm-workspace gerados automaticamente foram removidos.

## Migração: estado real e critérios antes de ativar

Migration 20 é aditiva e executada pelo schema guard: desafios antigos sem jti
deixarão de autenticar e exigirão novo login; não remove identidades ou cofres.
Não rotaciona JWT_SECRET nem CONFIG_ENCRYPTION_KEY.

Migration 21 cria apenas tabelas de staging. Não é acionada pelo startup e não
altera a versão ativa. Foi preparada para receber ciphertext, envelopes e
contagens; não constitui um migrador completo. Primitivas frontend não são
importadas pelos fluxos ativos.

Antes de ativar FP-01/02/03:
1. Implementar APIs por registro e CAS, validação de destinatários autorizados e
   identidade das chaves públicas, ativação atômica da época e envelopes.
2. Implementar segredo independente nos fluxos de criação, convite, desbloqueio,
   troca e recuperação; senha inicial administrativa não pode abrir cofre novo.
3. Inventariar somente metadados/contagens dos formatos existentes.
4. Após desbloqueio do titular, gerar identidade pessoal nova e DEK por cofre;
   recriptografar registros e histórico com contexto autenticado. Não enviar
   chave, segredo ou conteúdo em claro ao servidor.
5. Persistir candidatos em staging, reler e autenticar cada registro no cliente,
   verificar contagens e origem imutável, e só então ativar atomicamente.
6. Preservar originais cifrados e material de recuperação protegido até validar
   retomada, interrupção, backup e restauração em outra instalação.
7. Usuários ausentes permanecem explicitamente pendentes; não alegar isolamento
   completo enquanto forem usados caminhos legados.
8. Revogação não apaga dados/chaves já copiados. Se a Master Key antiga foi
   compartilhada, ela deve ser considerada conhecida e substituída, inclusive RSA.

A aplicação atual ainda entrega JavaScript pelo servidor: um servidor
comprometido pode enviar cliente malicioso. Separação de segredos não elimina
esse limite de confiança. Esquecer o segredo independente sem chave de
recuperação prevista deve significar impossibilidade de abrir os dados antigos,
não reset destrutivo silencioso.

## Implantação e recuperação — bloqueadas

Não atualizar pw.sti1.com.br até:
- proprietário confirmar ambiente exclusivo de teste, host e mecanismo;
- identificar SHA/digest instalado (health retorna unknown);
- concluir P0 e revisão desta branch;
- backup cifrado do banco e arquivos, preservação independente dos segredos
  operacionais e teste real de restauração em cópia isolada;
- imagem/release exata aprovada por SHA/digest e caminho de implantação que não
  substitua esta branch por main;
- plano de falha que pare gravadores e restaure banco/volumes/chaves compatíveis.
  Downgrade do código sozinho não desfaz migração criptográfica.

O JSON de proteção é proposta aplicável por administrador, não proteção ativa.
O CI constrói sem publicar/deployar imagens. Runtime sem root, papéis PostgreSQL
separados, limitação do socket e artefatos assinados permanecem pendentes.

## Recomendações complementares

Aplicados: backend/.dockerignore, exclusão de .git/.env/backups/certificados do
contexto, Cache-Control no-store em /api, lockfiles, testes/CI versionados.
Configurações nginx existentes já têm proxy_request_buffering off nas rotas de
restore, incluindo templates install/update; não verificado no proxy implantado.
Sem mudança em segredos reais, banco remoto, main, VPS ou configurações do host.
