/**
 * Serviço de Criptografia Client-Side (Zero-Knowledge)
 * Utiliza a Web Crypto API nativa do navegador para máxima segurança e performance.
 */

// Converte string para ArrayBuffer
const getMessageEncoding = (message) => {
  const enc = new TextEncoder();
  return enc.encode(message);
};

// Converte ArrayBuffer para string
const getMessageDecoding = (buffer) => {
  const dec = new TextDecoder();
  return dec.decode(buffer);
};

// Converte ArrayBuffer para Base64
const bufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

// Converte Base64 para ArrayBuffer
const base64ToBuffer = (base64) => {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

/**
 * Deriva uma chave mestra (Master Key) a partir da senha do usuário.
 * Utiliza PBKDF2 com SHA-256 e 100.000 iterações.
 * O salt é fixo para simplificar o exemplo, mas em produção deve ser único por usuário e salvo no banco.
 * @param {string} password - A senha em texto claro
 * @returns {Promise<CryptoKey>} - A chave criptográfica utilizável para AES-GCM
 */
export const deriveMasterKey = async (password) => {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  // Em produção, o salt deve ser único por usuário e recuperado do backend antes do login
  // Aqui usamos um salt fixo apenas para demonstração do conceito
  const salt = enc.encode('fullpassword-salt-super-seguro-123');

  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true, // Permite exportar se necessário (mas não faremos isso)
    ['encrypt', 'decrypt']
  );
};

/**
 * Criptografa um objeto JSON usando AES-256-GCM.
 * @param {Object} jsonObject - Os dados a serem criptografados
 * @param {CryptoKey} masterKey - A chave mestra derivada
 * @returns {Promise<string>} - String no formato "base64(iv):base64(ciphertext)"
 */
export const encryptData = async (jsonObject, masterKey) => {
  try {
    // 1. Gerar IV (Initialization Vector) aleatório de 12 bytes para AES-GCM
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    // 2. Converter o objeto JSON para string e depois para ArrayBuffer
    const jsonString = JSON.stringify(jsonObject);
    const encodedData = getMessageEncoding(jsonString);
    
    // 3. Criptografar
    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      masterKey,
      encodedData
    );
    
    // 4. Converter IV e Ciphertext para Base64 e concatenar
    const ivBase64 = bufferToBase64(iv);
    const ciphertextBase64 = bufferToBase64(ciphertextBuffer);
    
    return `${ivBase64}:${ciphertextBase64}`;
  } catch (error) {
    console.error('Erro ao criptografar dados:', error);
    throw new Error('Falha na criptografia dos dados');
  }
};

/**
 * Descriptografa uma string criptografada e retorna o objeto JSON original.
 * @param {string} encryptedText - String no formato "base64(iv):base64(ciphertext)"
 * @param {CryptoKey} masterKey - A chave mestra derivada
 * @returns {Promise<Object>} - O objeto JSON original
 */
export const decryptData = async (encryptedText, masterKey) => {
  try {
    if (!encryptedText || !encryptedText.includes(':')) {
      throw new Error('Formato de dados criptografados inválido');
    }

    // 1. Separar IV e Ciphertext
    const [ivBase64, ciphertextBase64] = encryptedText.split(':');
    
    // 2. Converter de Base64 para ArrayBuffer
    const iv = base64ToBuffer(ivBase64);
    const ciphertextBuffer = base64ToBuffer(ciphertextBase64);
    
    // 3. Descriptografar
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(iv)
      },
      masterKey,
      ciphertextBuffer
    );
    
    // 4. Decodificar para string e parsear JSON
    const decryptedString = getMessageDecoding(decryptedBuffer);
    return JSON.parse(decryptedString);
  } catch (error) {
    console.error('Erro ao descriptografar dados:', error);
    throw new Error('Falha na descriptografia dos dados. A chave pode estar incorreta.');
  }
};

/**
 * Lê um arquivo e converte para Base64
 * @param {File} file - O arquivo a ser lido
 * @returns {Promise<string>} - O conteúdo do arquivo em Base64
 */
export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
};

/**
 * Criptografa um arquivo
 * @param {File} file - O arquivo a ser criptografado
 * @param {CryptoKey} masterKey - A chave mestra
 * @returns {Promise<string>} - O arquivo criptografado
 */
export const encryptFile = async (file, masterKey) => {
  if (!file) return null;
  
  try {
    // 1. Converter arquivo para Base64
    const base64Data = await fileToBase64(file);
    
    // 2. Criptografar a string Base64 (junto com o nome e tipo original)
    const fileData = {
      name: file.name,
      type: file.type,
      size: file.size,
      data: base64Data
    };
    
    return await encryptData(fileData, masterKey);
  } catch (error) {
    console.error('Erro ao criptografar arquivo:', error);
    throw new Error('Falha na criptografia do arquivo');
  }
};

/**
 * Converte Base64 para Blob para download
 * @param {string} base64 - O conteúdo em Base64 (incluindo prefixo data:mime/type;base64,)
 * @returns {Blob} - O arquivo como Blob
 */
export const base64ToBlob = (base64) => {
  const parts = base64.split(';base64,');
  const contentType = parts[0].split(':')[1];
  const raw = window.atob(parts[1]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);
  
  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }
  
  return new Blob([uInt8Array], { type: contentType });
};

/**
 * Cria um link temporário e dispara o download do arquivo
 * @param {Blob} blob - O arquivo como Blob
 * @param {string} fileName - O nome do arquivo
 */
export const downloadBlob = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
};
