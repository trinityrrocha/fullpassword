export const normalizeMacAddress = (value) => String(value ?? '').trim().replace(/-/g, ':').toUpperCase();

export const getMacAddressError = (value) => {
  const mac = normalizeMacAddress(value);
  return !mac || (mac.length === 17 && /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac))
    ? '' : 'MAC inválido. Use o formato AA:BB:CC:DD:EE:FF.';
};
