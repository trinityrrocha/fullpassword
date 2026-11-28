# Módulo SPFBL

Portal de consulta e gestão de bloqueios de e-mail do Matrix SPFBL, recriado dentro do FullPassword a partir do
portal SPFBL Ban original (PHP). Fase 1: menu **Módulos**, configuração, catálogo de domínios (importação do WHM) e
acessos por usuário. Fase 2: **Dashboard**, **Histórico**, detalhes do registro, consulta de status atual, **solicitação de
revisão**, **desbloqueio direto**, fila do administrador, novo bloqueio e **notificações por e-mail**.

## Uso

1. Configurações do Sistema → **Módulos** → ativar **SPFBL** (Super Admin; pede reautenticação). O ícone aparece no menu
   do Super Admin e dos usuários com acesso. Desativar o módulo encerra o acesso de todos na hora.
2. Página **SPFBL** → aba **Configurações do SPFBL** → card **Servidores** (um só modal para o servidor e a sua conexão Matrix).
   *Adicionar servidor* pede o nome, o **tipo de servidor** (hoje só cPanel/WHM), o endereço (hostname, sem https/porta/IP), o usuário e o
   token do WHM e, se quiser coletar o histórico, o usuário e a senha **Matrix** desse servidor. Cada servidor tem **a sua** conexão Matrix
   (o Matrix mostra só 1024 registros por servidor). Cada credencial tem o seu botão **Validar credenciais** (o servidor e o Matrix):
   confere o que foi digitado **sem gravar nada**; um campo de segredo em branco, ao editar, valida com o segredo salvo (só se o endereço/usuário
   não mudou). Digitar de novo em um campo apaga o resultado da validação anterior. A validação não é obrigatória para salvar. Na lista,
   cada servidor tem *Sincronizar domínios* (há também *Sincronizar todos os servidores*), *Editar* e *Remover*.
3. Card **Retenção do histórico** (parâmetros globais, valem para todos os servidores): retenção (30/60/90 dias), frequência da coleta
   (1, 2, 4, 8, 12 ou 24 h), última coleta de cada servidor e *Coletar agora*.
4. **Domínios**: catálogo importado dos servidores WHM ou digitado; cada domínio mostra de qual servidor veio. **Ativo** = domínio de conta
   **não suspensa** no WHM (inclui os subdomínios que o `get_domain_info` retorna; filtre pela conta ou pelo nome); domínios que saem do
   servidor ficam inativos (não são apagados). Domínios digitados à mão podem ser removidos. A sincronização de um servidor só mexe nos
   domínios **dele**; um domínio listado por outro servidor passa para esse.
   **Remover um servidor** pergunta o que fazer com os domínios vinculados (sem resposta padrão): *remover* (apaga os importados e os acessos
   a eles; os digitados à mão ficam) ou *manter*. Os mantidos ficam **sem servidor de consulta**: continuam ativos e com o **histórico já
   coletado**, mas sem ações no Matrix (consultar status, solicitar, desbloquear ou bloquear são recusadas). A conexão Matrix do servidor
   removido sai junto; o histórico coletado por ela continua até o fim da retenção. Um domínio sem servidor volta a ter conexão quando algum
   servidor o listar numa sincronização. O servidor WHM e a conexão Matrix únicos de versões anteriores são movidos para a lista, uma vez.
5. **Acessos de usuários**: contas do FullPassword com 1 a 100 domínios e o modo de tratamento dos bloqueios (revisão
   pelo administrador ou desbloqueio direto). Não existe uma segunda senha: valem o login, o MFA e a auditoria do
   FullPassword. O acesso é avaliado a cada requisição.

## Fase 2: histórico, solicitações e desbloqueio

**Telas** (abas da página SPFBL): *Dashboard* (período de 7 dias em America/Sao_Paulo: tentativas, bloqueios por motivo, top 10 domínios e
destinatários, últimos 10 desbloqueios), *Histórico* (filtros por domínio autorizado, remetente/destinatário, situação, período de até
90 dias; 25 por página; detalhes do registro), *Solicitações* (a conta vê as suas; o Super Admin vê a fila e decide).

**Histórico: Recebidos e Enviados.** A aba *Histórico* tem duas sub-abas. *Recebidos* é a tela descrita abaixo. *Enviados* mostra os e-mails
enviados pelos domínios do servidor WHM, lidos pela função `emailtrack_search` da API do cPanel (somente leitura, na lista de funções
permitidas do cliente WHM). Os registros são **coletados e armazenados no PostgreSQL** (migration `42_spfbl_sent_history.sql`, tabela
`spfbl_sent_records`): a tela lê do banco, então o limite de registros por chamada do WHM não restringe mais o período, e consultar 7, 30, 60 ou
90 dias não chama o WHM para esse intervalo todo. Isso significa que os **endereços dos destinatários passam a ficar no banco do FullPassword**
pelo prazo de retenção (como já ocorre com o histórico de recebidos). Colunas: evento (Entrega, Tentativa adiada, Falha na entrega, Em andamento),
remetente, destinatário, data (dd/mm/aa), hora (Brasília), resultado e *Detalhes* (todos os campos do log em grupos). O resultado é "Enviado" ou
um texto curto, com ícone, traduzido da resposta do servidor de destino: *Email errado ou não existe*, *Erro de digitação* (endereço malformado,
SMTP 501 e 553 5.1.3), *Caixa do destinatário cheia*, *Você foi bloqueado como spam*, *Servidor de destino não respondeu* (também para adiamentos
sem causa conhecida), Domínio inexistente, Limite de envios excedido, Falha de TLS, Mensagem grande demais (outros adiamentos aparecem como "Adiado: …"); o
que não for reconhecido aparece como "Falha na entrega (código)" com o ícone genérico de e-mail com alerta. O sucesso é só o ícone de dupla
verificação verde (com o texto "Enviado" para leitores de tela). A coluna *Evento* não existe mais na lista: o evento é a primeira linha dos *Detalhes*. A tradução é refeita **a cada leitura** a partir do texto guardado, então uma
tradução melhorada vale também para o que já foi coletado. É heurística, feita de textos conhecidos: **não foi validada com falhas reais do
servidor** e deve ser ajustada quando houver exemplos.
- **Coleta**: no mesmo intervalo da coleta do histórico de recebidos (card *Histórico armazenado*: **5, 10, 15 ou 30 minutos**, 1, 2 ou 3 horas; migration
  `43_spfbl_history_interval_options.sql`) e para **todo servidor WHM com token**, tenha ou não conexão Matrix. A primeira coleta vai até 10 dias para trás (nunca além da
  retenção), **dia a dia**; as seguintes leem só o que é mais novo que a coleta anterior, com 1 hora de sobreposição (a chave do registro é um hash
  de mensagem, destinatário, hora e tipo, então uma linha lida duas vezes é gravada uma só vez). Uma janela que falha não perde o progresso das
  anteriores. O turno é reservado no banco antes da coleta (reinício ou segunda instância não a repetem) e um servidor que falha espera 15
  minutos. A auditoria registra `spfbl_sent_collected` (servidor, quantidade, janelas), sem endereços.
- **Ao abrir a tela**: o que for mais novo que a última coleta é buscado na hora (no máximo a cada 2 minutos por servidor). Se a coleta do
  servidor ainda nunca rodou, ela começa em segundo plano e a tela avisa que a primeira coleta está em andamento. Se o WHM falhar, o que já está
  guardado continua aparecendo, com um aviso (e, para o Super Admin, o servidor e o código do erro).
- **Retenção**: a mesma do histórico de recebidos (30, 60 ou 90 dias). Registros mais antigos são apagados a cada coleta e, ao reduzir a
  retenção, na hora. Os períodos do filtro (24 horas, 3, 7, 30, 60 e 90 dias) são limitados pela retenção.
- **Escopo**: o mesmo do histórico recebido (a conta só consulta os domínios liberados para ela; o Super Admin, todos). O domínio do
  registro é o do remetente: o campo `domain` e, quando ele vem vazio, o domínio do endereço do remetente (`email`, depois `sender`).
  Mensagens recusadas na chegada (`type: rejected`) não entram.
- **Todos os domínios**: a primeira opção do seletor de domínio, **mas não é a padrão**: ao abrir a aba vem selecionado o primeiro domínio do escopo
  (ler todos de uma vez custa mais). Para o **Super Admin** traz tudo o que **cada servidor WHM
  cadastrado** registra, de todas as contas (inclusive as de revendedores restauradas de backup e o e-mail do próprio sistema, como o do
  root); para as demais contas, os domínios do escopo delas.
- **Duas consultas ao WHM** (os registros não têm os mesmos campos): *entregues e em andamento* são filtradas no servidor só por período e só
  entregas remotas (**o domínio nunca vai no pedido**: o filtro `domain eq` devolvia 0 registros num servidor real; o servidor inteiro é lido e o
  domínio é filtrado no banco); *adiadas e com falha* **não** são filtradas por `domain` nem por entrega remota (nelas o `domain` pode vir vazio
  e uma falha na fase de roteamento nunca chega a um transporte remoto), só pelo período da tentativa. Um registro vale no período se foi
  enviado ou tentado nele.
- **Sem limite de resultados da função**: `max_results_by_type` é aplicado pelo servidor **antes** dos filtros, então qualquer limite faria
  os remetentes mais ativos empurrarem os demais domínios para fora da resposta. A consulta usa `max_results_by_type=0` e controla o tamanho
  por **janelas de um dia** (as janelas se sobrepõem em 1 segundo, porque o WHM filtra com "depois de" e "antes de" exclusivos), pela ordem
  (mais novos primeiro) e pela paginação do próprio WHM (`api.chunk`, 500 por chamada, até 5000 por tipo e por janela, no máximo 120 segundos
  por janela). Se uma janela atingir o teto, a tela avisa que pode haver mais.
- **Diagnóstico (só Super Admin)**: uma linha com o que a **última consulta** ao WHM devolveu por tipo, quantos não são envios e quantos
  registros estão armazenados no período para a consulta, por consulta (registros, partes, ms, erro) e os domínios que mais apareceram. Só
  números, nunca endereços.
- **Permissão do token**: o token do WHM precisa poder executar `emailtrack_search` (privilégio `track-email`). **Para ver todas as contas de um
  servidor com revendedores é preciso um token do root com todos os privilégios**: com privilégios parciais (testado com `track-email`,
  `acct-summary` e `list-accts`) o WHM devolve só as contas cujo proprietário é root, e as de outros revendedores ficam de fora. Esse
  comportamento foi observado num servidor real; a causa exata não está na documentação do cPanel. Como o token é poderoso, **restrinja por IP**
  (o IP que o cPanel enxerga é o de saída da rede do FullPassword, por exemplo o do firewall com NAT) e use um token exclusivo, com validade.
  A alternativa de menor privilégio é um token por revendedor, ainda não implementada.
- **Falha parcial**: as duas consultas são independentes; se uma falhar, o que a outra trouxe é gravado e a tela avisa.
- Rota: `GET /api/spfbl/sent` (limitador de 60 por 15 minutos).

**Histórico armazenado.** O Matrix devolve o histórico da conta inteira. Uma coleta em segundo plano (1 por vez) percorre as páginas,
do mais novo ao mais antigo, e grava no PostgreSQL **só os registros dos domínios cadastrados** (`spfbl_history_records`; cada
execução fica em `spfbl_history_runs`). A consulta lê do banco, pagina 25 por página e **filtra sempre pelos domínios atuais do
solicitante** (correspondência exata do destinatário; revogar o acesso ou desativar o domínio vale na próxima requisição). A chave do
fornecedor nunca vai ao navegador. A coleta roda sozinha **a cada 1, 2, 4, 8, 12 ou 24 horas** (escolha do Super Admin; a
reivindicação do turno é gravada no banco, então reinício ou duas instâncias não repetem a coleta) e as linhas são mantidas por **30, 60 ou
90 dias** (escolha do Super Admin; reduzir a retenção apaga registros e exige confirmação com a contagem). Ao consultar um período que
a coleta ainda não cobre, o servidor inicia uma coleta e a tela mostra "Coletando…"; quando a cobertura é incerta (limite de páginas,
falha, linhas ignoradas) aparece "Cobertura parcial". Estas tabelas guardam endereços de terceiros e **ficam fora do backup**; trocar a conta
Matrix apaga os registros da conta anterior. **Limite do Matrix:** o Matrix mostra só os últimos 1024 registros do servidor (todos os domínios juntos). A coleta detecta esse teto e,
quando duas coletas seguidas não se sobrepõem, avisa "possível perda de registros anteriores a dd/mm/aa"; a tela também diz desde
quando o histórico é confiável. Quanto menor o intervalo, menos registros se perdem. Parâmetros fixos: até 300 páginas e 100 000 linhas por coleta, 0,75 s entre páginas.

**Modos de tratamento (por usuário):**
- *Revisão*: o usuário registra a solicitação (com confirmação) e o Super Admin decide: **Manter bloqueio** (nada vai ao SPFBL),
  **Liberar no SPFBL** ou, depois, **Bloquear novamente**.
- *Desbloqueio direto*: o usuário (e o Super Admin) libera o remetente na hora, com confirmação.
- O alcance é avisado nas telas: a operação `white` do fornecedor **pode afetar outros destinatários da mesma integração**.

**Depois do desbloqueio.** A lista e os detalhes mostram que o registro **estava bloqueado e agora está desbloqueado**, com **quando e por quem**
(vindo do registro do portal; se o SPFBL informar `WHITELISTED` sem registro do portal, aparece "Liberado no SPFBL (fora do portal)"). O
filtro **Desbloqueados** lista só os liberados; o motivo original continua visível. Os detalhes trazem o histórico de ações do registro.

**Bloquear remetente.** Contas em modo *desbloqueio direto* e o Super Admin podem enviar o **bloqueio** de qualquer registro listado (inclusive
aceito pelo filtro) que o SPFBL ainda não informe como `BLOCKED`, com a mesma confirmação, aviso de alcance, trava por registro e regra de
"resultado não confirmado". Depois do bloqueio o registro pode ser desbloqueado de novo.

**Garantias.** Uma operação por registro, reservada com trava de linha no PostgreSQL; a intenção ("processando") é gravada
**antes** da chamada ao SPFBL; qualquer dúvida depois da chamada (erro, tempo, resposta que não é exatamente `DONE`) vira **resultado
não confirmado** e **nunca é repetida automaticamente**; uma intenção "processando" esquecida por mais de 10 minutos (queda no meio)
também vira "não confirmado". "Consultar status atual" (somente leitura) reabre uma liberação que o fornecedor reporta como
BLOCKED de novo. Cada ação leva uma **prova emitida pelo servidor**, presa à conta e ao estado do registro (motivo, revisão da
operação): se o registro mudou, a confirmação falha e a tela pede para reabrir. Não há reautenticação por ação (o limite de 5
por 15 minutos a tornaria inviável); vale CSRF + limite próprio (60 ações por 15 min) + auditoria.

**Notificações.** E-mail pelo SMTP do FullPassword, **melhor esforço**: aos Super Admins quando chega uma solicitação nova; ao
solicitante quando o administrador marca "Avisar o solicitante". Falha de e-mail (ou SMTP desligado) nunca bloqueia nem desfaz a
decisão e fica na auditoria. Sem fila persistente nesta versão.

**Dados.** `spfbl_requests`, `spfbl_operations` e `spfbl_release_events` (migração 29), nos backups como tabelas opcionais; as
decisões sobrevivem à exclusão do usuário (`actor_id` fica nulo).

## Fase 3: avisos, auditoria e visão do administrador

- **Notificações recentes (sino).** Os Super Admins recebem no sino: nova solicitação de revisão, desbloqueios/bloqueios diretos feitos por
  usuários e qualquer operação **não concluída** (falha ou resultado não confirmado). O clique abre a aba **Solicitações** ou **Auditoria**
  (`/spfbl?tab=requests|audit`). Além disso o e-mail ao administrador (melhor esforço) continua valendo.
- **Auditoria** (aba, só Super Admin): eventos `spfbl_*` da trilha de auditoria do sistema, com filtros por evento, situação, domínio e período
  (America/Sao_Paulo), 25 por página. Os detalhes passam por **lista de permissão** (domínio, modo, motivo, status do SPFBL, diagnóstico
  fixo): nunca senhas, tokens, chaves do fornecedor ou texto livre.
- **Todos os domínios cadastrados** (Dashboard do Super Admin): uma linha por domínio do catálogo (ativo ou não, mesmo sem registros) com
  tentativas, bloqueios por motivo, desbloqueios do período e solicitações pendentes; busca e filtro "só com bloqueios".
- **Layout e datas.** Tabelas minimalistas, uma linha por registro (texto longo é cortado com a dica completa ao passar o mouse). Datas
  curtas **dd/mm/aa** em todo o sistema (os campos de data nativos seguem o idioma do navegador).

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
Matrix SPFBL nem contra um WHM reais: ambos foram simulados a partir da documentação e do projeto PHP. Em especial, **o formato real
de `arrival`, `status` e das respostas de `registry`/`white`/`block` do Matrix não foi confirmado** (o histórico aceita ISO 8601 e RFC 2822
com fuso; registros fora disso são ignorados e a cobertura vira parcial). Antes de liberar para usuários, faça um desbloqueio de teste com um
registro real e confira no painel do SPFBL. A concorrência (várias liberações simultâneas do mesmo registro chegam ao fornecedor uma
única vez) foi provada em PostgreSQL nativo com o fornecedor simulado.
