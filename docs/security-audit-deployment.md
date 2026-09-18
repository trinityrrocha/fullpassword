# Implantação de teste e recuperação — PR #3

Este roteiro não autoriza alterar produção. Nenhuma etapa remota foi executada.

## Pré-condições obrigatórias

1. O responsável confirmou em 2026-09-18 que pw.sti1.com.br é exclusivamente
   de homologação e autorizou update web. Essa condição não precisa ser
   perguntada novamente. Ainda é necessário identificar host, SHA e digests
   efetivamente instalados; health com `unknown` não basta.
2. Pausar escritores/agendadores e obter backup consistente cifrado de banco e
   volumes. Guardar JWT_SECRET, CONFIG_ENCRYPTION_KEY, certificados e frase do
   backup em custódia separada, nunca no Git ou em comandos deste relatório.
3. Restaurar a cópia em outra instalação isolada e verificar login/MFA/cofres e
   configurações. Registrar checksum, tamanho, revisão/schema e responsável.
4. Executar inventário SQL somente de metadados. Agendar presença dos titulares:
   identidade ausente bloqueia migração de cofres compartilhados. Guardar os
   originais cifrados até aprovação e fim da retenção definida pelo operador.
5. Revisar PR e executar CI. Construir/publicar imagens do SHA exato aprovado;
   registrar digests. O CI atual constrói, mas NÃO publica nem assina releases.

## Autoridade de release

O operador provisiona `/etc/fullpassword/release-policy.json`, chave pública e
compose protegido em diretórios root sem escrita por grupo/outros. Não confiar
em chave obtida da própria release. Manter a chave privada de assinatura fora
da aplicação, do repositório e das imagens.

Campos da política: `environment: "test"`, `origin` da homologação,
`approvedRevision` (SHA completo), `publicKeyFile`, `composeFile`,
`recoveryArchive`, `recoverySha256`, `restoreVerified: true`.
`restoreVerified` é uma atestação do operador, não um teste automático do script.

Manifesto assinado (bytes exatos, RSA-SHA256) contém `repository` igual a
`trinityrrocha/fullpassword`, `revision` de 40 hex, `origin`, `backend` e
`frontend`, sendo imagens `ghcr.io/trinityrrocha/fullpassword-SERVICO@sha256:DIGEST`.
Assinatura binária separada. Política aprova uma revisão específica, impedindo
replay de outra release apenas por ter assinatura válida.

Executar o wrapper `scripts/update.sh manifest.json manifest.sig` somente como
operador autorizado no host de teste. O script registra IDs anteriores e valida
health/SHA depois de subir imagens, sem build de main. Não usa Docker socket
montado na aplicação; o processo operador ainda possui privilégio Docker.

## Migrações e privilégios

- As migrações são aditivas. Rodar `node backend/scripts/migrate-schema.js`
  previamente como dono do schema, com o ambiente protegido do operador.
- Provisionar papel runtime conforme `database/provision-runtime-role.sql` e
  senha por canal interativo; configurar backend para esse papel e
  `DB_SCHEMA_MODE=verify`. Não entregar credenciais do dono ao runtime.
- Validar acesso aos volumes de backup pelo UID node antes de iniciar a imagem
  não-root. Não executar chown recursivo indiscriminado sobre dados do host.
- Preservar segredos operacionais. `update.sh` não gera nova chave quando falta
  CONFIG_ENCRYPTION_KEY; falta de configuração exige correção consciente.
- Rodar inventário antes/depois. Confirmar contagens por cofre, estado do staging,
  envelopes por destinatário e abertura do conteúdo com dados sintéticos.

## Recuperação

O script tenta restaurar imagens anteriores se a saúde inicial falhar. Isso é
rollback de aplicação, NÃO rollback do banco. Manter entrada externa fechada
até concluir saúde e verificação; não permitir clientes migrarem durante essa
janela. Após ativar epochs v2, voltar a código antigo isoladamente é inseguro.

Se houver falha após migração de dados: parar escritores/agendadores, preservar
uma cópia cifrada do estado de falha e restaurar banco+volumes+segredos e imagens
compatíveis a partir da recuperação verificada. Comparar contagens e abrir
cofres/MFA/configurações antes de reabrir o serviço. Não apagar staging/originais
para obter um status verde. Não usar reset destrutivo de identidade.

O deploy agora usa trava exclusiva e exige SHA completo no health do backend
e no version.json da imagem frontend. Uma trava deixada por crash não deve ser
apagada automaticamente: investigar estado de imagens/banco e recuperar
antes de autorizar nova tentativa. Timeout de comando não comprova rollback.

## Continuação de homologação e update web

O painel antigo prometia atualizar main, mas a API já recusava essa operação.
Nesta continuação ele passa a ser somente leitura e não inicia contagem de
sucesso nem oferece inicializar versão mediante deploy de main. O frontend
publica version.json com SHA completo; unknown/ausente não é revisão comprovada.

O desenho preparado para manter o update web seguro está em
[security-web-update-design.md](security-web-update-design.md).
**A ponte web/agente ainda não está implementada ou instalada.** Não é correto
afirmar que o código do PR, ainda não implantado, atualiza o painel existente.

A skill computer-use proíbe automação de gerenciadores de senhas e diálogos de
autenticação. Portanto, esta execução não faz login, update nem testes remotos
por UI ou por HTTP alternativo. O responsável deverá executar o roteiro manual;
nenhum resultado visual será atribuído ao PR sem revisão instalada comprovada.

Registro manual obrigatório após implantação autorizada:

| Campo | Valor nesta execução |
|---|---|
| Revisão frontend instalada | Não comprovada |
| Revisão backend instalada | Não comprovada |
| SHA/digests aprovados para implantação | Não provisionados |
| Backup do host e restauração isolada desse backup | Não executados |
| Acionamento único do update web | Não executado |
| Início/fim da implantação | Não aplicável |
| Início/fim da espera de pelo menos 60 segundos | Não aplicável |
| Testes funcionais remotos | Não executados |

Não confundir a restauração de fixtures em PostgreSQL local com recuperação
validada do host. Não configurar restoreVerified antes dessa comprovação.

## Roteiro visual manual (não executado)

Usar exclusivamente contas e cofres fictícios próprios em cópia autorizada:

1. Provisionar duas contas; login inicial não deve desbloquear cofre. Configurar
   segredo independente e MFA; confirmar que senha de login não abre identidade.
2. Criar dois cofres e registros nas abas Hospedagem, VPN, Windows, Linux e
   Dispositivos; salvar, reabrir, editar, baixar anexos e abrir resumo de Clientes.
3. Compartilhar com inclusão apenas: adicionar funciona sem alterar/excluir
   anteriores. Editor sem exclusão edita, leitor só lê. Verificar API além de UI.
4. Remover um grupo mantendo outro: acesso continua. Remover último: acesso é
   negado e proprietário renova época antes de novas gravações.
5. Com cópia legada sintética, interromper após staging; reabrir e retomar.
   Contagens/histórico/anexos devem conferir; original cifrado deve continuar.
6. Bloquear por inatividade/manual e reload: plaintext/keys não reaparecem;
   desbloqueio exige segredo independente. Conferir desktop/mobile e erros.
7. Trocar senha de login, recuperar login, mudar e-mail com confirmação e
   reautenticar ações administrativas. A identidade/cofres não podem mudar
   silenciosamente; sessões antigas devem ser recusadas.
8. Backup cifrado e restauração em segunda instalação: abrir os mesmos cofres,
   autenticar MFA e testar SMTP em capturador/caixa dedicada. Nunca cliente real.
9. Ensaiar deploy exato e recuperação com entrada externa fechada. Conferir
   UID, papel PostgreSQL, ausência de socket, headers/cache, limites de upload e
   hash de todas as imagens. Preservar evidências sanitizadas, sem ciphertext,
   códigos MFA, tokens, senhas ou conteúdo de cofres nos relatórios.

Pendentes operacionais: proteção de branch/rulesets, confiança de assinatura,
publicação em registry, identidade/recuperação do host, validação do proxy e
revisão independente do desenho criptográfico. PR deve continuar draft.
