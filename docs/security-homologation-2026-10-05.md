# Continuação PR #3 — 2026-10-05

Branch: security/audit-remediation-2026-09-17. Base inicial conferida:
f39d877d97cc729a7301a2ab29d753555f18cb45; PR draft, sem alterações posteriores
no remoto ao iniciar. Nenhuma intervenção no host/VM foi executada.

## Implementação e evidência

| Entrega | Implementação | Evidência executada | VM/painel remoto |
|---|---|---|---|
| FP-11 agente | Host root, assinatura externa, aprovação de SHA/digests/origin/expiração, pedido estrito, ledger antes dos efeitos, lock e status duráveis, falha recovery_required | test-release-agent.js, test-approved-release.js | Não instalado |
| FP-11 API | Super Admin, CSRF global, reauth purpose system_release vinculada ao payload/sessão, MFA habilitado, fila sem credenciais | test-vault-integrated-postgres.js via HTTP + PostgreSQL real | Não validada |
| FP-11 painel | Release aprovada, SHA/digests completos, um POST, polling GET, sem countdown cosmético/retry automático | ESLint/build, testes frontend; audit strict da fatia nova | Navegador não executado |
| FP-02/04 itens diretos | Chave aleatória por item, envelope por destinatário, grant original preservado; snapshot exato e anexo; nunca entrega DEK do cofre | HTTP/WebCrypto/PG: recipient abre item, não abre histórico nem cofre; chave não abre registros do cofre; revogação seletiva | Não implantado |
| Atualização d9a7a37 | init.sql e schema guard carregados do objeto Git d9a7a3786143379df43ff1910263894df33449bf; fixtures criadas ANTES da nova migração | Schema idempotente, grants, permissões limitadas, snapshots/anexo preservados; migração interrompida e retomada | Instalação Docker antiga ainda não ensaiada nesta primeira revisão |
| Recuperação | Original ciphertext retido, staging transacional; backup cifrado restaurado em segunda base | Falha de ativação, rollback/retomada, fresh login/cofre/MFA/config após restauração | Backup/restore da VM não executado |

O ensaio PostgreSQL parte do schema efetivo antigo e de dados previamente
inseridos; não é uma instalação nova do schema v2. Ainda não equivale a um
ensaio completo de containers/install.sh antigo; essa distinção é obrigatória.

## Validações locais

- 17 scripts backend e 16 scripts frontend de npm test, executados com Node direto.
- test-vault-integrated-postgres.js: PostgreSQL 15.18 nativo em loopback,
  fixtures exclusivamente sintéticas, exit 0 e limpeza. Teste restaurou segunda base.
- test-audit-postgres.js, test-audit-tls.js, test-approved-release.js e test-release-agent.js.
- test-vault-crypto-v2.js, test-update-notifications.js, ESLint dos painéis/services novos,
  Vite build (aviso conhecido de chunk acima de 500 kB), git diff --check.
- Auditoria premium strict da fatia UpdateStatusPanel/ReauthDialog/SharedItemsPanel:
  zero achados. Auditoria global interrompida por demora; não declarou telas antigas conformes.
- Bash syntax do bootstrap; Node syntax dos controllers/scripts. Sem dependência nova.
- Lint oficial de DESIGN.md: zero erros, dois avisos de tokens documentais sem
  referência em components. Design skills preservaram o runtime existente e
  centralizaram reauth acessível; nenhuma reformulação global foi feita.

Execuções intermediárias detectaram import incorreto de isSuperAdmin, expectativa
403 incompatível com a política 404 existente, adapter PGlite sem suporte ao novo
batch e race de observação do EOF de worker morto. Corrigidos; execuções falhas
não foram contadas como sucesso.

## Semântica da migração direta

Cada vault_items legado é um snapshot imutável: o grant continua vinculado a seu
ID, não ao conjunto atual/futuro de registros da categoria. O proprietário
descriptografa no navegador e cifra uma cópia scoped com chave nova, separada da
DEK do cofre. O cliente verifica todas as cópias persistidas antes da ativação.
Alteração de grants/identidades durante staging invalida a ativação; é preciso
abortar staging e refazer, sem apagar grants. Titular sem identidade independente
continua sendo blocker não destrutivo até inicializá-la.

Chaves/plaintexts anteriormente recebidos não podem ser apagados da memória de
terceiros. A retenção dos originais é deliberada para recuperação; essa exposição
histórica não é revogação retroativa de conhecimento. A nova chave scoped nunca
descriptografa o cofre v2. Itens existentes continuam somente leitura.

## Pendências concretas

Docker/Compose indisponíveis neste Windows (WSL sem distro). CI de imagens/deploy
deve ser registrado depois da execução. Nenhum digest publicado/signer de VM
foi presumido. Sem acesso ao host: inventário real, custódia de configuração e
segredos, backup consistente e restore isolado da VM, aprovação/registry e
bootstrap são pendências operacionais.

O script `backend/scripts/test-release-upgrade-docker.js` foi acrescentado à CI:
parte das imagens de d9a7a37, instala o bootstrap 821efb2, solicita a segunda
release pela API com CSRF/reauth, aguarda efetivamente 60s e verifica SHA/digests.
Também provoca release inconsistente, verifica rollback de imagens e restaura
DB/configuração sintética em um segundo volume PostgreSQL com fresh login.
Até a execução da CI, isto é implementação do ensaio, não evidência de sucesso.
Os ciphertexts da fixture Docker verificam preservação; a validade criptográfica
dos dados/anexos é testada pela suíte nativa de upgrade separada.

O procedimento operacional está em `release-agent-bootstrap-vm.md`:
inventário real, recuperação, bootstrap root protegido e homologação manual de
duas revisões, sem presumir Coolify, /opt ou caminho de instalação.

Skill computer-use lida na versão atual: proíbe automação de autenticação e
gerenciadores de senhas. Nenhuma credencial foi usada por via alternativa.
Validação pelo painel real ficará manual, com SHA/digests e evidências de 60s.
Manter PR draft. Não marcar FP-11 implantado nem homologado pela aparência da UI.

## Novos advisories e execuções CI intermediárias

As execuções 37398707685/37398869697 detectaram `proxy-addr` 2.0.7 vulnerável;
atualizado para 2.0.8. A restauração Docker inicialmente tentou enviar o dump
com metacomandos psql ao driver SQL; agora usa psql com ON_ERROR_STOP=1.
A execução 37399137305 restaurou a instalação antiga em um segundo volume,
mas falhou na fase de deployment e no audit frontend anterior aos patches.
Nenhuma dessas execuções é apresentada como CI verde.

Patches compatíveis: axios 1.20.0, DOMPurify 3.4.16, source-map-js 1.2.2 e
brace-expansion 5.0.12; override 2.x preserva 2.1.7. Lockfile npm é canônico;
pnpm audit lê o lockfile pnpm histórico e não representa o npm ci da imagem.
Não foram adicionadas bibliotecas de produto.

Após os patches, npm audit --omit=dev retornou zero no backend e frontend.
Audit completo frontend continua bloqueado: 7 entradas (5 high/2 moderate)
derivadas de braces e postcss-selector-parser na cadeia Tailwind 3 de build.
Audit completo backend: 3 high na cadeia nodemon/chokidar/braces de desenvolvimento.
braces 3.0.3 não tem patch publicado. Não executado npm audit fix --force:
ele propõe Tailwind 4 e uma migração visual global fora desta entrega.
O gate de audit completo NÃO foi afrouxado para deixar a CI verde.

Fontes primárias: [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h),
[braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[selector parser](https://github.com/advisories/GHSA-rj75-hqrm-r3gf).
