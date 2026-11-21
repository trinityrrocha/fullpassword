# Módulo SPFBL (Fase 1)

Portal de consulta e gestão de bloqueios de e-mail do Matrix SPFBL, recriado dentro do FullPassword a partir de
`trinityrrocha/sti-spfbl-portal` (PHP). Esta fase entrega o menu **Módulos**, a configuração, o catálogo de domínios
(com importação do WHM) e os acessos por usuário. Histórico de bloqueios, pedido/revisão de desbloqueio e
notificações ficam para a Fase 2.

## Uso

1. Configurações do Sistema → **Módulos** → ativar **SPFBL** (Super Admin; pede reautenticação). O ícone aparece no menu
   do Super Admin e dos usuários com acesso. Desativar o módulo encerra o acesso de todos na hora.
2. Página **SPFBL** → **Conexão Matrix**: usuário e senha da conta Matrix; *Testar conexão salva*.
3. **Servidor WHM**: hostname (sem https/porta/IP), usuário WHM (root ou revendedor) e token; *Testar conexão* (não grava
   nada) e *Sincronizar domínios*.
4. **Domínios**: catálogo importado do WHM ou digitado. **Ativo** = domínio de conta **não suspensa** no WHM (inclui os
   subdomínios que o `get_domain_info` retorna; filtre pela conta ou pelo nome); domínios que
   saem do servidor ficam inativos (não são apagados). Domínios digitados à mão podem ser removidos.
5. **Acessos de usuários**: contas do FullPassword com 1 a 100 domínios e o modo de tratamento dos bloqueios (revisão
   pelo administrador ou desbloqueio direto). Não existe uma segunda senha: valem o login, o MFA e a auditoria do
   FullPassword. O acesso é avaliado a cada requisição.

## Token do WHM

Crie em WHM → *Manage API Tokens* um token com o **mínimo de permissões** para listar contas e domínios, de preferência
restrito ao IP do servidor do FullPassword. O cabeçalho usado é `Authorization: whm USUARIO:TOKEN` na porta 2087. A
documentação pública consultada **não confirmou** qual permissão `get_domain_info` exige (apenas `list-accts`? mais?) nem a
restrição de ACL por token: confirme no seu WHM. A integração só chama `listaccts` e `get_domain_info`; se uma delas for
recusada, a mensagem de erro diz qual. O token fica cifrado no servidor (`CONFIG_ENCRYPTION_KEY`), **fora** do modelo zero-knowledge do cofre, e
nunca volta ao navegador.

## Segurança

- Credenciais cifradas e **ligadas ao destino** (usuário Matrix; usuário@host WHM): trocar o destino exige digitar o
  segredo de novo, e uma linha adulterada no banco é detectada.
- WHM: o hostname é resolvido uma vez, todo endereço precisa ser IPv4 público e a conexão vai a esse IP com TLS
  verificado contra o hostname (sem DNS rebinding); porta fixa, sem redirecionamento, limites de tamanho (8 MiB) e tempo
  (20 s por chamada, 45 s no total). Matrix: host fixo `matrix.spfbl.net`; as credenciais só trafegam no *query string*
  que o fornecedor exige e nunca chegam a logs, erros ou auditoria.
- Todas as rotas `/api/spfbl` recusam (404) enquanto o módulo estiver desligado, mesmo para o Super Admin. Configuração,
  domínios e acessos são só do Super Admin; um usuário com acesso só consegue `GET /api/spfbl/overview` (o próprio escopo).
- Reautenticação de uso único, ligada à ação: `modules_settings:<módulo>`, `spfbl_settings` e `spfbl_access:<usuário>`.
- Sincronização transacional e serializada; uma listagem falha ou **vazia** nunca desativa domínios.

## Reautenticação e limites

Cada ação sensível pede uma reautenticação de uso único, e o cliente permite **5 por 15 minutos por conta** (o mesmo limite do
backup). Na primeira configuração, ativar o módulo, salvar o Matrix e salvar o WHM já consomem três; cada concessão ou revogação
de acesso consome mais uma. **Limitação conhecida:** ao estourar o limite, o diálogo de reautenticação existente mostra a mesma
mensagem de senha incorreta (“Não foi possível confirmar sua identidade”), sem dizer que é o limite; repetir só gasta mais
tentativas (8 a cada 10 minutos). Se isso incomodar na rotina, as saídas são: um único salvamento para os dois formulários de
conexão, concessão a vários usuários numa só reautenticação, ou dispensar a reautenticação nas concessões (decisão de segurança).

## Implantação

- Cria 5 tabelas (migrações 25 a 28, também em `init.sql` e no `ensureSecuritySchema`): a release precisa rodar o
  schema como operador (`migrateSchema`). Com `DB_SCHEMA_MODE=verify` o backend recusa subir sem elas.
- Backups: as tabelas entram no backup. Backups feitos **antes** desta versão continuam restauráveis (tabelas
  opcionais); restaurá-los mantém módulo, conexões e domínios atuais, mas **apaga todos os acessos de usuários**: a restauração
  substitui a tabela de usuários e a exclusão em cascata remove as concessões (refaça-as depois).

## Verificado e não verificado

Testado: lógica, PostgreSQL real (inclusive papel de runtime restrito e restauração de backup), transportes https contra
servidores TLS locais, interface em navegador (teclado, foco, claro/escuro, 320 a 1280 px). **Não** foi executado contra um
Matrix SPFBL nem contra um WHM reais: ambos foram simulados a partir da documentação e do projeto PHP.
