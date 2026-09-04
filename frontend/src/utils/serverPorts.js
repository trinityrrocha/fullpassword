export const PORT_DIRECTIONS = ['Entrada', 'Saída', 'Entrada/Saída'];
export const WINDOWS_PORT_PROTOCOLS = ['TCP', 'UDP', 'TCP/UDP'];

export const sanitizeServerPort = (value = '') => String(value).replace(/\D/g, '').slice(0, 5);
export const createPortDraft = (connectionId = '') => ({
  connectionId, portNumber: '', direction: 'Entrada/Saída', protocol: 'TCP', isTs: false, host: ''
});
export const hasPortDraft = (draft) => Boolean(draft.editing || draft.portNumber || draft.host
  || draft.isTs || draft.direction !== 'Entrada/Saída' || draft.protocol !== 'TCP');

export const connectionLabel = (connection, connections) => {
  if (!connection) return 'Sem vínculo (legado)';
  const type = connection.type === 'VPN'
    ? `VPN ${connections.filter((item) => item.type === 'VPN').findIndex((item) => item.id === connection.id) + 1}`
    : connection.type;
  return [type, connection.name].filter(Boolean).join(' - ');
};

export const getServerPorts = (server) => [
  ...(server.portRules || []).map((rule, index) => ({
    ...rule, source: 'portRules', index, connectionId: rule.connectionId || '',
    portNumber: String(rule.portNumber || rule.port || ''), host: String(rule.host || rule.ip || ''),
    isTs: rule.isTs === true, direction: rule.direction || 'Entrada/Saída', protocol: rule.protocol || 'TCP'
  })),
  ...(server.tsRules || []).map((rule, index) => ({
    ...rule, source: 'tsRules', index, connectionId: rule.connectionId || '',
    portNumber: String(rule.port || rule.portNumber || ''), host: String(rule.host || rule.ip || ''),
    isTs: true, direction: rule.direction || 'Entrada/Saída', protocol: rule.protocol || 'TCP'
  }))
];

export const getWindowsTsAddresses = (server) => getServerPorts(server)
  .filter((rule) => rule.isTs && rule.host.trim() && rule.portNumber)
  .map((rule) => ({ ...rule, port: rule.portNumber, id: `${rule.source}-${rule.id || rule.index}` }));

export const validatePortDraft = (draft, connections, windows) => {
  if (!connections.some((connection) => connection.id === draft.connectionId)) return 'Selecione uma conexão deste servidor.';
  if (!/^\d{1,5}$/.test(draft.portNumber) || Number(draft.portNumber) < 1 || Number(draft.portNumber) > 65535) {
    return 'Informe uma porta entre 1 e 65535.';
  }
  if (windows && draft.isTs && !draft.host.trim()) return 'Informe Host/DDNS para o acesso TS.';
  return '';
};

export const removeServerPort = (server, rule) => ({
  ...server, [rule.source]: server[rule.source].filter((_, index) => index !== rule.index)
});

export const applyPortDraft = (server, draft, windows) => {
  const error = validatePortDraft(draft, server.connections || [], windows);
  if (error) throw new Error(error);
  const existing = draft.editing ? server[draft.editing.source][draft.editing.index] : {};
  const next = draft.editing ? removeServerPort(server, draft.editing) : server;
  const rule = {
    ...existing, id: existing.id || crypto.randomUUID(), connectionId: draft.connectionId,
    portNumber: draft.portNumber, direction: draft.direction, protocol: draft.protocol,
    isTs: windows && draft.isTs,
    host: windows && !draft.isTs
      ? (draft.editing?.source === 'portRules' && existing.isTs !== true ? String(existing.host || existing.ip || '') : '')
      : draft.host.trim()
  };
  // Edited legacy TS entries move once to portRules; all unrelated legacy entries remain untouched.
  delete rule.port;
  return { ...next, portRules: [rule, ...(next.portRules || [])] };
};

// Never turn an arbitrary stored host into an executable URL scheme.
export const serverHostHref = (host) => {
  const value = String(host || '').trim();
  if (value.startsWith('/')) return undefined;
  if (!value || /[\s\\]/.test(value)) return undefined;
  const explicitScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  if (explicitScheme && !/^https?:\/\//i.test(value) && !/^[^/:]+:\d+(?:\/|$)/.test(value)) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
};
