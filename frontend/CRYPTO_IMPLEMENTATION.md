# Implementação de Criptografia Zero-Knowledge - FullPassword

## Visão Geral da Arquitetura

O FullPassword implementa uma arquitetura **Zero-Knowledge** onde toda a criptografia é feita no navegador do cliente. O backend nunca tem acesso a dados sensíveis em texto claro.

## Fluxo de Criptografia

### 1. Login e Derivação da Master Key

Quando o usuário faz login:

```
1. Email + Senha (texto claro) → API Login por HTTPS
2. Backend valida credenciais e cria a sessão em cookie HttpOnly
3. Frontend recebe wrapped_key, salt único e metadados KDF do usuário
4. Frontend deriva a KEK com PBKDF2-SHA-256 e desenvelopa a Master Key
5. Dados legados sem metadados usam 100.000 iterações; novos wraps usam 310.000
6. Master Key fica APENAS na memória do React (AuthContext)
```

**Crítico**: A Master Key **nunca** é salva no localStorage. Se a página for recarregada (F5), o usuário precisa redigitar a senha para derivar a chave novamente.

### 2. Criptografia de Dados (Salvamento)

Quando o usuário salva um item no cofre:

```
1. Formulário preenchido (cpanelForm, vpnForm, etc)
2. handleSaveData() é chamado
3. Gera IV (Initialization Vector) aleatório de 12 bytes
4. Converte objeto JSON para string
5. Criptografa com AES-256-GCM usando a Master Key
6. Concatena: base64(IV):base64(ciphertext)
7. Envia encrypted_data para o backend via Axios
8. Backend armazena como TEXT sem descriptografar
```

### 3. Descriptografia de Dados (Leitura)

Quando o usuário acessa o cofre:

```
1. Frontend faz GET /api/vault-items/:clientId
2. Backend retorna array de items com encrypted_data
3. Para cada item:
   a. Separa IV e ciphertext do formato "base64(IV):base64(ciphertext)"
   b. Descriptografa com AES-256-GCM usando a Master Key
   c. Converte de volta para objeto JSON
   d. Popula os formulários
4. Se a Master Key estiver incorreta, a descriptografia falha
```

## Arquivos de Implementação

### `/services/cryptoService.js`

Serviço principal de criptografia usando Web Crypto API nativa:

- **`deriveMasterKey(password, salt, params)`**: Deriva a KEK usando PBKDF2 versionado
- **`encryptData(jsonObject, masterKey)`**: Criptografa objeto JSON com AES-256-GCM
- **`decryptData(encryptedText, masterKey)`**: Descriptografa dados
- **`encryptFile(file, masterKey)`**: Criptografa arquivo anexado
- **`base64ToBlob(base64)`**: Converte Base64 para Blob para download
- **`downloadBlob(blob, fileName)`**: Faz download do arquivo descriptografado

### `/context/AuthContext.jsx`

Contexto React que gerencia:

- **`user`**: Dados do usuário (não sensível)
- **Sessão**: Mantida pelo cookie HttpOnly, não por storage do navegador
- **`masterKey`**: Chave criptográfica (APENAS na memória)
- **`isVaultUnlocked`**: Indica se a Master Key está disponível
- **`login(email, password)`**: Autentica e deriva a Master Key
- **`unlockVault(password)`**: Rederiva a Master Key após recarga
- **`logout()`**: Limpa tudo da memória

### `/services/api.js`

Cliente Axios configurado com:

- Interceptor para adicionar JWT em todas as requisições
- Tratamento de erro 401 (token expirado)

### `/pages/ClientVault.jsx`

Página principal do cofre com:

- **`loadVaultItems()`**: Carrega e descriptografa todos os itens
- **`handleSaveData(category, data)`**: Criptografa e salva dados
- **`handleUnlock(password)`**: Desbloqueia o cofre após recarga
- **`handleDownloadAttachment(item)`**: Descriptografa e faz download de anexos

## Fluxo de Segurança Completo

### Cenário: Usuário salva credenciais de cPanel

```
1. Usuário preenche formulário de cPanel
   - URL: https://cpanel.dominio.com.br
   - Usuário: admin
   - Senha: senha_super_secreta

2. Clica em "Salvar cPanel"

3. handleSaveData('cPanel', cpanelForm) é chamado

4. Verifica se isVaultUnlocked (Master Key está em memória)

5. Criptografa o objeto:
   {
     url: "https://cpanel.dominio.com.br",
     username: "admin",
     password: "senha_super_secreta",
     email: "admin@dominio.com.br",
     emailPassword: "email_pass",
     isSystem: true
   }

6. Gera IV aleatório e criptografa com AES-256-GCM

7. Resultado: "base64(IV):base64(ciphertext)"

8. Envia para API:
   POST /api/vault-items/:clientId
   {
     category: "cPanel",
     encrypted_data: "base64(IV):base64(ciphertext)",
     metadata: { category: "cPanel", description: "...", timestamp: "..." }
   }

9. Backend armazena no banco de dados SEM descriptografar

10. Usuário vê mensagem de sucesso
```

### Cenário: Usuário recarrega a página (F5)

```
1. Página recarrega

2. AuthProvider restaura JWT do localStorage

3. Mas Master Key é perdida (não estava no localStorage)

4. isVaultUnlocked = false

5. Quando usuário tenta acessar o cofre, vê tela de "Cofre Bloqueado"

6. Insere sua senha mestre novamente

7. handleUnlock() chama unlockVault(password)

8. Master Key é rederivada e colocada em memória

9. loadVaultItems() é chamado e descriptografa todos os dados

10. Formulários são populados com os dados descriptografados
```

## Considerações de Segurança

### ✅ O que está seguro

- **Dados em repouso**: Armazenados criptografados no banco de dados
- **Dados em trânsito**: Enviados via HTTPS (em produção)
- **Dados em memória**: Master Key fica apenas no React, não em localStorage
- **Chaves derivadas**: PBKDF2-SHA-256 versionado; 310.000 iterações para novos wraps
- **Compatibilidade**: PBKDF2-100.000 e RSA-2048 legados continuam utilizáveis
- **Novas chaves RSA**: RSA-OAEP 3072 bits
- **Criptografia**: AES-256-GCM com IV aleatório (autenticação incluída)

### ⚠️ Limitações e Considerações

1. **Recarregar a página**: Master Key é perdida. Usuário precisa redigitar a senha.
2. **Logout**: Master Key é limpa da memória.
3. **Múltiplas abas**: Cada aba tem seu próprio contexto React (não sincronizam).
4. **Navegador comprometido**: Se o navegador for hackeado, a Master Key pode ser exposta.
5. **KDF no navegador**: PBKDF2 permanece em uso; Argon2id client-side exige avaliação futura de bundle e desempenho.

## Próximas Melhorias

1. **Argon2id client-side**: Avaliar em etapa separada com benchmark de navegadores
2. **Biometria**: Usar WebAuthn/FIDO2 para autenticação sem senha
3. **Sincronização entre abas**: Usar SharedWorker ou BroadcastChannel
5. **Auditoria**: Log de acessos ao cofre
6. **Backup criptografado**: Permitir exportar dados criptografados

## Testes Recomendados

```javascript
// Teste 1: Criptografia e descriptografia
const masterKey = await deriveMasterKey('senha123');
const data = { url: 'https://example.com', password: 'secret' };
const encrypted = await encryptData(data, masterKey);
const decrypted = await decryptData(encrypted, masterKey);
assert(decrypted.password === 'secret');

// Teste 2: Chave incorreta
const wrongKey = await deriveMasterKey('senha_errada');
try {
  await decryptData(encrypted, wrongKey);
  assert(false, 'Deveria ter falhado');
} catch (e) {
  assert(e.message.includes('falha na descriptografia'));
}

// Teste 3: Arquivo
const file = new File(['conteúdo'], 'test.txt');
const encryptedFile = await encryptFile(file, masterKey);
const decryptedFile = await decryptData(encryptedFile, masterKey);
assert(decryptedFile.name === 'test.txt');
```

## Conclusão

A implementação de criptografia Zero-Knowledge garante que:

1. **Nenhum dado sensível** sai do navegador em texto claro
2. **O backend** nunca tem acesso às senhas ou credenciais
3. **Apenas o usuário** pode descriptografar seus dados
4. **A segurança** é garantida pela Web Crypto API nativa do navegador
