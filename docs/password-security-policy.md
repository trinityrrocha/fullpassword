# Política de senhas de login e cofres

Base: de38b28236b03cb7ea50e9f90572c36252969d66. A implementação não altera a release ativa.

## Contrato

Configurações → Segurança contém uma única seção Política de Senhas, após Política
de Login. Mínimos independentes: 8/12/16/20; períodos: 6/12/18 meses. Defaults:
login 12, cofres 16, ambos 12 meses. Maiúscula/minúscula/número/especial e bloqueio
de senhas comuns permanecem como antes. PUT aceita exatamente os quatro números;
não aceita strings, valores arbitrários ou campos adicionais. Super Admin, sessão,
CSRF, limites de escrita e auditoria são preservados. Não havia reauth nessa rota.

GET administrativo permanece em /api/system/password-policy. GET público
/api/auth/password-policy disponibiliza somente requisitos não sensíveis para
bootstrap/reset e validação local; não retorna updated_by/updated_at.

Login valida o tamanho novo apenas em criação/troca/reset, nunca no login existente.
Expiração é calculada por meses de calendário UTC (dia limitado ao último dia do
mês) sobre users.password_changed_at; middleware e /auth/me recalculam a condição.
Uma sessão vencida só pode usar perfil/reauth/me/logout/CSRF até concluir a troca.
O modal obrigatório existente é reutilizado. A troca real do hash atualiza o mesmo
timestamp via trigger existente e revoga sessões como antes.

Para cofres, somente criação/reenvelopamento valida o mínimo configurado no
navegador. Derivação para abrir um envelope existente não usa o mínimo atual.
Assim, aumentar o mínimo não torna um segredo antigo inacessível. Expiração usa
vault_secret_changed_at; o AuthContext revalida no desbloqueio, foco e a cada minuto,
bloqueia o uso normal e limpa chaves existentes quando necessário. O aviso abre
o diálogo de reenvelopamento existente. Sucesso atualiza timestamp transacional,
limpa chaves/clipboard e exige novo unlock. RSA, fingerprint, Master Key, DEKs,
envelopes e registros não são rotacionados por esse fluxo.

O servidor não recebe segredo dos cofres, hash de verificação ou KEK. Conhece
apenas política, timestamp e o envelope cifrado autorizado. O mínimo do cofre é
uma garantia da UI oficial, não uma prova server-side sobre um segredo invisível.

## Schema e compatibilidade

SCHEMA CHANGE: YES. MIGRATION REQUIRED: YES.
Uma release futura precisa migrateSchema=true e do operador schema-migrate.
Runtime verify faz SELECT das novas colunas e não deve iniciar com schema antigo.
Nenhuma migration/deployment é executada nesta tarefa.

passwordPolicySchema.js é chamado pelo securitySchema existente, na transação e
sob advisory lock. As quatro colunas novas têm NOT NULL/defaults/check allowlist.
Colunas antigas não são removidas. Elas ficam depreciadas; a API mantém um espelho
compatível de login (min_length=max(12,novo mínimo), aviso=novo período) para
leitores históricos. A política explícita é autoridade; o piso legado de 12 não
impede a escolha explícita de 8 na nova versão. Restauradores antigos continuam
reconhecendo o formato histórico.

Migração inicial arredonda o mínimo legado para cima: <=12→12, 13..16→16,
17..20→20. Se o legado for >20 e não houver política explícita, a migração falha
com PASSWORD_POLICY_LEGACY_MINIMUM_UNSUPPORTED, sem reduzir proteção; exige revisão
do operador. Período legado nulo→12; 1..6→6; 7..12→12; >12→18. A recomendação antiga
passa explicitamente a obrigação; períodos legados acima de 18 ficam em 18.

Não há data de criação confiável no JSON de identidades existentes. O backfill
usa CURRENT_TIMESTAMP da migração somente para identidades sem timestamp, dando
um período completo. Não usa updated_at de perfil nem reseta datas existentes.

Exportadores v1/v2 usam SELECT * das tabelas permitidas, incluindo users e
password_policy_settings. O restaurador comum preserva novos campos; backups
antigos recebem normalização equivalente e backfill temporal somente quando
ausente. Valores legados não representáveis falham atomicamente, sem redução
silenciosa. Formatos/envelopes de backup não mudam.

## Verificação

password-policy-fixture.js integra a fixture HTTP/PostgreSQL descartável existente;
test-password-policy.js cobre mínimos e invariantes criptográficas no navegador/Node.
A fixture real de Perfil/Equipe inclui agora SecurityCard: opções, salvar/persistir,
falha/retry, submit duplicado, draft entre collapse/expand, teclado e 1280/390/320
em claro/escuro. Selects permanecem nativos (popup do SO aceito), sem novos tokens.
Nenhuma VM, dados reais, credenciais reais ou serviços externos são usados.
