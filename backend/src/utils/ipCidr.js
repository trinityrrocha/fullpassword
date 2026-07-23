const validateIpv4Cidr = (value) => {
  const input = String(value || '').trim();
  if (!input || input.length > 18 || /[^0-9./]/.test(input)) return false;

  const parts = input.split('/');
  if (parts.length > 2) return false;

  const [ip, cidr] = parts;
  const octets = ip.split('.');
  if (octets.length !== 4) return false;
  if (octets.some((octet) => (
    !/^\d+$/.test(octet)
    || (octet.length > 1 && octet.startsWith('0'))
    || Number(octet) < 0
    || Number(octet) > 255
  ))) return false;

  if (cidr !== undefined) {
    if (
      !/^\d+$/.test(cidr)
      || (cidr.length > 1 && cidr.startsWith('0'))
      || Number(cidr) < 0
      || Number(cidr) > 32
    ) return false;
  }

  return true;
};

const normalizeIpv4Cidr = (value) => {
  const input = String(value || '').trim();
  return validateIpv4Cidr(input) ? input : null;
};

module.exports = { validateIpv4Cidr, normalizeIpv4Cidr };
