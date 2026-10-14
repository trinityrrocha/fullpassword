export const isReleaseRevision = value => /^[a-f0-9]{40}$/.test(value || '');
export const shortReleaseRevision = value => isReleaseRevision(value) ? value.slice(0, 8) : 'Não identificada';

export const releasePhaseDescriptions = {
  requested: 'Solicitação recebida; aguardando o agente.',
  deploying: 'Implantação em andamento.',
  stabilizing: 'Serviços saudáveis; verificando estabilidade por pelo menos 60 segundos.',
  completed: 'Release instalada e verificada pelo agente.',
  recovery_required: 'A implantação precisa de recuperação pelo operador. Não repita o pedido.'
};

const states = {
  loading: { label: 'Verificando atualização', message: 'Consultando a versão instalada e as atualizações aprovadas.', tone: 'neutral' },
  unavailable: { label: 'Consulta indisponível', message: 'Não foi possível consultar a atualização. Consulte o progresso antes de tentar novamente.', tone: 'warning' },
  mismatch: { label: 'Versões divergentes', message: 'Frontend e backend estão em revisões diferentes. Consulte o progresso e, se persistir, contate o operador.', tone: 'warning' },
  unidentified: { label: 'Versão não identificada', message: 'A versão instalada ainda não foi comprovada. Consulte o progresso.', tone: 'neutral' },
  none: { label: 'Sem atualização disponível', message: 'Nenhuma nova versão aprovada está disponível.', tone: 'neutral' },
  current: { label: 'Sistema atualizado', message: 'Seu sistema já está na versão mais recente aprovada.', tone: 'success' },
  available: { label: 'Atualização disponível', message: 'Uma nova versão aprovada está pronta para instalação.', tone: 'info' },
  requested: { label: 'Atualização solicitada', message: 'Solicitação recebida. Aguardando o agente iniciar a atualização.', tone: 'info' },
  deploying: { label: 'Implantando atualização', message: 'A atualização está sendo implantada e verificada pelo agente.', tone: 'info' },
  stabilizing: { label: 'Verificando estabilidade', message: 'A nova versão está em verificação de estabilidade. Aguarde a conclusão.', tone: 'info' },
  completed: { label: 'Sistema atualizado', message: 'Atualização concluída e versão instalada confirmada.', tone: 'success' },
  verifying: { label: 'Confirmando versão instalada', message: 'O agente concluiu a atualização. Aguardando a confirmação das versões em execução.', tone: 'info' },
  recovery_required: { label: 'Recuperação necessária', message: 'A atualização precisa da atenção do operador. Não solicite novamente.', tone: 'danger' },
  unknown: { label: 'Estado não identificado', message: 'Consulte o progresso ou contate o operador antes de continuar.', tone: 'warning' }
};

// Presentation only: the controller/agent remain the authority for approval and replay.
export function describeSystemUpdate({ versions, agent, loading = false, error = '' }) {
  const release = agent.release;
  const progress = agent.progress;
  const identified = isReleaseRevision(versions.backend) && isReleaseRevision(versions.frontend);
  const consistent = identified && versions.backend === versions.frontend;
  const matchingProgress = !release || progress?.approvalId === release.approvalId;
  const awaitingAgent = agent.requested && !matchingProgress;
  let phase = awaitingAgent ? 'requested' : progress?.state;
  if (phase === 'completed' && !matchingProgress) phase = undefined;
  let state;
  if (loading) state = 'loading';
  else if (error) state = 'unavailable';
  else if (phase === 'recovery_required') state = phase;
  else if (['requested', 'deploying', 'stabilizing'].includes(phase)) state = phase;
  else if (identified && !consistent) state = 'mismatch';
  else if (phase && !Object.hasOwn(releasePhaseDescriptions, phase)) state = 'unknown';
  else if (!identified) state = 'unidentified';
  else if (phase === 'completed' && matchingProgress) state = versions.backend === progress.revision ? 'completed' : 'verifying';
  else if (agent.requested) { state = 'requested'; phase = 'requested'; }
  else if (release && !isReleaseRevision(release.revision)) state = 'unknown';
  else if (release) state = versions.backend === release.revision ? 'current' : 'available';
  else state = 'none';
  return {
    ...states[state], state, phase,
    canRequest: state === 'available',
    canRefresh: !loading && (Boolean(error || progress || agent.requested) || ['unidentified', 'mismatch', 'unknown'].includes(state)),
    currentRevision: consistent ? versions.backend : null,
    availableRevision: release?.revision || null
  };
}
