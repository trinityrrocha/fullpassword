// Builders for the DMARC and SPF records shown by the generator dialog. Pure functions: the dialog only edits the input and prints the result.
const EMAIL = /^[^\s@;,!?]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const HOST = /^(?=.{4,253}$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)+$/i;
export const splitList = (text) => [...new Set(String(text || '').split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];

// ---------- DMARC ----------
export const DMARC_DEFAULTS = Object.freeze({ policy: 'reject', subPolicy: 'reject', adkim: 's', aspf: 's', pct: '100', rua: '', ruf: '', fo: '0', ri: '86400' });
const POLICY_TEXT = Object.freeze({
  none: 'Só monitora: nenhum e-mail é bloqueado, apenas relatado. Bom para começar.',
  quarantine: 'E-mails que falham na validação vão para a caixa de spam.',
  reject: 'Rejeita sumariamente qualquer e-mail que falhe na validação DMARC: nem chega ao spam, o servidor de destino recusa na conversa SMTP.'
});
const SUB_TEXT = Object.freeze({
  none: 'Subdomínios sem registro próprio só são monitorados.',
  quarantine: 'Subdomínios sem registro próprio têm os e-mails que falham enviados ao spam.',
  reject: 'Aplica a rejeição a qualquer subdomínio (ex.: mail.seudominio.com.br) que não tenha um registro DMARC próprio.'
});
const FO_TEXT = Object.freeze({ 0: 'Relatório de falha só se SPF e DKIM falharem juntos.', 1: 'Relatório de falha se qualquer verificação falhar.', d: 'Relatório se a assinatura DKIM falhar.', s: 'Relatório se o SPF falhar.' });

const mailtoAddresses = (text, label, errors) => {
  const list = splitList(text).map((item) => item.replace(/^mailto:/i, ''));
  if (list.length > 5) errors.push(`${label}: use no máximo 5 endereços.`);
  for (const address of list) if (!EMAIL.test(address)) errors.push(`${label}: "${address.slice(0, 60)}" não é um e-mail válido.`);
  return list.slice(0, 5);
};

export const buildDmarc = (input) => {
  const form = { ...DMARC_DEFAULTS, ...input };
  const errors = [];
  const warnings = [];
  const rua = mailtoAddresses(form.rua, 'Relatórios agregados', errors);
  const ruf = mailtoAddresses(form.ruf, 'Relatórios de falha', errors);
  const pctText = String(form.pct).trim();
  const pct = Number(pctText);
  if (!/^\d{1,3}$/.test(pctText) || pct < 1 || pct > 100) errors.push('Porcentagem: informe um número de 1 a 100.');
  const interval = Number(String(form.ri).trim());
  if (!/^\d{1,9}$/.test(String(form.ri).trim()) || interval < 60) errors.push('Intervalo dos relatórios: informe segundos (mínimo 60).');
  const parts = [{ tag: 'v', value: 'DMARC1', text: 'Versão do protocolo DMARC. Obrigatória e deve ser sempre a primeira tag.' }];
  parts.push({ tag: 'p', value: form.policy, text: POLICY_TEXT[form.policy] || '' });
  if (form.subPolicy && form.subPolicy !== 'same') parts.push({ tag: 'sp', value: form.subPolicy, text: SUB_TEXT[form.subPolicy] || '' });
  if (Number.isInteger(pct) && pct >= 1 && pct < 100) parts.push({ tag: 'pct', value: String(pct), text: `A política vale para ${pct}% das mensagens; as demais são tratadas como p=none.` });
  if (form.adkim === 's') parts.push({ tag: 'adkim', value: 's', text: 'Alinhamento DKIM estrito: o domínio da assinatura DKIM (d=) deve ser exatamente igual ao domínio do cabeçalho From: (subdomínios não passam).' });
  if (form.aspf === 's') parts.push({ tag: 'aspf', value: 's', text: 'Alinhamento SPF estrito: o domínio autenticado no Return-Path (MAIL FROM) deve ser exatamente igual ao domínio do cabeçalho From:.' });
  if (rua.length) parts.push({ tag: 'rua', value: rua.map((address) => `mailto:${address}`).join(','), text: 'Para onde vão os relatórios agregados (resumo diário de quem enviou e-mail em nome do domínio).' });
  if (ruf.length) {
    parts.push({ tag: 'ruf', value: ruf.map((address) => `mailto:${address}`).join(','), text: 'Para onde vão os relatórios de falha (um por mensagem reprovada). Muitos provedores não os enviam.' });
    if (form.fo !== '0') parts.push({ tag: 'fo', value: form.fo, text: FO_TEXT[form.fo] || '' });
  }
  if (Number.isInteger(interval) && interval !== 86400 && interval >= 60) parts.push({ tag: 'ri', value: String(interval), text: 'Intervalo, em segundos, entre os relatórios agregados.' });
  if (form.policy === 'none') warnings.push('p=none apenas monitora. Depois de conferir os relatórios, passe para quarantine ou reject.');
  if (form.policy === 'reject' && rua.length === 0) warnings.push('Sem relatórios agregados você não verá quem está falhando. Se for proposital, tudo bem.');
  return { record: parts.map((part) => `${part.tag}=${part.value}`).join('; '), parts, errors, warnings, valid: errors.length === 0 };
};

// ---------- SPF ----------
export const SPF_PROVIDERS = Object.freeze([
  { id: 'google', label: 'Google Workspace', include: '_spf.google.com' },
  { id: 'microsoft', label: 'Microsoft 365', include: 'spf.protection.outlook.com' },
  { id: 'ses', label: 'Amazon SES', include: 'amazonses.com' },
  { id: 'sendgrid', label: 'SendGrid', include: 'sendgrid.net' },
  { id: 'mailgun', label: 'Mailgun', include: 'mailgun.org' },
  { id: 'mandrill', label: 'Mailchimp Transactional', include: 'spf.mandrillapp.com' },
  { id: 'zoho', label: 'Zoho Mail', include: 'zoho.com' }
]);
export const SPF_DEFAULTS = Object.freeze({ mx: true, a: false, ips: '', providers: [], includes: '', all: '-all' });
const ALL_TEXT = Object.freeze({
  '-all': 'Rejeita e-mails de qualquer servidor que não esteja na lista (recomendado).',
  '~all': 'Aceita, mas marca como suspeito, e-mails de servidores fora da lista (soft fail). Prefira -all.',
  '?all': 'Neutro: não protege o domínio. Evite.'
});
const validIpv4 = (value) => {
  const [address, prefix, ...rest] = value.split('/');
  if (rest.length || !/^\d{1,3}(\.\d{1,3}){3}$/.test(address) || address.split('.').some((part) => Number(part) > 255)) return false;
  return prefix === undefined || (/^\d{1,2}$/.test(prefix) && Number(prefix) <= 32);
};
const validIpv6 = (value) => {
  const [address, prefix, ...rest] = value.split('/');
  if (rest.length || !address.includes(':') || !/^[0-9a-f:]+$/i.test(address) || address.includes(':::')) return false;
  const sides = address.split('::');
  if (sides.length > 2) return false;
  const groups = sides.map((side) => (side === '' ? [] : side.split(':')));
  const all = groups.flat();
  if (all.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return false;
  if (sides.length === 1 ? all.length !== 8 : all.length > 7) return false;
  return prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) <= 128);
};

export const buildSpf = (input) => {
  const form = { ...SPF_DEFAULTS, ...input };
  const errors = [];
  const warnings = [];
  const parts = [{ term: 'v=spf1', text: 'Versão do SPF. Obrigatória e deve ser o primeiro termo.' }];
  let lookups = 0;
  if (form.mx) { parts.push({ term: 'mx', text: 'Autoriza os servidores de e-mail (MX) do próprio domínio.' }); lookups += 1; }
  if (form.a) { parts.push({ term: 'a', text: 'Autoriza o endereço do site (registro A) do próprio domínio.' }); lookups += 1; }
  for (const item of splitList(form.ips)) {
    if (validIpv4(item)) parts.push({ term: `ip4:${item}`, text: `Autoriza o endereço IPv4 ${item}.` });
    else if (validIpv6(item)) parts.push({ term: `ip6:${item}`, text: `Autoriza o endereço IPv6 ${item}.` });
    else errors.push(`Endereço IP inválido: "${item.slice(0, 50)}".`);
  }
  const chosen = SPF_PROVIDERS.filter((provider) => form.providers.includes(provider.id)).map((provider) => ({ include: provider.include, label: provider.label }));
  for (const host of splitList(form.includes).map((item) => item.replace(/^include:/i, '').toLowerCase())) {
    if (HOST.test(host)) chosen.push({ include: host, label: host }); else errors.push(`Domínio inválido: "${host.slice(0, 60)}".`);
  }
  const seen = new Set();
  for (const item of chosen) {
    if (seen.has(item.include)) continue;
    seen.add(item.include);
    parts.push({ term: `include:${item.include}`, text: `Autoriza os servidores de ${item.label}.` });
    lookups += 1;
  }
  if (parts.length === 1) warnings.push('Nenhum servidor autorizado: com -all, nenhum e-mail do domínio passará no SPF.');
  if (!ALL_TEXT[form.all]) errors.push('Escolha como terminar o registro.');
  parts.push({ term: form.all, text: ALL_TEXT[form.all] || '' });
  if (form.all === '~all') warnings.push('~all (soft fail) deixa passar e-mail falso para a caixa de spam. Recomendamos -all.');
  if (form.all === '?all') warnings.push('?all é neutro e não protege o domínio. Recomendamos -all.');
  if (lookups > 10) errors.push(`Consultas DNS demais: ${lookups}. O SPF permite no máximo 10, contando também as consultas dentro de cada include.`);
  else if (lookups >= 8) warnings.push(`${lookups} consultas DNS contadas. O limite é 10 e cada include pode gastar mais algumas.`);
  const record = parts.map((part) => part.term).join(' ');
  if (record.length > 450) errors.push('O registro ficou grande demais para um TXT comum. Remova alguns itens.');
  else if (record.length > 255) warnings.push('O registro passa de 255 caracteres: no painel de DNS ele deve ser dividido em duas partes entre aspas (a maioria dos provedores faz isso sozinha).');
  return { record, parts, lookups, errors, warnings, valid: errors.length === 0 };
};
