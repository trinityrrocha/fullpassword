import { useId, useMemo, useState } from 'react';
import FormDialog from '../FormDialog';
import CopyButton from '../CopyButton';
import { DMARC_DEFAULTS, SPF_DEFAULTS, SPF_PROVIDERS, buildDmarc, buildSpf } from '../../utils/recordGenerators';

const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';
const secondaryButton = 'rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';

// A set of mutually exclusive choices drawn as one segmented control: compact, and every option is visible at once.
function Choice({ legend, value, onChange, options, hint }) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      <div className="mt-1 inline-flex flex-wrap overflow-hidden rounded-md border border-slate-300 bg-white">
        {options.map(([optionValue, label]) => (
          <label key={optionValue} className={`cursor-pointer px-3 py-1.5 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-indigo-600 ${value === optionValue ? 'bg-indigo-600 font-medium text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
            <input type="radio" name={name} value={optionValue} checked={value === optionValue} onChange={() => onChange(optionValue)} className="sr-only" />{label}
          </label>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
    </fieldset>
  );
}

const Messages = ({ errors, warnings }) => (errors.length || warnings.length) ? (
  <ul className="space-y-1 text-sm" aria-label="Avisos do registro">
    {errors.map((message) => <li key={message} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-red-800"><span className="sr-only">Erro: </span>{message}</li>)}
    {warnings.map((message) => <li key={message} className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900"><span aria-hidden="true">⚠ </span><span className="sr-only">Aviso: </span>{message}</li>)}
  </ul>
) : null;

function Result({ host, built, kind }) {
  return (
    <div className="space-y-3" data-generator-result={kind}>
      <div>
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-900">Registro gerado</h3><CopyButton value={built.record} label="Copiar registro" /></div>
        <p className="mt-1 break-all rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-sm text-slate-900" data-generator-record>{built.record}</p>
        <p className="mt-1 text-xs text-slate-600">No painel do DNS, crie um registro do tipo <strong>TXT</strong> no nome <code className="rounded bg-slate-100 px-1">{host}</code> com este valor.</p>
      </div>
      <Messages errors={built.errors} warnings={built.warnings} />
      <dl className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
        {built.parts.map((part) => (
          <div key={part.term || part.tag} className="grid grid-cols-[7.5rem_1fr] gap-2 px-2.5 py-1.5">
            <dt className="break-all font-mono text-xs text-indigo-800">{part.term || `${part.tag}=${part.value}`}</dt>
            <dd className="text-xs leading-snug text-slate-700">{part.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DmarcForm() {
  const [form, setForm] = useState({ ...DMARC_DEFAULTS });
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  const built = useMemo(() => buildDmarc(form), [form]);
  const policies = [['none', 'Nenhuma'], ['quarantine', 'Quarentena'], ['reject', 'Rejeitar']];
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-3">
        <Choice legend="Política do domínio (p)" value={form.policy} onChange={set('policy')} options={policies} />
        <Choice legend="Política dos subdomínios (sp)" value={form.subPolicy} onChange={set('subPolicy')} options={[['same', 'Igual à principal'], ...policies]} />
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <Choice legend="Alinhamento DKIM (adkim)" value={form.adkim} onChange={set('adkim')} options={[['r', 'Relaxado'], ['s', 'Estrito']]} />
          <Choice legend="Alinhamento SPF (aspf)" value={form.aspf} onChange={set('aspf')} options={[['r', 'Relaxado'], ['s', 'Estrito']]} />
        </div>
        <label className="block text-sm font-medium text-slate-700">Receber relatórios agregados (rua)
          <input type="text" value={form.rua} onChange={(event) => set('rua')(event.target.value)} placeholder="dmarc@seudominio.com.br" autoComplete="off" spellCheck={false} className={`${fieldClass} mt-1`} />
          <span className="mt-0.5 block text-xs font-normal text-slate-600">Opcional. Vários endereços separados por vírgula.</span>
        </label>
        <details className="rounded-md border border-slate-200 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Opções avançadas</summary>
          <div className="mt-2 space-y-3">
            <label className="block text-sm font-medium text-slate-700">Porcentagem das mensagens (pct)
              <input type="text" inputMode="numeric" value={form.pct} onChange={(event) => set('pct')(event.target.value)} className={`${fieldClass} mt-1 max-w-28`} />
            </label>
            <label className="block text-sm font-medium text-slate-700">Receber relatórios de falha (ruf)
              <input type="text" value={form.ruf} onChange={(event) => set('ruf')(event.target.value)} placeholder="falhas@seudominio.com.br" autoComplete="off" spellCheck={false} className={`${fieldClass} mt-1`} />
            </label>
            {form.ruf.trim() !== '' && <Choice legend="Gerar relatório de falha quando (fo)" value={form.fo} onChange={set('fo')} options={[['0', 'SPF e DKIM falham'], ['1', 'Qualquer falha'], ['d', 'DKIM falha'], ['s', 'SPF falha']]} />}
            <label className="block text-sm font-medium text-slate-700">Intervalo dos relatórios (ri, segundos)
              <input type="text" inputMode="numeric" value={form.ri} onChange={(event) => set('ri')(event.target.value)} className={`${fieldClass} mt-1 max-w-28`} />
            </label>
          </div>
        </details>
      </div>
      <Result kind="dmarc" host="_dmarc.seudominio.com.br" built={built} />
    </div>
  );
}

function SpfForm() {
  const [form, setForm] = useState({ ...SPF_DEFAULTS });
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  const built = useMemo(() => buildSpf(form), [form]);
  const toggleProvider = (id) => set('providers')(form.providers.includes(id) ? form.providers.filter((item) => item !== id) : [...form.providers, id]);
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-3">
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Quem pode enviar e-mail pelo domínio</legend>
          <div className="mt-1 space-y-1 text-sm text-slate-700">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.mx} onChange={(event) => set('mx')(event.target.checked)} />Os servidores de e-mail do domínio (mx)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.a} onChange={(event) => set('a')(event.target.checked)} />O servidor do site do domínio (a)</label>
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Serviços de e-mail</legend>
          <div className="mt-1 grid grid-cols-1 gap-x-3 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
            {SPF_PROVIDERS.map((provider) => (
              <label key={provider.id} className="flex items-center gap-2"><input type="checkbox" checked={form.providers.includes(provider.id)} onChange={() => toggleProvider(provider.id)} />{provider.label}</label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm font-medium text-slate-700">Endereços IP (ip4 / ip6)
          <textarea value={form.ips} onChange={(event) => set('ips')(event.target.value)} rows={2} spellCheck={false} placeholder="203.0.113.10, 198.51.100.0/24" className={`${fieldClass} mt-1 font-mono`} />
        </label>
        <label className="block text-sm font-medium text-slate-700">Outros domínios (include)
          <input type="text" value={form.includes} onChange={(event) => set('includes')(event.target.value)} placeholder="_spf.outro-servico.com" autoComplete="off" spellCheck={false} className={`${fieldClass} mt-1 font-mono`} />
        </label>
        <Choice legend="E-mail de outros servidores" value={form.all} onChange={set('all')} options={[['-all', 'Rejeitar (-all)'], ['~all', 'Suspeito (~all)'], ['?all', 'Neutro (?all)']]} hint="Recomendado: rejeitar." />
      </div>
      <div>
        <Result kind="spf" host="seudominio.com.br" built={built} />
        <p className="mt-2 text-xs text-slate-600">Consultas DNS contadas: {built.lookups} de 10.</p>
      </div>
    </div>
  );
}

// Generates a DMARC or an SPF record from a few choices. It only builds text for the person to publish: nothing is sent anywhere.
export default function RecordGeneratorDialog({ onClose }) {
  const [tab, setTab] = useState('dmarc');
  const id = useId();
  return (
    <FormDialog title="Gerador de registros" description="Escolha as opções e copie o registro para o painel do DNS." size="xl" guardChanges={false} onClose={onClose}
      footer={<div className="flex justify-end"><button type="button" data-dialog-cancel className={secondaryButton}>Fechar</button></div>}>
      <div role="tablist" aria-label="Tipo de registro" className="mb-4 flex gap-1 border-b border-slate-200">
        {[['dmarc', 'DMARC'], ['spf', 'SPF']].map(([key, label]) => (
          <button key={key} id={`${id}-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`${id}-panel`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}
            onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); setTab(tab === 'dmarc' ? 'spf' : 'dmarc'); } }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 ${tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>{tab === 'dmarc' ? <DmarcForm /> : <SpfForm />}</div>
    </FormDialog>
  );
}
