const getTrustedCountry = (req) => {
  // Só habilitar quando o proxy remover o header público e recriá-lo a partir
  // de uma origem Cloudflare validada. O Compose padrão não habilita esta opção.
  if (process.env.TRUSTED_COUNTRY_HEADER_ENABLED !== 'true') return null;
  const country = String(req?.get?.('cf-ipcountry') || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null;
};

module.exports = { getTrustedCountry };
