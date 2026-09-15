export const UPDATE_STATUS_CHANGED = 'fullpassword:update-status-changed';
export const UPDATE_CHECK_ERROR = 'Não foi possível concluir a verificação agora. Tente novamente.';
export const isUpdateSuperAdmin = (user) => user?.role === 'admin' && user?.is_super_admin === true;
export const canInstallUpdate = (status) => status?.state === 'update_available' && status?.update_available === true;

export function describeUpdateStatus(status) {
  return {
    up_to_date: 'Sistema atualizado. Você está utilizando a versão mais recente.',
    update_available: 'Atualização disponível',
    checking: 'Verificando atualizações...',
    updating: 'Atualização em andamento...',
    check_failed: 'Não foi possível verificar atualizações. Tente novamente.',
    local_ahead: 'A versão instalada está à frente da origem. Atualização automática indisponível.',
    diverged: 'O histórico instalado diverge da origem. É necessária uma revisão técnica antes de atualizar.',
    unknown: 'Não foi possível identificar a versão instalada. Verifique o registro da instalação.'
  }[status?.state] || 'Status da atualização indisponível.';
}

export function combineUpdateNotification(security, update, allowed) {
  const hasUpdate = allowed && canInstallUpdate(update) && update.notification_unread === true;
  const items = Array.isArray(security?.items) ? security.items : [];
  return { ...security, unread_count: Number(security?.unread_count || 0) + (hasUpdate ? 1 : 0),
    items: hasUpdate ? [{ id: `update:${update.available_commit}`, title: 'Nova atualização disponível',
      summary: `Há uma nova versão do FullPassword disponível. ${update.commits_behind} alterações disponíveis.`,
      status_label: 'Atualização', severity: 'info', created_at: update.discovered_at,
      target_url: '/settings?section=update' }, ...items].slice(0, 10) : items };
}

// Only polls the local cache, never GitHub. Deadline includes individual HTTP calls.
export async function requestUpdateCheck(api, { signal, onStatus, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const deadline = now() + 30000;
  const response = await api.post('/system/update/check', {}, { signal, timeout: 5000 });
  const requestId = response.data?.request_id;
  if (!requestId) throw new Error(UPDATE_CHECK_ERROR);
  while (!signal?.aborted && now() < deadline) {
    const { data } = await api.get('/system/update/status', { signal, timeout: Math.min(5000, Math.max(1, deadline - now())) });
    onStatus?.(data);
    if (data.last_check_request_id === requestId && !['checking', 'updating'].includes(data.state)) return data;
    await wait(Math.min(1500, Math.max(0, deadline - now())));
  }
  throw new Error(UPDATE_CHECK_ERROR);
}
