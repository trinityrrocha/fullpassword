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
export const deriveMasterKey = async (password, saltString = 'fullpassword-salt-super-seguro-123') => {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const salt = enc.encode(saltString);

  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true, // Permite exportar a chave para wrap/unwrap
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
};

/**
 * Gera uma nova Master Key aleatória (AES-GCM 256)
 */
export const generateMasterKey = async () => {
  return await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
};

/**
 * Envelopa (Wraps) a Master Key usando uma Key Encryption Key (KEK) derivada da senha
 * @param {CryptoKey} masterKey - A chave mestra a ser protegida
 * @param {CryptoKey} kek - A chave derivada da senha do usuário
 * @returns {Promise<string>} - A chave mestra envelopada em formato Base64 (iv:ciphertext)
 */
export const wrapMasterKey = async (masterKey, kek) => {
  try {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    const wrappedKeyBuffer = await window.crypto.subtle.wrapKey(
      'raw',
      masterKey,
      kek,
      { name: 'AES-GCM', iv: iv }
    );
    
    const ivBase64 = bufferToBase64(iv);
    const wrappedKeyBase64 = bufferToBase64(wrappedKeyBuffer);
    
    return `${ivBase64}:${wrappedKeyBase64}`;
  } catch (error) {
    console.error('Erro ao envelopar Master Key:', error);
    throw new Error('Falha ao proteger a chave mestra');
  }
};

/**
 * Desenvelopa (Unwraps) a Master Key usando a KEK derivada da senha
 * @param {string} wrappedKeyStr - A chave envelopada (iv:ciphertext)
 * @param {CryptoKey} kek - A chave derivada da senha do usuário
 * @returns {Promise<CryptoKey>} - A Master Key original
 */
export const unwrapMasterKey = async (wrappedKeyStr, kek) => {
  try {
    if (!wrappedKeyStr || !wrappedKeyStr.includes(':')) {
      throw new Error('Formato de chave envelopada inválido');
    }

    const [ivBase64, wrappedKeyBase64] = wrappedKeyStr.split(':');
    const iv = base64ToBuffer(ivBase64);
    const wrappedKeyBuffer = base64ToBuffer(wrappedKeyBase64);

    return await window.crypto.subtle.unwrapKey(
      'raw',
      wrappedKeyBuffer,
      kek,
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  } catch {
    console.warn('Não foi possível desenvelopar a Master Key com a credencial informada.');
    throw new Error('Senha mestre incorreta'); 
  }
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
  } catch {
    console.warn('Não foi possível descriptografar os dados com a chave disponível.');
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

/**
 * Geração e Gerenciamento de Chaves Assimétricas (RSA-OAEP)
 * Usado para compartilhamento seguro de cofres
 */

// Gera um par de chaves RSA-OAEP (2048 bits)
export const generateRSAKeyPair = async () => {
  return await window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), // 65537
      hash: "SHA-256",
    },
    true, // extractable
    ["encrypt", "decrypt"]
  );
};

// Exporta a chave pública RSA para string Base64 (formato SPKI)
export const exportPublicKey = async (publicKey) => {
  const exported = await window.crypto.subtle.exportKey("spki", publicKey);
  const exportedAsString = String.fromCharCode.apply(null, new Uint8Array(exported));
  return window.btoa(exportedAsString);
};

// Importa a chave pública RSA de string Base64 (formato SPKI)
export const importPublicKey = async (pemStr) => {
  const binaryDerString = window.atob(pemStr);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }
  return await window.crypto.subtle.importKey(
    "spki",
    binaryDer.buffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"]
  );
};

// Exporta a chave privada RSA e a criptografa (envelopa) com a Master Key usando AES-GCM
export const encryptPrivateKey = async (privateKey, masterKey) => {
  // 1. Exporta a chave privada para formato PKCS8
  const exported = await window.crypto.subtle.exportKey("pkcs8", privateKey);
  
  // 2. Criptografa o buffer exportado com a Master Key
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    masterKey,
    exported
  );

  // 3. Retorna no formato iv:ciphertext em Base64
  const ivB64 = window.btoa(String.fromCharCode.apply(null, iv));
  const ciphertextB64 = window.btoa(String.fromCharCode.apply(null, new Uint8Array(ciphertext)));
  return `${ivB64}:${ciphertextB64}`;
};

// Descriptografa a chave privada RSA usando a Master Key e a importa
export const decryptPrivateKey = async (encryptedPrivateKeyStr, masterKey) => {
  const [ivB64, ciphertextB64] = encryptedPrivateKeyStr.split(':');
  const iv = Uint8Array.from(window.atob(ivB64), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(window.atob(ciphertextB64), c => c.charCodeAt(0));

  // 1. Descriptografa o buffer
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    masterKey,
    ciphertext
  );

  // 2. Importa a chave privada
  return await window.crypto.subtle.importKey(
    "pkcs8",
    decryptedBuffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["decrypt"]
  );
};
