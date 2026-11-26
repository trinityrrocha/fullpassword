# Módulo Domain Manager

Lista de domínios com vencimento, servidores DNS, DNSSEC e certificado SSL, consultados por RDAP. O módulo vem **desativado**; o Super Admin o liga em Configurações → Módulos.

## O que a primeira fase entrega
- Lista paginada (20/40/100) com busca e ordenação por nome, vencimento ou última consulta.
- Domínios cadastrados à mão (um a um ou colando uma lista de até 200) e domínios do catálogo do SPFBL (entram sozinhos, só o nome).
- Consulta automática de todos os domínios. Cadência adaptativa: a cada N dias (padrão 7, configurável de 1 a 30) enquanto faltar mais de 30 dias para o vencimento, e **diária** dos 30 dias antes do vencimento em diante e enquanto o domínio estiver vencido. O intervalo nunca passa do dia em que a janela de 30 dias abre.
- Botão de consulta (`SearchAlert` (nome antigo do ícone search-exclamation-point, presente na versão do lucide-react travada no lockfile)) em cada linha: consulta na hora, atualiza a data e abre os detalhes. Intervalo mínimo de 30 s por domínio e limite por conta.
- Detalhe: vencimento, registro, registrador, status, servidores DNS, DNSSEC, certificado SSL e mudanças detectadas entre consultas.
- Integração com os cofres (lupa no modal do cofre) e API de apoio entram nas fases seguintes.

## Alertas de vencimento (fase 2)
- **Engrenagem** (`Settings`) em cada domínio abre o modal de alertas: interruptor de alertas, vários e-mails (até 20) e o checkbox **Notificar os administradores**, que dispensa digitar o e-mail deles. Com os alertas ligados é preciso ao menos um e-mail ou o checkbox. A lista mostra `Alertas ativos (N e-mails + administradores)` ao lado do domínio.
- **Quando avisa**: os mesmos passos do aviso de vencimento dos cofres: 30, 15 e 5 dias antes, no dia do vencimento e diariamente até 10 dias depois. Cada passo dispara na **primeira passada** em que o domínio entra na faixa (e não só no dia exato), então um dia perdido não vira um aviso perdido. Quando faltar pouco e nenhum passo anterior foi visto, vai só o passo atual.
- **Uma vez só**: cada (domínio, data de vencimento, passo, destinatário) é reservado no banco **antes** do envio e liberado se o envio falhar. Duas instâncias não enviam em dobro, uma falha tenta de novo depois de 1 hora, e renovar o domínio (nova data) recomeça a sequência.
- **Administradores**: com o checkbox, todos os Super Admins ativos recebem o e-mail e o sino de "Notificações recentes" mostra o aviso (selo "Atenção", abre `/domains`). Sem o checkbox não há aviso no sino.
- **Aviso dos cofres**: o aviso que já existe (data digitada no cofre) continua igual. Se um endereço já é coberto por ele para o mesmo domínio, o Domain Manager não envia um segundo e-mail a esse endereço. A unificação completa vem com a fase dos cofres.
- O corpo do e-mail traz domínio, data e dias restantes, sem dados do registro. A auditoria guarda só a quantidade de e-mails, nunca os endereços.
- O agendador avalia os alertas a cada 10 minutos. Migration `36_domain_manager_alerts.sql`: tabelas `dm_alert_settings` e `dm_notifications_sent`.
- Rotas novas: `GET|PUT /api/domain-manager/domains/:id/alerts` (Super Admin).

## Acesso de usuários (fase 3)
- O Super Admin vê e administra tudo. Uma conta comum só acessa o módulo com **liberação no cadastro**: aba **Domain Manager** no modal de usuário (Gestão de Equipe), visível só para o Super Admin e só com o módulo ativo, ao lado da aba do SPFBL. Vale para criar e para editar o usuário.
- O acesso é **somente leitura** a **1 a 100 domínios escolhidos**: o usuário vê a lista (busca, paginação 20/40/100), abre os detalhes (status, DNS, DNSSEC, SSL e mudanças) e usa o botão de consulta. Não cadastra, não importa, não remove, não vê nem configura alertas e não altera as consultas automáticas. Esses controles nem aparecem na tela dele.
- **Escopo no servidor**: a lista, o detalhe e a consulta só alcançam os domínios liberados. Um domínio fora da liberação responde **404** (não 403), para não revelar que ele existe; a busca nunca sai do escopo. Para o usuário comum a resposta não traz as configurações nem o resumo de alertas.
- **Vale a cada requisição**: revogar, desativar a conta, desligar o módulo, ou remover o domínio do sistema tira o acesso na hora. Um admin que não é Super Admin não tem acesso implícito. O Super Admin não recebe liberação (já tem acesso).
- Conceder ou revogar exige **reautenticação** ligada ao usuário-alvo (propósito `domain_manager_access:<id>`), como no SPFBL, e é auditado (`domain_manager_access_saved` e `domain_manager_access_revoked`, com o alvo e a quantidade de domínios). Salvar sem mexer na aba não pede reautenticação.
- Migration `37_domain_manager_user_access.sql` (`dm_user_access`, `dm_user_domains`). Rotas: `GET /domains`, `GET /domains/:id` e `POST /domains/:id/check` aceitam também contas liberadas; `GET /access`, `GET /access/domains`, `PUT|DELETE /access/:userId` são do Super Admin.

## Como a consulta funciona
- **RDAP** (RFC 9083). O servidor de cada extensão vem da tabela pública da IANA (`data.iana.org/rdap/dns.json`, renovada a cada 24 h); `.br` usa `rdap.registro.br`. O endereço do registro nunca vem do usuário.
- **Extensões sem RDAP** na tabela (por exemplo `.io`, `.co`, `.de`) aparecem como "Extensão sem consulta RDAP"; a data de vencimento delas depende da fase de API de apoio.
- Registros que não publicam data (alguns `.br` institucionais) aparecem como "Sem data de vencimento publicada".
- A data é a do dia em Brasília (o RDAP envia um instante, não um dia).
- **Ritmo e proteção**: no máximo 1 consulta por segundo por registro, 5 domínios por rodada de 1 minuto. Três respostas de limite seguidas (o Registro.br responde 403 de forma intermitente) pausam as rodadas por 15 minutos. Falhas repetem em 6 h (1 h se for limitação).
- **Privacidade (LGPD)**: dados de titular (CPF/CNPJ, contatos) são descartados na entrada e nunca gravados nem registrados em log. Fica só o nome do registrador.
- **SSL do domínio raiz**: aperto de mão TLS na porta 443, sem enviar dados; lê validade, emissor e protocolo mesmo de certificado vencido ou não confiável. Como o nome é digitado por usuários, a conexão aceita só IPv4 público e é fixada ao IP resolvido, com prazo curto.

## Agendamento e reinício
A fila vive no banco: o turno de cada domínio é reservado com um `UPDATE` condicional (`SKIP LOCKED`), então reinício do backend ou uma segunda instância não duplicam consultas, e um turno reservado que não terminou volta à fila em 30 minutos. Não usa lock consultivo.

## Dados
Tabelas `dm_settings`, `dm_domains`, `dm_snapshots` (último resultado), `dm_changes` (mudanças), `dm_alert_settings`, `dm_notifications_sent`, `dm_user_access` e `dm_user_domains`. Migrations `35_domain_manager.sql`, `36_domain_manager_alerts.sql` e `37_domain_manager_user_access.sql`, aditivas; entram no backup como opcionais.

## API (`/api/domain-manager`, Super Admin, módulo ativo)
`GET /domains`, `POST /domains`, `POST /domains/import`, `GET /domains/:id`, `DELETE /domains/:id` (só os manuais), `POST /domains/:id/check`, `GET|PUT /settings`.

## Não verificado
A consulta foi testada com respostas simuladas e verificada à mão contra respostas reais do RDAP, mas o ritmo aceito pelo Registro.br deve ser medido na rede onde o sistema roda.
