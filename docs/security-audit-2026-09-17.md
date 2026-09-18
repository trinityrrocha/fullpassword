# Auditoria de segurança — continuação integrada do PR #3

Branch: `security/audit-remediation-2026-09-17`. Base desta continuação:
`ec8e90c5d1113c94502c1bfa4ef95762a5d65bc4`. Data: 2026-09-18.

**Implementação integrada e validação local não equivalem a implantação.**
PR #3 permanece draft. Nenhum acesso autenticado, mudança de conta, cofre,
segredo ou implantação foi realizado em pw.sti1.com.br. A senha fornecida não
foi copiada para ferramentas, arquivos ou evidências.

## Evidência e plano executado

1. Branch, HEAD, estado limpo inicial e PR draft conferidos; trabalho anterior preservado.
2. Lidos prompt de continuação, README, resultados e cenários T01–T10 do ZIP.
   Os 21 hashes do MANIFEST conferiram. Lockfiles do ZIP NÃO foram restaurados.
3. Integradas identidade independente, API por registro, UI e migração; depois
   reautenticação, recuperação, transporte, privilégios e entrega por release.
4. Executadas suítes, HTTP com sessão/CSRF reais, PostgreSQL nativo descartável,
   capturadores TLS, build e ESLint. Publicação/CI registrados abaixo.
5. Implantação e navegador continuam etapas independentes, explicitamente não executadas.

Ambiente local: Windows, Node 24.19.0, PostgreSQL real 15.18 em loopback e bases
aleatórias descartáveis. Não é uma simulação PGlite da concorrência (PGlite
continua usado na suíte antiga de schema). Somente registros sintéticos.

## Matriz por achado

Todos: **não implantados / não validados na instalação**. Referências de commits
e CI são registradas em seção própria; caminhos são relativos ao repositório.

| ID | Alteração implementada / arquivos principais | Validação e evidência | Pendência |
|---|---|---|---|
| FP-01 | `userCryptoIdentityService.js`, AuthContext, UserCryptoIdentitySetup, auth/user/passwordReset controllers: segredo independente de desbloqueio, novo MK/RSA no cliente; backend recebe apenas senha de autenticação e envelopes. Senha administrativa inicial não gera identidade. Reset de login preserva identidade. | `test-vault-integrated-postgres.js`: cadastro API, login, inicialização, desbloqueio, senha de login rejeitada para abrir identidade, segredo de desbloqueio ausente dos payloads. Testes de reset/non-exportability/limpeza preservados. | Validação humana de login/perfil/recuperação e revisão criptográfica independente. Não existe fluxo de convites separado nesta base; contas provisionadas usam o mesmo setup obrigatório. |
| FP-02 | `vaultCryptoController.js`, `vaultSessionService.js`, ClientVault, ClientsList, VaultSharingManager e migration 22: DEK por cofre/época, envelopes RSA-OAEP vinculados a cofre/destinatário/versão; identidade publicada pelo titular autenticado com senha/MFA, imutável via API. Removida distribuição da MK pessoal. | HTTP/PG: dois cofres isolados, compartilhamento com outra identidade, leitura, revogação, renovação e rejeição da chave antiga em versões futuras; primitivas comprovam isolamento da chave privada pessoal. | Diretório confia no backend/TLS e no bootstrap autenticado, não somente no fingerprint. Não protege contra servidor que substitui o JavaScript. Cofres legados/usuários ausentes ficam explicitamente pendentes; não declarar toda instalação migrada. |
| FP-03 | API `/crypto/vaults/:id/records`: IDs, vínculo imutável, permissões por operação, revisão por registro + CAS do cofre. Serviço compartilhado pela UI adapta fotografias das categorias a deltas. Escritas agregadas antigas recusam 409. | HTTP/PG com sessão/CSRF válidos: inclusão sem alterar anteriores; editor altera sem excluir; leitor não escreve; IDs/contexto autenticados; conflito 409 em escrita obsoleta e corrida com somente um vencedor. | Percorrer manualmente todas as abas/plugins e anexos reais em cópia autorizada; limites explícitos 20.000 registros/18 MiB por request. Não inferir cobertura de toda interface a partir do build. |
| FP-04 | Resolvedor anterior preservado; destinatários usam grupos/membros atuais e interseção das permissões. Trigger invalida apenas quem perdeu todos os caminhos. | `test-audit-postgres.js` + integrado: restrições grupo/cofre, membro removido, segundo grupo mantém envelope/acesso; sessão válida comprova autorização, não 401 acidental. | Matriz visual e todas combinações de endpoints administrativos ainda requerem revisão adicional; testes documentam exatamente os caminhos cobertos. |
| FP-05 | `reauthService.js`, ReauthDialog, api interceptor, perfil: concessão curta, de uso único, vinculada a sessão/token_version/finalidade/payload; confirmação do novo e-mail e aviso ao antigo; revogação de sessões/reset tokens. Rotas admin alternativas protegidas; e-mail de terceiro não é alterado por bypass. | HTTP/PG: ausência de reauth, payload adulterado e reuso recusados; e-mail fica pendente; duas mensagens capturadas apenas para example.invalid; confirmação invalida sessão sem mudar identidade. | Teste visual do diálogo e entrega na caixa de homologação. SMTP na transação usa conexão reservada; timeout de transporte limita duração. |
| FP-06 | Conexão reservada em transações; serialização ACL/épocas, fonte/revisão/manifesto verificados; ativação registros/ACL/envelopes atômica. SMTP/auditoria recebem queryable reservado. | PG real: corrida CAS; falha injetada após início de ativação deixa epoch=0, staging/original preservados; teste anterior de rollback após DELETE e commit independente mantido. | Carga de grandes cofres: lock global de operações criptográficas favorece segurança, reduz paralelismo. |
| FP-07 | Imagens Node 24.21.0 e nginx final por digest mantidas; backend final USER node/read-only/cap_drop/no-new-privileges. | Suítes Node local; CI constrói imagens, verifica Argon2, UID não-root e inicia backend final contra PostgreSQL isolado com health/SHA exatos. | Runtime instalado e proxy externo não verificados. Docker indisponível localmente. |
| FP-08 | Desafios persistentes/atômicos preservados; `sensitiveFactorService.js` unifica passo TOTP em setup/perfil/reset/reauth. Limite de reauth por conta em PostgreSQL, além do limite HTTP. | PG: login/setup concorrentes, reuso entre desafios, expiração/tentativas; consumo sensível; orçamento concorrente compartilhado. Login MFA após restauração em segunda base. | Testes ponta a ponta de cada ação sensível por navegador e revisão de abrangência da política. |
| FP-09 | KDF ativa independente PBKDF2-SHA256 600.000; MK/RSA antigos arquivados cifrados pela nova identidade para migração. Exportadores backups v1/v2 usam scrypt N=131072,r=8,p=1; leitores aceitam somente custos legados conhecidos/novo. | Testes ativos + backup/restore v2; fixture v1 independente N=32768 aceita; senha incorreta/adulteração rejeitadas. | Benchmark em dispositivos reais/grandes backups. Parâmetros antigos não são apenas renomeados no banco. Usuário ausente ainda não reenvelopado. |
| FP-10 | Lockfiles corrigidos preservados, npm ci, Nodemailer 10.0.10; zero mudanças de dependências nesta continuação. | npm audit backend produção e frontend completo: zero; suites de SMTP e entrega TLS em capturador sintético. | Entrega real em caixa dedicada depende de ambiente autorizado; nenhuma mensagem enviada a clientes. |
| FP-11 | API não enfileira atualização de main; compose sem updater/socket; update.sh exige release; `deploy-approved-release.js` valida assinatura, origem, revisão aprovada e imagens por digest, política root/teste e recuperação. | Teste rejeita assinatura/origem/revisão/tag/alvo inválidos. CI constrói sem publicar/deploy. | Chave de confiança, assinatura/publicação de imagens, proteção de main/rulesets, recuperação real e teste operacional do deploy/rollback exigem operador. JSON anterior é proposta, não proteção aplicada. |
| FP-12 | TLS obrigatório preservado, sem fallback inseguro. | `test-audit-tls.js`: SMTP/FTP sem upgrade recusados antes de credenciais; certificados SMTP/FTPS inválidos rejeitados; entrega SMTP TLS em capturador local com CA de teste explicitamente confiada. | Validar certificados/credenciais do provedor autorizado sem desabilitar validação. |
| FP-13 | Super Admin antes do multipart; lease PG entre processos, limite temporal/espaço, cleanup e recuperação de órfãos sob lease exclusivo. | HTTP: usuário sem privilégio com sessão/CSRF válidos não chega ao parser; concorrência entre conexões; espaço zero, timeout, aborto, conexão encerrada e processo filho SIGKILL com cleanup na instância seguinte. | Abortos de rede reais através de Nginx e comportamento do disco da instalação não testados. Sem teste de exaustão remoto. |

## Migração ativa e recuperável

- Migrations 22/23 e respectivos guards são aditivos/idempotentes. Migration 21
  anterior permanece apenas histórica; o fluxo ativo usa vault_migration_stages.
- Inventário somente de metadados: `database/audit-vault-migration-inventory.sql`.
- Titular define segredo diferente da senha de login (mínimo 16 caracteres),
  gera identidade nova/RSA e arquiva as chaves antigas cifradas. Não apaga
  envelopes pessoais anteriores durante a transição.
- O proprietário abre o cofre; históricos/snapshots são descriptografados no
  cliente, recriptografados com DEK nova, enviados em lotes de staging, relidos e
  comparados integralmente. IDs/contagens/hash da origem/revisão/destinatários
  são novamente verificados na ativação atômica.
- Interrupção pode ser retomada; staging divergente exige cancelamento explícito
  antes de reiniciar. Falha não remove originais. Só um staging por cofre.
- Antigos vault_items permanecem cifrados para recuperação. Histórico anterior
  fica também em registros __history; histórico v2 em vault_record_history.
  Removem-se envelopes compartilhados legados do cofre ao ativá-lo.
- Identidade ausente de qualquer destinatário bloqueia migração com erro
  explícito. Concessão posterior exige proprietário renovar envelopes.
  Escrita com revogação pendente é negada até a rotação.
- Backup v2 inclui identidades, epochs, envelopes, registros, histórico, staging,
  MFA e configurações SMTP/cloud cifradas. Teste restaura em SEGUNDA base e
  comprova login, MFA, abertura do cofre e decifragem de configuração operacional.
- JWT_SECRET/CONFIG_ENCRYPTION_KEY não foram rotacionados. Guardá-los separadamente
  é indispensável para recuperar MFA/configurações. Trocar senha de login não
  troca o segredo independente. Perder esse segredo sem cópia recuperável impede
  abrir os cofres; recuperação de login não inventa outra chave nem destrói dados.
- Revogação não apaga plaintext/chaves já copiados. MK antiga compartilhada deve
  ser considerada comprometida: por isso geram-se MK/RSA e DEKs novas, não apenas
  novos nomes para os envelopes antigos.

## Testes reproduzíveis e limites

```sh
cd backend
npm ci
npm test
node scripts/test-audit-postgres.js
node scripts/test-vault-integrated-postgres.js
node scripts/test-audit-tls.js
node scripts/test-approved-release.js
npm audit --omit=dev
cd ../frontend
npm ci
npm test
node scripts/test-vault-crypto-v2.js
npm run build
npm audit
cd ..
git diff --check
```

17 scripts da suíte backend e 16 frontend passaram. Integrações PostgreSQL/HTTP,
primitivas v2, capturadores TLS, release, build e ESLint dos fontes alterados
passaram localmente. Build avisa chunk >500 kB. Os testes de erro intencional
imprimem códigos sanitizados de falha; isso não é falha da suíte.

A suíte antiga tinha expectativas de updater/main, geração automática de chave
operacional e endpoint legado /users/keys. Foram atualizadas para exigir o
contrário: release verificada, preservação de chaves operacionais e 409 na rota
legada. Controles negativos de autorização, CSP, rollback e não-exportabilidade
foram mantidos. Fixture de backup antigo não depende do exportador novo.

Skill computer-use não permite automatizar este gerenciador de senhas.
Não foi usado outro caminho para contornar a restrição. Validação de navegador
é **pendente**, mesmo com build e testes do serviço frontend aprovados.

## Implantação e verificações humanas

Ver `security-audit-deployment.md` para pré-condições, recuperação, política de
release e roteiro visual. Nenhuma atualização por main foi executada.
A implantação depende de confirmação de ambiente exclusivamente de teste,
host/mecanismo autorizado, SHA/digests atuais e recuperação protegida verificada.

O desenho de runtime PostgreSQL separado está em
`database/provision-runtime-role.sql` e `backend/scripts/migrate-schema.js`;
`DB_SCHEMA_MODE=verify` não executa DDL e rejeita papéis superuser/createdb/createrole.
Não foi aplicado em servidor existente. Sem esse opt-in a inicialização legada
continua migrando para compatibilidade: não afirmar que o papel instalado tem
privilégios mínimos.

## Commits e CI desta continuação

Commit de implementação/testes/migrações desta matriz: `7c3fa660ec7b926bd5bcfc3b8ce4bb32038a8cbe`.
Base ec8e90c já tinha CI aprovado; isso não valida automaticamente
as mudanças atuais. Resultado do novo CI será registrado após a publicação.
Manter PR #3 em draft até concluir revisão, validação visual,
teste de implantação/recuperação e pendências operacionais acima.
