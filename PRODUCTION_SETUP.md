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
wget https://raw.githubusercontent.com/seu-usuario/fullpassword/main/scripts/install.sh
chmod +x install.sh
./install.sh
```

O script solicitará:
- Domínio (ex: `cofre.suaempresa.com.br`)
- E-mail para Let's Encrypt
- Porta SSH (se não for a padrão 22)
- URL do repositório GitHub

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

2. **Usuário Administrador Padrão**
   - Email: `admin@admin.com.br`
   - Senha: `@dmin123` (⚠️ Alterar imediatamente!)

3. **JWT Secret**
   - Gerado aleatoriamente (64 caracteres hex)

## ⚠️ Ações Imediatas Pós-Instalação

1. Acesse `https://seu-dominio.com.br`
2. Faça login com `admin@admin.com.br` / `@dmin123`
3. **ALTERE A SENHA DO ADMINISTRADOR IMEDIATAMENTE**
4. Crie novos usuários e grupos conforme necessário
5. Teste o cofre salvando algumas credenciais

## 🛠️ Manutenção

**Localização do projeto:**
```bash
/opt/fullpassword
```

**Comandos úteis:**
```bash
# Ver logs do backend
docker-compose logs -f backend

# Reiniciar todos os serviços
docker-compose restart

# Atualizar para nova versão
git pull
docker-compose up -d --build

# Verificar status
docker-compose ps
```

## 🔄 Renovação de Certificado SSL

O Let's Encrypt é renovado automaticamente pelo Certbot. Para verificar:
```bash
certbot renew --dry-run
```

## 🚨 Troubleshooting

**Problema: "Certificado não gerado"**
- Verifique se o DNS está apontando corretamente
- Aguarde alguns minutos para propagação de DNS
- Verifique se as portas 80/443 estão abertas

**Problema: "Nginx não inicia"**
- Verifique se o nginx do host não está rodando: `systemctl stop nginx`
- Verifique os logs: `docker-compose logs nginx`

**Problema: "Conexão recusada no banco"**
- Verifique se o container do PostgreSQL está rodando: `docker-compose ps`
- Verifique os logs: `docker-compose logs db`

## 📚 Documentação Adicional

- **DEPLOY.md**: Guia detalhado de deploy
- **frontend/CRYPTO_IMPLEMENTATION.md**: Detalhes da criptografia Zero-Knowledge
- **backend/README.md**: Documentação da API

## 🎯 Próximos Passos

1. Configurar backups automáticos do banco de dados
2. Implementar monitoramento e alertas
3. Configurar auto-scaling se necessário
4. Implementar CI/CD para atualizações automáticas
5. Auditar logs de acesso regularmente

## 📞 Suporte

Para problemas ou dúvidas, consulte a documentação ou abra uma issue no repositório GitHub.

---

**FullPassword v1.0** - Sistema de Gerenciamento de Senhas Zero-Knowledge para MSPs
