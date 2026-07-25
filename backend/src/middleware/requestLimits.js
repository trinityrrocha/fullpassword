const express = require('express');

const MEBIBYTE = 1024 * 1024;
const DEFAULT_JSON_LIMIT_BYTES = 2 * MEBIBYTE;
const VAULT_JSON_LIMIT_BYTES = 10 * MEBIBYTE;
const VAULT_METADATA_LIMIT_BYTES = 64 * 1024;
const PAYLOAD_TOO_LARGE_MESSAGE = 'O arquivo ou operação excede o tamanho permitido. Reduza o tamanho e tente novamente.';

const payloadTooLargeResponse = (res) => res.status(413).json({
  code: 'PAYLOAD_TOO_LARGE',
  error: PAYLOAD_TOO_LARGE_MESSAGE,
  message: PAYLOAD_TOO_LARGE_MESSAGE
});

const isJsonRequest = (req) => {
  const contentType = String(req.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  return contentType === 'application/json' || contentType.endsWith('+json');
};

const enforceContentLength = (maxBytes, { jsonOnly = false } = {}) => (req, res, next) => {
  if (jsonOnly && !isJsonRequest(req)) return next();

  const rawContentLength = req.get('content-length');
  if (!rawContentLength) return next();

  const contentLength = Number(rawContentLength);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    return res.status(400).json({ error: 'Content-Length inválido.' });
  }

  if (contentLength > maxBytes) return payloadTooLargeResponse(res);
  return next();
};

const defaultJsonParser = express.json({ limit: DEFAULT_JSON_LIMIT_BYTES });
const vaultJsonParser = express.json({ limit: VAULT_JSON_LIMIT_BYTES });

const validateEncryptedVaultPayload = (req, res, next) => {
  if (req.method !== 'POST') return next();

  const {
    category,
    encrypted_data: encryptedData,
    encrypted_attachment: encryptedAttachment,
    metadata
  } = req.body || {};
  if (category !== undefined && typeof category !== 'string') {
    return res.status(400).json({ error: 'Categoria do cofre inválida.' });
  }
  if (Buffer.byteLength(category || '', 'utf8') > 256) {
    return payloadTooLargeResponse(res);
  }
  if (encryptedData !== undefined && typeof encryptedData !== 'string') {
    return res.status(400).json({ error: 'Dados criptografados inválidos.' });
  }
  if (encryptedAttachment !== undefined && encryptedAttachment !== null && typeof encryptedAttachment !== 'string') {
    return res.status(400).json({ error: 'Anexo criptografado inválido.' });
  }

  const encryptedPayloadBytes = Buffer.byteLength(encryptedData || '', 'utf8')
    + Buffer.byteLength(encryptedAttachment || '', 'utf8');
  if (encryptedPayloadBytes > VAULT_JSON_LIMIT_BYTES) return payloadTooLargeResponse(res);

  if (metadata !== undefined) {
    let metadataBytes;
    try {
      metadataBytes = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
    } catch {
      return res.status(400).json({ error: 'Metadados do cofre inválidos.' });
    }
    if (metadataBytes > VAULT_METADATA_LIMIT_BYTES) return payloadTooLargeResponse(res);
  }

  return next();
};

const payloadTooLargeErrorHandler = (error, _req, res, next) => {
  if (error?.status === 413 || error?.statusCode === 413 || error?.type === 'entity.too.large') {
    return payloadTooLargeResponse(res);
  }
  return next(error);
};

module.exports = {
  MEBIBYTE,
  DEFAULT_JSON_LIMIT_BYTES,
  VAULT_JSON_LIMIT_BYTES,
  PAYLOAD_TOO_LARGE_MESSAGE,
  defaultJsonParser,
  vaultJsonParser,
  enforceContentLength,
  validateEncryptedVaultPayload,
  payloadTooLargeErrorHandler
};
