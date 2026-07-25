const normalizeLogValue = (value, maxLength = 120) => {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, maxLength);
};

const sanitizeErrorForLog = (error) => {
  const details = {
    name: normalizeLogValue(error?.name || 'Error'),
    code: normalizeLogValue(error?.code),
    status: Number(error?.response?.status || error?.status || 0) || undefined
  };

  if (import.meta.env.DEV && typeof error?.stack === 'string') {
    details.stack = error.stack.slice(0, 4000);
  }

  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
};

export const safeLogError = (context, error) => {
  console.error(normalizeLogValue(context, 200) || 'Erro interno no frontend.', sanitizeErrorForLog(error));
};

export const safeLogInfo = (message) => {
  if (import.meta.env.DEV) console.info(normalizeLogValue(message, 200));
};
