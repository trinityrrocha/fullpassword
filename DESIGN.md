---
version: alpha
name: FullPassword
description: Console administrativa compacta para cofres e operações de segurança.
colors:
  primary: "#4f46e5"
  background: "#f9fafb"
  surface: "#ffffff"
  dark-surface: "#0f172a"
  danger: "#dc2626"
typography:
  sans:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
  mono:
    fontFamily: "ui-monospace, monospace"
rounded:
  DEFAULT: "0.25rem"
  lg: "0.5rem"
spacing:
  page-max: "80rem"
  control-x: "0.75rem"
components:
  button: {}
  card: {}
  dialog: {}
---

# FullPassword Design System

## Overview

### Creative North Star

Uma console de operação: identificação exata, consequências claras e estado verificável,
sem ornamentação que concorra com dados administrativos.

### Product context and register

Administradores e titulares de cofres; interface existente em pt-BR. Mercado não
inferido do idioma. Registro de produto, uso frequente em desktop com reflow mobile.
Preservar a identidade visual existente; esta etapa não redesenha telas antigas.
Anti-referência: painéis promocionais, gradientes decorativos e progresso inventado.
Tokens são espelho documental, não geradores: fonte canônica é
frontend/tailwind.config.js + frontend/src/index.css (modelo runtime existente).
O diff de classes e ESLint/build são o gate de deriva nesta fatia.

## Colors

Indigo 600 nos pedidos primários, slate para informação técnica, red para falhas.
As classes dark e a camada de compatibilidade de index.css mantêm contraste.
Não comunicar sucesso exclusivamente por cor.

## Typography

Stack padrão Tailwind sans; SHA e digests em mono, quebrando linhas sem truncar.
Labels e erros em português; evitar conteúdo técnico bruto em mensagens de falha.

## Layout

Settings conserva max-w-7xl e accordion existente. Os novos painéis usam fluxo
natural, gaps e grid de duas colunas somente a partir de sm. Sem viewport fixo
no shell e sem nova rolagem vertical dentro de cards.

## Elevation & Depth

Cards discretos com borda; diálogo de reauth usa overlay existente, sem criar
uma nova família de modais. Nenhuma elevação decorativa em dados de release.

## Shapes

Rounded em controles, rounded-lg em cards; seguir o runtime, não duplicar tokens CSS.

## Components

### Foundational visual states

Região reservada de status; erro persistente com retry de GET. Botões busy e
disabled têm texto e semântica, sem percentual de implantação fictício.

### Buttons and actions

Native button, type explícito, foco visível. Solicitar release é a única ação
primária. Consultar progresso não repete o POST. Pedidos bloqueados explicam o motivo.

### Navigation and data display

O painel de itens é read-only no contexto Clientes. Metadados e valores longos
quebram responsivamente; nenhuma nova tabela ou seleção foi introduzida.

### Forms and overlays

ReauthDialog é o owner de confirmação sensível: portal, background inert,
foco contido/restaurado, Escape quando o request não está pendente, noValidate.
Senhas mascaradas por padrão; toggle acessível e MFA opcional conforme backend.
Atualizações não usam alert/confirm/prompt nem modal paralelo.

### Iconography

Lucide no produto existente. A fatia nova usa labels textuais para ações críticas.

### Motion

Sem animação nova. Estado muda quando existe evidência do agente, não por contador.

### Content and data visualization

Datas técnicas em UTC no contrato do agente; interface pt-BR. Progresso textual
por fase. Conteúdo de cofres só em memória e nunca em logs ou notificações.

## Do's and Don'ts

- Do: exibir SHA e digests aprovados completos.
- Do: manter permissões efetivas na API além do gating visual.
- Don't: confundir saúde com recuperação ou validação funcional completa.
- Don't: criar aprovação, segredo ou comando a partir de campos do navegador.
