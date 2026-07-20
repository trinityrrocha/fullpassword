export const normalizeVaultAttachments = (source = {}) => {
  if (Array.isArray(source)) return source.filter(Boolean);
  if (Array.isArray(source.attachments)) return source.attachments.filter(Boolean);
  if (source.attachment) return [source.attachment];
  return [];
};
