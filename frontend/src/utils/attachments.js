export const downloadAttachment = (attachment) => {
  if (!attachment?.data) return;

  const encodedData = String(attachment.data);
  const base64Data = encodedData.includes(',') ? encodedData.split(',').pop() : encodedData;
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

  const url = URL.createObjectURL(new Blob([bytes], { type: attachment.type || 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.name || attachment.fileName || attachment.filename || 'anexo';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
