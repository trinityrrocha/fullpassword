import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import FormDialog from '../FormDialog';
import { addDomain, getDomainAlerts, getDomainDetail, getDomainMailSettings, importDomains, saveDomainAlerts, saveDomainMailSettings, saveDomainSettings } from '../../services/domainManagerService';
import { describeError, formatDateTime, formatDay, formatIsoDateTime } from '../../utils/spfbl';
import { DKIM_SELECTOR_LIMIT, DOMAIN_SELECTOR_LIMIT, MAX_ALERT_EMAILS, MAX_IMPORT, mailMarker, mailMessages, mailStatusLabel, parseSelectorList, parseServerList, selectorProblems, serverProblems, SOURCE_LABELS, canSaveAlerts, isValidEmail, changeValue, dnssecLabel, errorLabel, expiryInfo, fieldLabel, lookupLabel, parseDomainList, sslLabel, TONE_CLASSES } from '../../utils/domainManager';

const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';
const primaryButton = 'rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60';
const secondaryButton = 'rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60';
const errorBox = 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800';

export function AddDomainDialog({ onClose, onDone }) {
  const [mode, setMode] = useState('one');
  const [name, setName] = useState('');
  const [list, setList] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const names = parseDomainList(list);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (mode === 'one') { await addDomain(name); await onDone(); onClose(); return; }
      const summary = await importDomains(names);
      setResult(summary);
      await onDone();
    } catch (failure) {
      setError(describeError(failure, 'Não foi possível cadastrar.'));
    } finally { setBusy(false); }
  };

  return (
    <FormDialog title="Adicionar domínios" description="Cadastre um domínio ou cole uma lista. Cada domínio entra na fila de consulta automática." onClose={onClose} busy={busy} saved={Boolean(result)}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" data-dialog-cancel disabled={busy} className={secondaryButton}>{result ? 'Fechar' : 'Cancelar'}</button>
        {!result && <button type="submit" form="dm-add-form" disabled={busy || (mode === 'one' ? !name.trim() : names.length === 0 || names.length > MAX_IMPORT)} className={primaryButton}>{busy ? 'Cadastrando…' : 'Cadastrar'}</button>}
      </div>}>
      <form id="dm-add-form" onSubmit={submit} noValidate className="space-y-3">
        <div role="group" aria-label="Forma de cadastro" className="flex gap-2">
          {[['one', 'Um domínio'], ['many', 'Colar lista']].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setResult(null); setError(''); }}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${mode === value ? 'border-indigo-600 bg-indigo-50 text-indigo-800' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{label}</button>
          ))}
        </div>
        {mode === 'one' ? (
          <label className="block text-sm font-medium text-slate-700">Domínio
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength={253} autoComplete="off" spellCheck={false} placeholder="exemplo.com.br" className={`${fieldClass} mt-1`} />
          </label>
        ) : (
          <label className="block text-sm font-medium text-slate-700">Lista de domínios (até {MAX_IMPORT})
            <textarea value={list} onChange={(event) => setList(event.target.value)} rows={7} spellCheck={false} placeholder={'exemplo.com.br\noutro.com'} className={`${fieldClass} mt-1 font-mono`} />
            <span className="mt-1 block text-xs font-normal text-slate-600">{names.length} {names.length === 1 ? 'domínio' : 'domínios'} na lista{names.length > MAX_IMPORT ? ` — o máximo é ${MAX_IMPORT}` : ''}.</span>
          </label>
        )}
        {result && (
          <div role="status" className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
            {result.added} cadastrado(s), {result.duplicates} já estava(m) na lista{result.invalid.length ? `, ${result.invalid.length} inválido(s): ${result.invalid.slice(0, 5).join(', ')}${result.invalid.length > 5 ? '…' : ''}` : ''}.
          </div>
        )}
        {error && <p role="alert" className={errorBox}>{error}</p>}
      </form>
    </FormDialog>
  );
}

const Switch = ({ id, labelId, checked, onChange }) => (
  <button id={id} type="button" role="switch" aria-checked={checked} aria-labelledby={labelId} onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}>
    <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
  </button>
);
const validDays = (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 30 && String(value).trim() !== '';

// The one settings card of the Domain Manager (opened by the icon in the page header).
export function SettingsDialog({ settings, onClose, onSaved }) {
  const id = useId();
  const [days, setDays] = useState(String(settings.check_interval_days));
  const [mailOn, setMailOn] = useState(settings.mail_check_enabled !== false);
  const [mailDays, setMailDays] = useState(String(settings.mail_check_interval_days ?? 7));
  const [selectors, setSelectors] = useState((settings.dkim_selectors || []).join('\n'));
  const [servers, setServers] = useState((settings.dns_servers || []).join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (event) => {
    event.preventDefault();
    const selectorList = parseSelectorList(selectors);
    const serverList = parseServerList(servers);
    // Hidden fields are not validated and keep their saved values: turning the check off must never be blocked by a draft in a field you cannot see.
    const problem = (!validDays(days) && 'Informe o intervalo das consultas de vencimento de 1 a 30 dias.')
      || (mailOn && !validDays(mailDays) && 'Informe o intervalo da verificação de e-mail de 1 a 30 dias.')
      || (mailOn && (selectorList.length === 0 ? 'Informe ao menos um seletor DKIM.' : selectorProblems(selectorList, DKIM_SELECTOR_LIMIT))) || serverProblems(serverList);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      await saveDomainSettings({
        check_interval_days: Number(days), mail_check_enabled: mailOn,
        mail_check_interval_days: mailOn ? Number(mailDays) : Number(settings.mail_check_interval_days ?? 7),
        dkim_selectors: mailOn ? selectorList : (settings.dkim_selectors || []), dns_servers: serverList
      });
      await onSaved(); onClose();
    } catch (failure) { setError(describeError(failure, 'Não foi possível salvar.')); } finally { setBusy(false); }
  };
  return (
    <FormDialog title="Configurações do Domain Manager" description="Parâmetros das consultas automáticas." onClose={onClose} busy={busy}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" data-dialog-cancel disabled={busy} className={secondaryButton}>Cancelar</button>
        <button type="submit" form="dm-settings-form" disabled={busy} className={primaryButton}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>}>
      <form id="dm-settings-form" onSubmit={save} noValidate className="space-y-5">
        <section aria-labelledby={`${id}-expiry`} className="space-y-2">
          <h3 id={`${id}-expiry`} className="text-sm font-semibold text-slate-900">Vencimento e certificado</h3>
          <label className="block text-sm font-medium text-slate-700">Intervalo entre consultas (dias)
            <input type="number" min={1} max={30} step={1} value={days} onChange={(event) => setDays(event.target.value)} className={`${fieldClass} mt-1 max-w-32`} />
          </label>
          <p className="text-sm text-slate-600">Vale enquanto faltarem mais de 30 dias para o vencimento. A partir daí, e enquanto o domínio estiver vencido, a consulta passa a ser diária.</p>
        </section>
        <section aria-labelledby={`${id}-mail`} className="space-y-3 border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 id={`${id}-mail`} className="text-sm font-semibold text-slate-900">Autenticação de e-mail (SPF, DKIM e DMARC)</h3>
            <Switch id={`${id}-mail-switch`} labelId={`${id}-mail`} checked={mailOn} onChange={setMailOn} />
          </div>
          <p className="text-sm text-slate-600">Consulta o DNS de cada domínio e mostra na lista se o SPF, o DKIM e o DMARC estão configurados. Não envia dados a serviços externos.</p>
          {mailOn && (
            <>
              <label className="block text-sm font-medium text-slate-700">Intervalo entre verificações (dias)
                <input type="number" min={1} max={30} step={1} value={mailDays} onChange={(event) => setMailDays(event.target.value)} className={`${fieldClass} mt-1 max-w-32`} />
              </label>
              <label className="block text-sm font-medium text-slate-700">Seletores DKIM testados (um por linha)
                <textarea value={selectors} onChange={(event) => setSelectors(event.target.value)} rows={6} spellCheck={false} className={`${fieldClass} mt-1 font-mono`} />
                <span className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs font-normal text-slate-600">
                  <span>{parseSelectorList(selectors).length} de {DKIM_SELECTOR_LIMIT}. O DNS não lista os seletores de um domínio: só os desta lista (e os de cada domínio) são procurados.</span>
                  <button type="button" onClick={() => setSelectors((settings.default_dkim_selectors || []).join('\n'))} className="rounded px-1 font-medium text-indigo-700 underline">Restaurar a lista padrão</button>
                </span>
              </label>
            </>
          )}
        </section>
        <section aria-labelledby={`${id}-dns`} className="space-y-2 border-t border-slate-200 pt-4">
          <h3 id={`${id}-dns`} className="text-sm font-semibold text-slate-900">Servidores DNS</h3>
          <label className="block text-sm font-medium text-slate-700">Servidores DNS (opcional, um endereço IP por linha)
            <textarea value={servers} onChange={(event) => setServers(event.target.value)} rows={2} spellCheck={false} placeholder="vazio = usar o DNS do sistema" className={`${fieldClass} mt-1 font-mono`} />
            <span className="mt-1 block text-xs font-normal text-slate-600">Até 4 endereços IP. Deixe em branco para usar o DNS do próprio servidor. Valem para todas as consultas de DNS do módulo.</span>
          </label>
        </section>
        {error && <p role="alert" className={errorBox}>{error}</p>}
      </form>
    </FormDialog>
  );
}

const Row = ({ label, children }) => (
  <div className="grid grid-cols-3 gap-2 py-1.5 text-sm"><dt className="font-medium text-slate-600">{label}</dt><dd className="col-span-2 break-words text-slate-900">{children}</dd></div>
);

const MARK_TONE_CLASSES = Object.freeze({ ok: 'text-green-800', warning: 'text-amber-800', danger: 'text-red-800', muted: 'text-slate-600' });
const KEY_STATE = (key) => (key.revoked ? 'revogada' : key.bits ? `${key.key_type.toUpperCase()} ${key.bits} bits` : key.key_type === 'ed25519' ? 'Ed25519' : `${key.key_type} (tamanho desconhecido)`);
const ALIGN = Object.freeze({ r: 'relaxado', s: 'rígido' });

function MailBlock({ kind, title, section, mail, children }) {
  const marker = mailMarker(kind, mail);
  const messages = mailMessages(section);
  const noAnswer = section?.status === 'inconclusive';
  return (
    <div className="rounded-md border border-slate-200 p-3" data-mail-block={kind}>
      <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
        <span>{title}</span>
        <span className={`text-sm font-medium ${MARK_TONE_CLASSES[marker.tone]}`}><span aria-hidden="true">{marker.mark} </span>{mailStatusLabel(section?.status)}</span>
      </h4>
      {noAnswer ? <p className="mt-1 text-sm text-slate-700">O DNS não respondeu e ainda não há dado anterior. Uma nova tentativa acontece em algumas horas.</p> : <dl className="mt-1 divide-y divide-slate-100">{children}</dl>}
      {messages.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-slate-700">{messages.map((message) => <li key={message}>{message}</li>)}</ul>}
      {section?.as_of && section.status !== 'inconclusive' && <p className="mt-2 text-xs text-slate-500">Resposta do DNS em {formatDateTime(section.as_of)}</p>}
    </div>
  );
}

function MailSection({ mail }) {
  if (mail === undefined) return <p className="text-sm text-slate-600">Carregando a verificação de e-mail…</p>;
  if (!mail) return <section><h3 className="text-sm font-semibold text-slate-900">E-mail (SPF, DKIM e DMARC)</h3><p className="mt-1 text-sm text-slate-600">Ainda não verificado. Quando a verificação de e-mail está ligada nas configurações, ela roda sozinha, ou use o botão de consulta da lista.</p></section>;
  const { spf, dmarc, dkim } = mail;
  const lines = (list) => (list?.length ? list.join(', ') : '—');
  return (
    <section aria-labelledby="dm-mail-title" className="space-y-2">
      <h3 id="dm-mail-title" className="text-sm font-semibold text-slate-900">E-mail (SPF, DKIM e DMARC) <span className="font-normal text-slate-500">· verificado em {formatDateTime(mail.checked_at)}</span></h3>
      {!mail.name_exists ? <p className="text-sm text-slate-700">Este nome não existe no DNS, então não há o que verificar.</p> : (
        <div className="grid gap-2 lg:grid-cols-3">
          <MailBlock kind="spf" title="SPF" section={spf} mail={mail}>
            {spf.status === 'absent' && <Row label="Registro">Nenhum registro SPF neste nome.</Row>}
            {spf.record && <Row label="Registro"><code className="break-all text-xs">{spf.record}</code></Row>}
            {spf.record && <Row label="Política final">{spf.all || '—'}</Row>}
            {spf.record && <Row label="Consultas DNS">{spf.lookups} de 10</Row>}
            {spf.record && <Row label="IPs autorizados">{spf.ip_count}</Row>}
            {spf.includes?.length > 0 && <Row label="Includes">{lines(spf.includes)}</Row>}
          </MailBlock>
          <MailBlock kind="dkim" title="DKIM" section={dkim} mail={mail}>
            <Row label="Seletores testados">{dkim.tested ?? 0}</Row>
            {dkim.found?.length > 0 ? dkim.found.map((key) => <Row key={key.selector} label={key.selector}>{KEY_STATE(key)}{key.testing ? ' · teste' : ''}</Row>) : <Row label="Encontrados">{dkim.status === 'not_found' ? 'Nenhum entre os seletores testados' : '—'}</Row>}
            {dkim.status === 'not_found' && !dkim.wildcard && <Row label="Observação">Isso não prova que o domínio não usa DKIM: cadastre o seletor na configuração do domínio (engrenagem).</Row>}
          </MailBlock>
          <MailBlock kind="dmarc" title="DMARC" section={dmarc} mail={mail}>
            {dmarc.status === 'absent' && <Row label="Registro">Nenhum registro DMARC neste nome (a herança do domínio principal não é avaliada).</Row>}
            {dmarc.record && <Row label="Registro"><code className="break-all text-xs">{dmarc.record}</code></Row>}
            {dmarc.record && <Row label="Política">{dmarc.policy || '—'}{dmarc.subdomain_policy ? ` · subdomínios: ${dmarc.subdomain_policy}` : ''} · {dmarc.pct}%</Row>}
            {dmarc.record && <Row label="Relatórios">{lines(dmarc.rua)}</Row>}
            {dmarc.record && dmarc.ruf?.length > 0 && <Row label="Forenses">{lines(dmarc.ruf)}</Row>}
            {dmarc.record && <Row label="Alinhamento">DKIM {ALIGN[dmarc.adkim]} · SPF {ALIGN[dmarc.aspf]}</Row>}
          </MailBlock>
        </div>
      )}
    </section>
  );
}

export function DomainDetailDialog({ domain: initial, changes: initialChanges, mail: initialMail, onClose }) {
  const [domain, setDomain] = useState(initial);
  const [changes, setChanges] = useState(initialChanges || null);
  const [mail, setMail] = useState(initialMail);
  const [error, setError] = useState('');
  useEffect(() => {
    if (initialChanges && initialMail !== undefined) return undefined;
    let active = true;
    getDomainDetail(initial.id).then((data) => { if (active) { setDomain(data.domain); setChanges(data.changes); setMail(data.mail ?? null); } })
      .catch((failure) => { if (active) setError(describeError(failure, 'Não foi possível carregar o histórico.')); });
    return () => { active = false; };
  }, [initial.id, initialChanges, initialMail]);
  const snap = domain.snapshot;
  const expiry = expiryInfo(snap);
  return (
    <FormDialog title={domain.name} description={`Origem: ${SOURCE_LABELS[domain.source] || domain.source}`} onClose={onClose} size="xl" guardChanges={false}
      footer={<div className="flex justify-end"><button type="button" data-dialog-cancel className={secondaryButton}>Fechar</button></div>}>
      <div className="space-y-4">
        {!snap ? <p className="text-sm text-slate-600">Este domínio ainda não foi consultado. Use o botão de consulta na lista.</p> : (
          <dl className="divide-y divide-slate-100">
            <Row label="Resultado">{lookupLabel(snap)}{snap.error_code ? ` — ${errorLabel(snap.error_code)}` : ''}</Row>
            <Row label="Vencimento"><span className={TONE_CLASSES[expiry.tone]}>{expiry.text} {expiry.note && `(${expiry.note})`}</span></Row>
            <Row label="Registro">{snap.registered_on ? formatDay(snap.registered_on) : '—'}</Row>
            <Row label="Registrador">{snap.registrar || '—'}</Row>
            <Row label="Status do registro">{snap.rdap_statuses.length ? snap.rdap_statuses.join(', ') : '—'}</Row>
            <Row label="Servidores DNS">{snap.nameservers.length ? snap.nameservers.join(', ') : '—'}</Row>
            <Row label="DNSSEC">{dnssecLabel(snap.dnssec)}</Row>
            <Row label="Certificado SSL">{sslLabel(snap.ssl.state)}{snap.ssl.not_after ? ` — vence em ${formatIsoDateTime(snap.ssl.not_after).slice(0, 8)}` : ''}{snap.ssl.issuer ? ` · ${snap.ssl.issuer}` : ''}{snap.ssl.protocol ? ` · ${snap.ssl.protocol}` : ''}</Row>
            <Row label="Última consulta">{formatDateTime(snap.checked_at)}</Row>
          </dl>
        )}
        <MailSection mail={mail} />
        <section aria-labelledby="dm-changes-title">
          <h3 id="dm-changes-title" className="text-sm font-semibold text-slate-900">Mudanças detectadas</h3>
          {error && <p role="alert" className={`${errorBox} mt-2`}>{error}</p>}
          {changes === null && !error && <p className="mt-1 text-sm text-slate-600">Carregando…</p>}
          {changes && changes.length === 0 && <p className="mt-1 text-sm text-slate-600">Nenhuma mudança desde a primeira consulta.</p>}
          {changes && changes.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
              {changes.map((change, index) => (
                <li key={`${change.field}-${change.detected_at}-${index}`} className="px-3 py-2 text-sm">
                  <span className="font-medium text-slate-900">{fieldLabel(change.field)}</span>
                  <span className="text-slate-600"> · {formatDateTime(change.detected_at)}</span>
                  <p className="break-words text-slate-700">{changeValue(change.field, change.old_value)} → {changeValue(change.field, change.new_value)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </FormDialog>
  );
}

export function AlertsDialog({ domain, onClose, onSaved }) {
  const id = useId();
  const [form, setForm] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  // The e-mail check of this domain (on/off and extra DKIM selectors) lives in the same card as its alerts.
  const [mailForm, setMailForm] = useState(null);
  const [mailOriginal, setMailOriginal] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([getDomainAlerts(domain.id), getDomainMailSettings(domain.id)])
      .then(([alerts, mailSettings]) => {
        if (!active) return;
        const loaded = { enabled: mailSettings.enabled !== false, extra: (mailSettings.extra_selectors || []).join('\n') };
        setForm(alerts); setMailForm(loaded); setMailOriginal(loaded);
      })
      .catch((failure) => { if (active) setError(describeError(failure, 'Não foi possível carregar as configurações do domínio.')); });
    return () => { active = false; };
  }, [domain.id]);

  // Returns the list with the typed address included, or null (and shows why) when it cannot be added.
  const withDraft = ({ forSave = false } = {}) => {
    const value = draft.trim().toLowerCase();
    if (!value) return form.emails;
    if (!isValidEmail(value)) { setFieldError('Informe um e-mail válido.'); return null; }
    if (form.emails.includes(value)) {
      if (forSave) return form.emails; // already in the list: nothing to add, nothing to complain about
      setFieldError('Este e-mail já está na lista.');
      return null;
    }
    if (form.emails.length >= MAX_ALERT_EMAILS) { setFieldError(`O máximo é ${MAX_ALERT_EMAILS} e-mails.`); return null; }
    return [...form.emails, value];
  };
  const addEmail = () => {
    const emails = withDraft();
    if (!emails) return;
    setForm({ ...form, emails });
    setDraft(''); setFieldError('');
  };
  const removeEmail = (email) => setForm({ ...form, emails: form.emails.filter((item) => item !== email) });

  const save = async (event) => {
    event.preventDefault();
    // An address typed but not yet added is not lost: it is included (or the reason it cannot be is shown).
    const emails = withDraft({ forSave: true });
    if (!emails) return;
    // A hidden field is neither validated nor sent: switching the check off keeps the extras that were saved.
    const extra = mailForm.enabled ? parseSelectorList(mailForm.extra) : parseSelectorList(mailOriginal.extra);
    const selectorProblem = mailForm.enabled ? selectorProblems(extra, DOMAIN_SELECTOR_LIMIT) : '';
    if (selectorProblem) { setError(selectorProblem); return; }
    setBusy(true); setError('');
    let alertsSaved = false;
    try {
      await saveDomainAlerts(domain.id, { ...form, emails });
      alertsSaved = true;
      if (mailForm.enabled !== mailOriginal.enabled || extra.join('\n') !== parseSelectorList(mailOriginal.extra).join('\n')) {
        await saveDomainMailSettings(domain.id, { enabled: mailForm.enabled, extra_selectors: extra });
      }
      await onSaved(); onClose();
    } catch (failure) {
      if (alertsSaved) { try { await onSaved(); } catch { /* the list refreshes on the next load */ } }
      setError(alertsSaved
        ? `Os alertas foram salvos, mas a verificação de e-mail NÃO foi: ${describeError(failure, 'o servidor recusou a alteração')}`
        : describeError(failure, 'Não foi possível salvar as configurações do domínio.'));
    } finally { setBusy(false); }
  };

  return (
    <FormDialog title={`Configurações — ${domain.name}`} description="Alertas de vencimento e verificação de e-mail deste domínio." onClose={onClose} busy={busy}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" data-dialog-cancel disabled={busy} className={secondaryButton}>Cancelar</button>
        <button type="submit" form="dm-alerts-form" disabled={busy || !form || !mailForm || !canSaveAlerts({ ...form, emails: draft.trim() ? [...form.emails, draft.trim()] : form.emails })} className={primaryButton}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>}>
      {!form && !error && <p className="text-sm text-slate-600">Carregando…</p>}
      {error && <p role="alert" className={errorBox}>{error}</p>}
      {form && (
        <form id="dm-alerts-form" onSubmit={save} noValidate className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span id={`${id}-switch`} className="text-sm font-medium text-slate-900">Alertas de vencimento</span>
            <button type="button" role="switch" aria-checked={form.enabled} aria-labelledby={`${id}-switch`} onClick={() => setForm({ ...form, enabled: !form.enabled })}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${form.enabled ? 'bg-indigo-600' : 'bg-slate-300'}`}>
              <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${form.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
          {form.enabled && (
            <>
              <div>
                <label htmlFor={`${id}-email`} className="block text-sm font-medium text-slate-700">E-mails para notificação</label>
                <div className="mt-1 flex gap-2">
                  <input id={`${id}-email`} type="email" value={draft} onChange={(event) => { setDraft(event.target.value); setFieldError(''); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addEmail(); } }} maxLength={254} autoComplete="off" placeholder="nome@empresa.com" className={fieldClass} />
                  <button type="button" onClick={addEmail} disabled={!draft.trim()} className={secondaryButton}>Adicionar e-mail</button>
                </div>
                {fieldError && <p role="alert" className="mt-1 text-sm text-red-800">{fieldError}</p>}
                {form.emails.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2" aria-label="E-mails adicionados">
                    {form.emails.map((email) => (
                      <li key={email} className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 py-0.5 pl-3 pr-1 text-sm text-slate-800">
                        <span className="break-all">{email}</span>
                        <button type="button" onClick={() => removeEmail(email)} aria-label={`Remover ${email}`} className="rounded-full p-1 text-slate-600 hover:bg-slate-200"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-800">
                <input type="checkbox" checked={form.notify_admins} onChange={(event) => setForm({ ...form, notify_admins: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
                <span>Notificar os administradores<span className="block text-xs text-slate-600">Eles recebem o e-mail e o aviso no sino sem precisar digitar o endereço aqui.</span></span>
              </label>
              {!canSaveAlerts({ ...form, emails: draft.trim() ? [...form.emails, draft.trim()] : form.emails }) && <p role="alert" className="text-sm text-amber-800">Adicione ao menos um e-mail ou marque "Notificar os administradores".</p>}
              <p className="text-xs text-slate-600">O aviso é enviado quando faltarem 30, 15 e 5 dias, no dia do vencimento e diariamente até 10 dias depois. Cada aviso é enviado uma vez por data de vencimento; ao renovar, a sequência recomeça.</p>
            </>
          )}
          {mailForm && (
            <section aria-labelledby={`${id}-mail`} className="space-y-3 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 id={`${id}-mail`} className="text-sm font-medium text-slate-900">Verificar SPF, DKIM e DMARC deste domínio</h3>
                <Switch id={`${id}-mail-switch`} labelId={`${id}-mail`} checked={mailForm.enabled} onChange={(enabled) => setMailForm({ ...mailForm, enabled })} />
              </div>
              {mailForm.enabled && (
                <label className="block text-sm font-medium text-slate-700">Seletores DKIM extras (um por linha)
                  <textarea value={mailForm.extra} onChange={(event) => setMailForm({ ...mailForm, extra: event.target.value })} rows={3} spellCheck={false} placeholder="exemplo: marketing" className={`${fieldClass} mt-1 font-mono`} />
                  <span className="mt-1 block text-xs font-normal text-slate-600">Além da lista padrão das configurações. Até {DOMAIN_SELECTOR_LIMIT}. O seletor aparece no cabeçalho DKIM-Signature (campo s=) de um e-mail enviado pelo domínio.</span>
                </label>
              )}
            </section>
          )}
        </form>
      )}
    </FormDialog>
  );
}
