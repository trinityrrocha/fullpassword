const { getClientNetworkMetadata } = require('./clientIpService');
const getTrustedCountry = (req) => getClientNetworkMetadata(req).country;

module.exports = { getTrustedCountry };
