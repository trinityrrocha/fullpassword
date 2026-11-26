# Dashboard

Página `/dashboard`, só para o Super Admin (menu "Dashboard", primeiro item). Resume em cartões o que precisa de atenção. Cada cartão leva à página de origem pelo ícone no canto.

| Cartão | O que mostra | Origem | Precisa do módulo |
|---|---|---|---|
| Saúde dos domínios | % de domínios saudáveis (sem vencimento em 30 dias e com SPF, DKIM e DMARC válidos), vencidos, a vencer, certificados com problema e barras de SPF/DKIM/DMARC | Domain Manager | Domain Manager |
| Próximos vencimentos | os 8 domínios com vencimento mais próximo (vencidos primeiro) | Domain Manager | Domain Manager |
| Alertas de segurança | ocorrências dos últimos 7 dias (as mesmas do sino de notificações) | trilha de auditoria | — |
| Desbloqueios pendentes | solicitações do SPFBL pendentes ou reabertas e a idade da mais antiga | SPFBL | SPFBL |
| Remetentes mais bloqueados | domínios de remetentes com mais mensagens bloqueadas nos últimos 30 dias, há quanto tempo aparecem e quantos domínios atingem | histórico coletado do SPFBL | SPFBL |
| Logins e bloqueios | logins, falhas e IPs com falha nas últimas 24 h e bloqueios de IP ativos | trilha de auditoria e regras de IP | — |
| Últimos logins | os 8 logins mais recentes (e-mail, IP, quando) | trilha de auditoria | — |
| Último backup | último backup concluído (destino, tamanho, quando) e aviso se a tentativa mais recente falhou | execuções de backup | — |

- **País de origem não existe**: o SPFBL não informa onde fica o remetente. O dashboard não inventa esse dado; mostrar país exigiria consultar um serviço de geolocalização de IP, o que não foi feito.
- **"Há quanto tempo"** de um remetente vale dentro do histórico coletado (retenção de 30, 60 ou 90 dias do SPFBL; o cartão olha os últimos 30).
- **Módulo desligado** não é erro: o cartão avisa qual módulo ativar. Um cartão que falha mostra o aviso sozinho e não derruba os outros.
- **Personalização por conta**: o ícone de configurações escolhe os cartões e a ordem; os cartões também podem ser arrastados na página (ou movidos com as setas do teclado no ícone de arrastar). A disposição fica na tabela `user_dashboard_layouts` (migration 40), não entra nos backups e um cartão novo, criado por uma atualização, aparece no fim da lista.
- **API** (`/api/dashboard`, Super Admin): `GET /` (todos os cartões e a disposição numa só chamada), `PUT /layout`, `DELETE /layout`. A página atualiza sozinha a cada 2 minutos enquanto está visível.
- Nada do dashboard envia dados a serviços externos.
