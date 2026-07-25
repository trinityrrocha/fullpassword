const normalizeLogValue = (value, maxLength = 120) => {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, maxLength);
};

const sanitizeErrorForLog = (error, options = {}) => {
  const details = {
    name: normalizeLogValue(error?.name || 'Error'),
    code: normalizeLogValue(error?.code),
    status: Number(error?.response?.status || error?.status || 0) || undefined,
    stage: normalizeLogValue(options.stage),
    message: options.includeMessage ? normalizeLogValue(error?.message, 240) : undefined,
    apiError: options.includeApiError
      ? normalizeLogValue(error?.response?.data?.error, 240)
      : undefined
  };

  if (import.meta.env.DEV && typeof error?.stack === 'string') {
    details.stack = error.stack.slice(0, 4000);
  }

  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
};

export const safeLogError = (context, error, options = {}) => {
  console.error(
    normalizeLogValue(context, 200) || 'Erro interno no frontend.',
    sanitizeErrorForLog(error, options)
  );
};

export const safeLogInfo = (message) => {
  if (import.meta.env.DEV) console.info(normalizeLogValue(message, 200));
};
