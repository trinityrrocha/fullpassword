export const getCloudStatus = ({ busy, communication, providerStatus, configured }) => {
  if (busy === 'provider-test') return 'testing';
  if (!configured) return 'config_error';
  if (communication?.state === 'success' || providerStatus?.last_test_status === 'success') return 'online';
  if (communication?.state === 'failed' || providerStatus?.last_test_status === 'failed') {
    return /PERMISSION|ACCESS_DENIED|FORBIDDEN/.test(String(communication?.stage || ''))
      ? 'permission_error'
      : 'offline';
  }
  if (['online', 'degraded', 'offline', 'config_error', 'permission_error'].includes(providerStatus?.last_test_status)) {
    return providerStatus.last_test_status;
  }
  return 'not_tested';
};
