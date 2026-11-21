import { domainState } from '../../utils/spfbl';

const TONES = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-900',
  slate: 'bg-slate-100 text-slate-700'
};

// State is always written out as text: colour alone never carries the meaning.
export default function DomainBadge({ domain }) {
  const state = domainState(domain);
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[state.tone]}`}>{state.label}</span>;
}
