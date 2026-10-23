# Interação dos modais de cliente e grupo

## Diagnóstico

Base: 7deaa8236b541dc275befb93a95d04726cbf7b90. Novo Cliente, Novo Grupo e Editar
Grupo mantinham a estrutura legada: backdrop `fixed` e painel `inline-block`
sem posicionamento/z-index explícitos, dependendo implicitamente de `transform`
para empilhamento. No CSS atual o painel fica estático e o backdrop recebe os
cliques sobre os campos. A reprodução local verifica `elementFromPoint` e
cliques reais (sem `force`/dispatch artificial) nos três formulários.

## Correção e invariantes

Os três formulários passam a usar FormDialog, owner existente: portal no body,
painel relative/z-10 acima do backdrop local z-0, foco inicial, trap, Escape,
retorno ao trigger, fundo inert, corpo rolável e footer persistente. Nenhuma
mudança no componente base nem nos tokens globais. A mesma confirmação de
descarte já usada em Perfil/Equipe protege dados não salvos.

Labels são associados aos campos; checkValidity conserva required/type=email,
com noValidate e feedback inline. Falha do servidor mantém os valores e o diálogo
aberto. Ref de envio impede requisição duplicada antes do próximo render.
Endpoints, payloads, permissões dos grupos e restrições de Administradores são
preservados. Nenhum backend, schema, segredo ou conteúdo real de cofre é alterado.

## Teste reproduzível

`npm run test:modal-interaction:browser` usa Playwright e um Vite localhost com os
componentes reais, React StrictMode e CSS reais; todas as APIs são interceptadas
com registros fictícios e qualquer destino externo é rejeitado. É teste de UI,
não prova de implantação ou de persistência no banco real.

Configurar PLAYWRIGHT_MODULE_PATH se Playwright não estiver instalado no projeto;
PLAYWRIGHT_CHANNEL=chrome é opcional. MODAL_UI_EVIDENCE_DIR guarda screenshots e
result.json. MODAL_BASELINE=1 carrega os dois arquivos legados via git show da base
acima, sem checkout/reset, e confirma a regressão antes da correção.

Cobertura: 1280/768/390, claro/escuro, movimento reduzido, hit-test de controles,
clique/digitação, nome/endereço/telefone/e-mail, descrição, permissões e membros,
dados preenchidos em editar, salvar/cancelar, falha/retry, duplicação, teclado,
Escape/backdrop, descarte/continuar e modal irmão Novo Membro.
O workflow security-regression executa o teste em Chromium e preserva evidências
sintéticas. A homologação humana da instalação ocorre somente após WebUpdate.
