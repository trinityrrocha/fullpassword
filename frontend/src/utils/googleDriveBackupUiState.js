export const GOOGLE_DRIVE_SERVER_SETUP_MESSAGE = [
  'Integração Google Drive não configurada no servidor.',
  'Configure GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET e GOOGLE_DRIVE_REDIRECT_URI no backend e reinicie o serviço.'
].join(' ');

export const GOOGLE_DRIVE_CONNECT_FIRST_MESSAGE = 'Conecte uma conta Google Drive antes de ativar o backup.';

const GOOGLE_DRIVE_ERROR_MESSAGES = {
  GOOGLE_DRIVE_SERVER_NOT_CONFIGURED: GOOGLE_DRIVE_SERVER_SETUP_MESSAGE,
  GOOGLE_DRIVE_NOT_CONNECTED: GOOGLE_DRIVE_CONNECT_FIRST_MESSAGE,
  GOOGLE_DRIVE_PASSPHRASE_REQUIRED: 'Defina a frase de criptografia do Backup V2 antes de ativar a rotina.',
  GOOGLE_DRIVE_INVALID_RETENTION: 'Escolha uma retenção válida: 7, 15, 30 ou 60 dias.',
  GOOGLE_DRIVE_INVALID_DAYS: 'Selecione ao menos um dia da semana.',
  GOOGLE_DRIVE_INVALID_TIMES: 'Informe de um a três horários válidos no formato HH:mm.'
};

export const normalizeGoogleDriveStatus = (status = {}) => {
  const serverConfigured = status.server_configured === true;
  const connected = status.connected === true;
  return {
    ...status,
    server_configured: serverConfigured,
    connected,
    enabled: serverConfigured && connected && status.enabled === true,
    schedule_enabled: serverConfigured && connected && status.schedule_enabled === true
  };
};

export const validateGoogleDriveSettingsSave = (status = {}) => {
  if (status.server_configured !== true) return GOOGLE_DRIVE_SERVER_SETUP_MESSAGE;
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
