# Compatibilidade de schema na instalação e atualização

O backend aplica `ensureSecuritySchema()` numa transação, verifica explicitamente
as colunas, tipos, defaults, NOT NULL e checks das preferências e só aceita
requisições após COMMIT. Falha encerra o processo com status 1; a imagem de
produção executa Node diretamente, sem nodemon.

O healthcheck revalida o schema no banco utilizado pela API e responde 503 se
estiver incompatível. O instalador e o updater exigem PostgreSQL healthy,
backend healthy e `/api/health` com schema válido e o SHA completo do build
esperado. O updater também verifica frontend e Nginx antes de gravar
`installed-commit`. Falha mantém o último marcador válido e a solicitação do
daemon segue para `failed`.

## Diagnóstico do incidente

A migration 19 e sua chamada antes de `app.listen()` já existiam. Um processo
executando esse código contra o banco consultado não poderia concluir startup
com as duas colunas ausentes. Sem logs e identificação da imagem daquele deploy,
não é possível distinguir imagem antiga, processo/caminho de startup diferente
ou banco diferente. O healthcheck antigo apenas aceitava HTTP 200, não atestava
schema nem revisão, e o backend não possuía healthcheck Docker. Esses pontos
permitiam que a divergência passasse despercebida.

O teste PostgreSQL também reproduziu `42P08` no UPDATE de perfil: o parâmetro de
e-mail era inferido como text e varchar na mesma query. Cast explícito corrige
essa falha independente. A transação agora inclui o SELECT final; incompatibilidade
de preferências retorna `DATABASE_SCHEMA_OUTDATED` sem alteração parcial.

## Verificação depois de atualizar

Consulta somente leitura (não é necessário ALTER manual):

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
  AND column_name IN ('menu_position','menu_display')
ORDER BY column_name;
```

Esperado: `menu_display | text | 'labels'::text | NO` e
`menu_position | text | 'side'::text | NO`.

## Arquivo público de tema

O daemon usa umask 077 para seus arquivos privados. Checkout de código usa umask
022, e o Dockerfile frontend normaliza somente `dist`: diretórios 755 e arquivos
644. Isso evita copiar assets 600 para o Nginx. `theme-init.js` não usa fallback
HTML. Nenhuma CSP foi ampliada: Cloudflare Insights externo continua bloqueado
por `script-src 'self'`, conforme a política atual.

Testes de schema usam PGlite (PostgreSQL embarcado), sem acessar dados reais.
Testes de updater usam Git local real e Docker simulado. A validação final em
containers PostgreSQL 15/Nginx deve ser feita no ambiente de homologação.
