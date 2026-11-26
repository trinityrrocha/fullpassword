import { useEffect, useState } from 'react';
import FormDialog from '../FormDialog';
import { addDomain, importDomains, saveDomainSettings, getDomainDetail } from '../../services/domainManagerService';
import { describeError, formatDateTime, formatDay, formatIsoDateTime } from '../../utils/spfbl';
import { MAX_IMPORT, SOURCE_LABELS, changeValue, dnssecLabel, errorLabel, expiryInfo, fieldLabel, lookupLabel, parseDomainList, sslLabel, TONE_CLASSES } from '../../utils/domainManager';

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

export function SettingsDialog({ settings, onClose, onSaved }) {
  const [days, setDays] = useState(String(settings.check_interval_days));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try { await saveDomainSettings({ check_interval_days: Number(days) }); await onSaved(); onClose(); } catch (failure) { setError(describeError(failure, 'Não foi possível salvar.')); } finally { setBusy(false); }
  };
  return (
    <FormDialog title="Consultas automáticas" description="Todos os domínios da lista são consultados sozinhos." onClose={onClose} busy={busy}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" data-dialog-cancel disabled={busy} className={secondaryButton}>Cancelar</button>
        <button type="submit" form="dm-settings-form" disabled={busy} className={primaryButton}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>}>
      <form id="dm-settings-form" onSubmit={save} noValidate className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">Intervalo entre consultas (dias)
          <input type="number" min={1} max={30} step={1} value={days} onChange={(event) => setDays(event.target.value)} className={`${fieldClass} mt-1 max-w-32`} />
        </label>
        <p className="text-sm text-slate-600">Vale enquanto faltarem mais de 30 dias para o vencimento. A partir daí, e enquanto o domínio estiver vencido, a consulta passa a ser diária.</p>
        {error && <p role="alert" className={errorBox}>{error}</p>}
      </form>
    </FormDialog>
  );
}

const Row = ({ label, children }) => (
  <div className="grid grid-cols-3 gap-2 py-1.5 text-sm"><dt className="font-medium text-slate-600">{label}</dt><dd className="col-span-2 break-words text-slate-900">{children}</dd></div>
);

export function DomainDetailDialog({ domain: initial, changes: initialChanges, onClose }) {
  const [domain, setDomain] = useState(initial);
  const [changes, setChanges] = useState(initialChanges || null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (initialChanges) return undefined;
    let active = true;
    getDomainDetail(initial.id).then((data) => { if (active) { setDomain(data.domain); setChanges(data.changes); } })
      .catch((failure) => { if (active) setError(describeError(failure, 'Não foi possível carregar o histórico.')); });
    return () => { active = false; };
  }, [initial.id, initialChanges]);
  const snap = domain.snapshot;
  const expiry = expiryInfo(snap);
  return (
    <FormDialog title={domain.name} description={`Origem: ${SOURCE_LABELS[domain.source] || domain.source}`} onClose={onClose} size="xl" guardChanges={false}
      footer={<div className="flex justify-end"><button type="button" data-dialog-cancel className={secondaryButton}>Fechar</button></div>}>
      {!snap ? <p className="text-sm text-slate-600">Este domínio ainda não foi consultado. Use o botão de consulta na lista.</p> : (
        <div className="space-y-4">
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
      )}
    </FormDialog>
  );
}
