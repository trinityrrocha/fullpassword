const invalid = (error) => ({ state: 'invalid', error });

export const sanitizeIpv4CidrInput = (value) => (
  String(value || '').replace(/[^0-9./]/g, '').slice(0, 18)
);

export const validateIpv4Cidr = (value) => {
  const input = String(value || '').trim();
  if (!input) return { state: 'neutral', error: '' };
  if (input.length > 18 || /[^0-9./]/.test(input)) {
    return invalid('Use somente números, ponto e uma barra CIDR.');
  }

  const parts = input.split('/');
  if (parts.length > 2) return invalid('Use apenas uma barra para informar o prefixo CIDR.');

  const [ip, cidr] = parts;
  const octets = ip.split('.');
  if (octets.length !== 4) return invalid('Informe um IPv4 com 4 blocos. Exemplo: 192.168.1.1');

  for (const octet of octets) {
    if (!/^\d+$/.test(octet)) return invalid('Cada bloco do IP deve conter apenas números.');
    if (octet.length > 1 && octet.startsWith('0')) {
      return invalid('Evite zeros à esquerda nos blocos do IP.');
    }
    const number = Number(octet);
    if (number < 0 || number > 255) return invalid('Cada bloco do IP deve estar entre 0 e 255.');
  }

  if (cidr !== undefined) {
    if (!cidr) return invalid('Informe o prefixo CIDR após a barra.');
    if (!/^\d+$/.test(cidr)) return invalid('O prefixo CIDR deve conter apenas números.');
    if (cidr.length > 1 && cidr.startsWith('0')) {
      return invalid('Não use zeros à esquerda no prefixo CIDR.');
    }
    const prefix = Number(cidr);
    if (prefix < 0 || prefix > 32) return invalid('O prefixo CIDR deve estar entre 0 e 32.');
  }

  return { state: 'valid', error: '' };
};
