export const GOOGLE_DRIVE_OAUTH_SETUP_MESSAGE = 'Configure as credenciais OAuth do Google Drive antes de conectar a conta.';

export const GOOGLE_DRIVE_CONNECT_FIRST_MESSAGE = 'Conecte uma conta Google Drive antes de ativar o backup.';

const GOOGLE_DRIVE_ERROR_MESSAGES = {
  GOOGLE_DRIVE_SERVER_NOT_CONFIGURED: GOOGLE_DRIVE_OAUTH_SETUP_MESSAGE,
  GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED: GOOGLE_DRIVE_OAUTH_SETUP_MESSAGE,
  GOOGLE_DRIVE_NOT_CONNECTED: GOOGLE_DRIVE_CONNECT_FIRST_MESSAGE,
  GOOGLE_DRIVE_PASSPHRASE_REQUIRED: 'Defina a frase de criptografia do Backup V2 antes de ativar a rotina.',
  GOOGLE_DRIVE_INVALID_RETENTION: 'Escolha uma retenção válida: 7, 15, 30 ou 60 dias.',
  GOOGLE_DRIVE_INVALID_DAYS: 'Selecione ao menos um dia da semana.',
  GOOGLE_DRIVE_INVALID_TIMES: 'Informe de um a três horários válidos no formato HH:mm.',
  GOOGLE_DRIVE_INVALID_CLIENT_ID: 'Informe um Client ID OAuth válido.',
  GOOGLE_DRIVE_INVALID_CLIENT_SECRET: 'Informe o Client Secret OAuth.',
  GOOGLE_DRIVE_INVALID_REDIRECT_URI: 'Informe uma Redirect URI HTTPS válida para o callback do Google Drive.',
  GOOGLE_DRIVE_OAUTH_CONFIG_IN_USE: 'Desconecte a conta Google Drive antes de remover a configuração OAuth.'
};

export const normalizeGoogleDriveStatus = (status = {}) => {
  const serverConfigured = status.oauth_configured === true || status.server_configured === true;
  const connected = status.connected === true;
  return {
    ...status,
    server_configured: serverConfigured,
    oauth_configured: serverConfigured,
    connected,
    enabled: serverConfigured && connected && status.enabled === true,
    schedule_enabled: serverConfigured && connected && status.schedule_enabled === true
  };
};

export const validateGoogleDriveSettingsSave = (status = {}) => {
  if (status.oauth_configured !== true && status.server_configured !== true) {
    return GOOGLE_DRIVE_OAUTH_SETUP_MESSAGE;
  }
  if (status.connected !== true) return GOOGLE_DRIVE_CONNECT_FIRST_MESSAGE;
  return '';
};

export const getGoogleDriveActionError = (error, fallbackMessage) => {
  const code = error?.response?.data?.code;
  return {
    expected: Boolean(GOOGLE_DRIVE_ERROR_MESSAGES[code]),
    message: GOOGLE_DRIVE_ERROR_MESSAGES[code]
      || error?.response?.data?.error
      || fallbackMessage
  };
};
