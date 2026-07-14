# FullPassword - Configuração de Produção (Resumo Executivo)

## 🚀 Deploy em 3 Passos

### Passo 1: Preparação do Domínio
Certifique-se de que seu domínio (ex: `cofre.suaempresa.com.br`) está apontando para o IP público da sua VPS via registro DNS A.

### Passo 2: Acesso à VPS
```bash
ssh root@seu_ip_da_vps
```

### Passo 3: Executar o Instalador
```bash
wget https://raw.githubusercontent.com/trinityrrocha/fullpassword/main/scripts/install.sh
chmod +x install.sh
./install.sh
```

O script solicitará:
- Domínio (ex: `cofre.suaempresa.com.br`)
- E-mail para Let's Encrypt, também usado como e-mail inicial do Super Admin
- Porta SSH (se não for a padrão 22)

## 📋 O que é Instalado Automaticamente

| Componente | Função | Porta |
|-----------|--------|-------|
| **PostgreSQL** | Banco de dados criptografado | 5432 (interno) |
| **Node.js Backend** | API REST com autenticação JWT | 3000 (interno) |
| **React Frontend** | Interface Zero-Knowledge | 5173 (interno) |
| **Nginx** | Proxy reverso com SSL/TLS | 80, 443 |
| **UFW** | Firewall de rede | SSH, 80, 443 |
| **Fail2Ban** | Proteção contra força bruta SSH | SSH |
| **Let's Encrypt** | Certificado SSL/TLS gratuito | 443 |

## 🔐 Segurança Implementada

- **Firewall (UFW)**: Bloqueia todas as portas exceto SSH, HTTP e HTTPS
- **Fail2Ban**: Banir IPs após 5 tentativas falhadas de SSH
- **SSL/TLS**: Certificado Let's Encrypt renovado automaticamente
- **CORS**: Backend aceita apenas requisições do frontend
- **Helmet**: Headers HTTP de segurança
- **Argon2id**: Hashing de senhas no backend
- **AES-256-GCM**: Criptografia de dados no frontend
- **Web Crypto API**: Zero-Knowledge (dados nunca saem em texto claro)

## 📊 Arquitetura de Deploy

```
Internet (HTTPS)
    ↓
Nginx (Proxy Reverso + SSL)
    ├─→ Frontend (React/Vite) :5173
    └─→ Backend API (Node.js) :3000
            ↓
        PostgreSQL :5432
```

## 🔑 Credenciais Geradas

Após a instalação, o script exibirá:

1. **Banco de Dados**
   - Usuário: `fullpassword_user`
   - Senha: Gerada aleatoriamente (24+ caracteres)

2. **Super Admin inicial**
   - E-mail: o mesmo informado para o certificado Let's Encrypt
   - Senha temporária: gerada automaticamente com 32 caracteres aleatórios
   - Flags: `is_super_admin=true` e `must_change_password=true`

3. **JWT Secret**
   - Gerado aleatoriamente (64 caracteres hex)

As credenciais iniciais também são salvas em `/root/fullpassword-install-info.txt` com permissão `600`.

## ⚠️ Ações Imediatas Pós-Instalação

1. Acesse `https://seu-dominio.com.br`
2. Entre com o e-mail e a senha temporária exibidos pelo instalador
3. Troque obrigatoriamente a senha temporária no primeiro login
4. Crie novos usuários e grupos conforme necessário
5. Teste o cofre salvando algumas credenciais

## 🛠️ Manutenção

O acesso SSH é usado somente na primeira instalação. Depois disso, o fluxo operacional não exige configuração manual recorrente por terminal.

Atualizações devem ser feitas por **Configurações do Sistema > WebUpdater**, exclusivamente pelo Super Admin identificado por `is_super_admin=true`. O e-mail inicial pode ser alterado posteriormente sem remover essa permissão.

## 🔄 Renovação de Certificado SSL

O Let's Encrypt é renovado automaticamente pelo Certbot, sem exigir manutenção recorrente por SSH.

## 🚨 Troubleshooting

**Problema: "Certificado não gerado"**
- Verifique se o DNS está apontando corretamente
- Aguarde alguns minutos para propagação de DNS
- Verifique se as portas 80/443 estão abertas

**Problema: "Nginx não inicia"**
- Confirme que a instalação inicial foi concluída e que `docker/nginx.runtime.conf` foi gerado
- Verifique no provedor se as portas 80/443 continuam liberadas

**Problema: "Conexão recusada no banco"**
- Use os recursos de diagnóstico disponibilizados pelo painel e pelo provedor da VPS
- Se o sistema não estiver acessível, registre o incidente antes de qualquer intervenção manual

## 📚 Documentação Adicional

- **DEPLOY.md**: Guia detalhado de deploy
- **frontend/CRYPTO_IMPLEMENTATION.md**: Detalhes da criptografia Zero-Knowledge
- **backend/README.md**: Documentação da API

## 🎯 Próximos Passos

1. Configurar backups automáticos do banco de dados
2. Implementar monitoramento e alertas
3. Configurar auto-scaling se necessário
4. Manter o WebUpdater como fluxo oficial de atualização
5. Auditar logs de acesso regularmente

## 📞 Suporte

Para problemas ou dúvidas, consulte a documentação ou abra uma issue no repositório GitHub.

---

**FullPassword v1.0** - Sistema de Gerenciamento de Senhas Zero-Knowledge para MSPs
