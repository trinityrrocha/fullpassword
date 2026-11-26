const dns = require('node:dns');
const net = require('node:net');

// DNS access of the Domain Manager. Every answer is one of THREE states, never a bare "empty":
//   ok           -> the records were returned;
//   absent       -> the name or the record type does not exist (NXDOMAIN / NODATA): a real, trustworthy "no";
//   inconclusive -> the resolver failed or timed out (SERVFAIL, timeout, refused): nothing can be said.
// Treating a failure as "absent" would show a healthy domain as having lost its SPF/DMARC, so the callers keep the last known data instead.
const ABSENT_CODES = new Set(['ENOTFOUND', 'ENODATA']);
const MAX_SERVERS = 4;

class QueryBudgetError extends Error {
  constructor() {
    super('DNS query budget exhausted');
    this.name = 'QueryBudgetError';
    this.code = 'DNS_BUDGET';
  }
}

// Servers are IP literals (the resolver library does not take names). Private addresses are allowed on purpose: the bundled local
// resolver lives on the compose network. Only a Super Admin can set them.
const normalizeServers = (input) => {
  if (!Array.isArray(input) || input.length > MAX_SERVERS) return null;
  const servers = [...new Set(input.map((item) => (typeof item === 'string' ? item.trim() : '')))];
  return servers.every((server) => server && net.isIP(server) !== 0) ? servers : null;
};

// One budget per domain check: attacker-controlled `include:` chains and long selector lists must not turn a lookup into a flood.
const createBudget = ({ maxQueries = 60, deadlineMs = 25000, now = Date.now } = {}) => {
  const started = now();
  return { used: 0, max: maxQueries, spend() { if (this.used >= this.max || now() - started > deadlineMs) throw new QueryBudgetError(); this.used += 1; } };
};

const createDnsClient = ({ servers = [], resolverFactory = null, timeoutMs = 3000, tries = 2 } = {}) => {
  const resolver = resolverFactory ? resolverFactory() : new dns.promises.Resolver({ timeout: timeoutMs, tries });
  const list = normalizeServers(servers) || [];
  if (list.length && !resolverFactory) resolver.setServers(list);

  const run = async (method, name, budget) => {
    if (budget) budget.spend();
    try {
      return { state: 'ok', value: await resolver[method](name) };
    } catch (error) {
      if (error instanceof QueryBudgetError) throw error;
      if (ABSENT_CODES.has(error?.code)) return { state: 'absent', code: error.code };
      return { state: 'inconclusive', code: String(error?.code || 'DNS_ERROR').slice(0, 32) };
    }
  };

  return {
    // TXT chunks of one record are joined WITHOUT a separator (RFC 7208 4.5), then each record stays separate.
    async txt(name, budget) {
      const answer = await run('resolveTxt', name, budget);
      return answer.state === 'ok' ? { state: 'ok', records: answer.value.map((chunks) => chunks.join('')) } : answer;
    },
    async a(name, budget) {
      const answer = await run('resolve4', name, budget);
      return answer.state === 'ok' ? { state: 'ok', records: answer.value } : answer;
    },
    async aaaa(name, budget) {
      const answer = await run('resolve6', name, budget);
      return answer.state === 'ok' ? { state: 'ok', records: answer.value } : answer;
    },
    async mx(name, budget) {
      const answer = await run('resolveMx', name, budget);
      return answer.state === 'ok' ? { state: 'ok', records: answer.value.map((item) => ({ exchange: String(item.exchange || '').toLowerCase().replace(/\.$/, ''), priority: item.priority })) } : answer;
    }
  };
};

module.exports = { createDnsClient, createBudget, normalizeServers, QueryBudgetError, MAX_SERVERS };
