export const PAYLOAD_TOO_LARGE_MESSAGE = 'O arquivo ou operação excede o tamanho permitido. Reduza o tamanho e tente novamente.';
export const MAX_VAULT_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_VAULT_ATTACHMENTS = 10;

export const validateVaultAttachmentSelection = (files, existingAttachments = []) => {
  const selectedFiles = Array.from(files || []);
  const currentAttachments = Array.isArray(existingAttachments) ? existingAttachments : [];

  if (currentAttachments.length + selectedFiles.length > MAX_VAULT_ATTACHMENTS) {
    throw new Error(`Cada registro pode conter no máximo ${MAX_VAULT_ATTACHMENTS} arquivos.`);
  }

  if (selectedFiles.some((file) => Number(file?.size || 0) > MAX_VAULT_ATTACHMENT_BYTES)) {
    throw new Error('Cada arquivo deve ter no máximo 5 MB.');
  }

  const currentSize = currentAttachments.reduce(
    (total, attachment) => total + Number(attachment?.size || 0),
    0
  );
  const selectedSize = selectedFiles.reduce(
    (total, file) => total + Number(file?.size || 0),
    0
  );
  if (currentSize + selectedSize > MAX_VAULT_ATTACHMENT_BYTES) {
    throw new Error('O total de arquivos deste registro deve ter no máximo 5 MB.');
  }

  return selectedFiles;
};
