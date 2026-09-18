# Preparação do update web por release assinada

Estado em 2026-09-18: **desenho de implementação, não agente executável**.
O deploy assinado por operador já existe; a ponte web abaixo ainda precisa de
implementação e ensaio isolado. Não deve ser habilitada por configuração apenas.
Nenhuma instalação remota foi feita e não houve merge do PR #3.

## Problema confirmado

A rota POST /api/system/update retorna 503 OPERATOR_APPROVED_RELEASE_REQUIRED.
O serviço antigo com socket Docker foi removido do compose. O frontend ainda
apresentava o fluxo antigo de main; isso foi corrigido para estado indisponível
explícito e leitura de versões. O antigo volume updater_requests não constitui
uma autoridade de release: o backend pode escrevê-lo. Não reutilizá-lo como
fonte confiável de manifestos, chaves, política, status ou comandos.

## Contrato proposto

1. Operador instala fora dos containers um agente mínimo, inicialmente parado.
   Chave pública, política, manifesto assinado, assinatura, compose e catálogo
   são protegidos contra escrita pelo UID do backend e seus grupos. Chave
   privada fica fora do host da aplicação. Manifesto fixa repositório, URL teste,
   SHA completo, imagens por digest e identidade do pipeline de aprovação.
2. Após restauração verificada, operador aprova UMA release e publica catálogo
   somente leitura para o backend: ID aleatório de aprovação, SHA, digests,
   validade curta, checksum do manifesto e confirmação de disponibilidade.
   Catálogo não contém segredos ou caminhos de arquivos privilegiados.
3. Super Admin vê destino/SHA/digests exatos e confirma mediante CSRF, senha
   recente e MFA quando habilitado. Concessão de reauth deve vincular sessão,
   finalidade system_release e hash de ID+SHA+manifesto. Sessão comum/admin
   comum não pode criar solicitações. A autorização atual de perfil não basta.
4. Backend cria pedido limitado e idempotente contendo somente ID de aprovação
   e identificador de pedido. Não aceita comandos, URLs, branch, compose,
   variáveis de ambiente, caminhos, nomes de imagem ou opções Docker do cliente.
   Permissão de escrita na fila não confere autoridade de escolher release.
5. Agente externo lê fila não confiável com limites de tamanho/quantidade,
   recusa symlinks/não-arquivos/JSON desconhecido e revalida assinatura,
   política, expiração, origin e revisão. Usa somente caminhos fixados na
   política root. Lock exclusivo e ledger root durável consomem aprovação uma
   única vez ANTES do primeiro efeito. Crash não permite retry automático;
   operador reconcilia o estado e, se necessário, emite nova aprovação.
6. Com escritores/agendadores pausados e recuperação comprovada, agente
   invoca o deploy de argumentos fixos. Sem shell, sem socket na aplicação,
   sem clone/pull/build de main. Runtime do banco usa papel DML; migração
   privilegiada é etapa separada. Não substituir segredos operacionais.
7. Status sanitizado é escrito pelo agente e montado somente leitura no backend:
   approvalId, requestId, SHA, estado, timestamps UTC, código de erro estável,
   hashes das imagens/recuperação, sem stdout livre ou credenciais.
   A tela consulta status com GET; nunca repete POST após timeout/reinício.
8. Conclusão exige backend saudável com SHA completo e version.json do frontend
   com o mesmo SHA, além da identidade dos digests em execução. Só então começa
   a espera adicional mínima de 60 segundos. Registrar início/fim e testar
   disponibilidade, schema e revisão novamente antes dos cenários funcionais.

## Primeira instalação

O código antigo não conhece essa ponte; ela exige bootstrap manual autorizado,
incluindo imagens do SHA revisado, assinatura fora da aplicação e mounts
read-only/read-write separados. Não usar o botão antigo para instalar main.
O CI atual valida imagens, mas não publica nem assina uma release.
Não há digests publicados aprovados nesta execução.

O responsável já autorizou a homologação. A intervenção indispensável é
operacional: identificação do host/mecanismo e versões, custódia de recuperação,
build/publicação/assinatura verificados e bootstrap do agente após implementado.
Não enviar chaves privadas, credenciais ou backups em comentários do PR.

## Testes de aceitação antes de habilitar a ponte

- Assinatura adulterada, origem/repositório/revisão divergentes, tag mutável,
  validade expirada, política gravável, catálogo/status falsos: rejeição.
- Pedido com path traversal, comando, URL, symlink, FIFO, arquivo grande ou
  JSON extra: rejeição sem execução privilegiada.
- Pedido repetido/concurrente/replay após crash: no máximo uma implantação.
- Super Admin sem reauth/CSRF/MFA, propósito/payload/sessão diferentes: negação.
- Falhas em pull, migração, boot, backend SHA, frontend SHA e rollback:
  estado não concluído, recuperação explícita, sem reabertura automática.
- Testar recuperação de banco+volumes+segredos em SEGUNDA instância. Rollback
  de imagens sozinho não reverte migração de dados.

Esses testes do agente não foram executados porque o agente ainda não existe.
Os testes de assinatura/revisão do deploy por operador existem e são separados.
