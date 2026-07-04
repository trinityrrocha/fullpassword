#!/bin/bash

# ==============================================================================
# FullPassword - Script de Auto-Instalação e Deploy para Produção
# SO Suportado: Ubuntu 20.04/22.04 LTS ou Debian 11/12
# ==============================================================================

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}   Instalador Automatizado FullPassword (Zero-Knowledge) ${NC}"
echo -e "${BLUE}======================================================${NC}"

# Verificar se é root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Por favor, execute este script como root (sudo ./install.sh)${NC}"
  exit 1
fi

# ==========================================
# 1. COLETA DE VARIÁVEIS DO USUÁRIO
# ==========================================
echo -e "\n${YELLOW}--- Configurações Iniciais ---${NC}"

read -p "Digite o domínio para o FullPassword (ex: cofre.seudominio.com.br): " DOMAIN
read -p "Digite seu e-mail (para o certificado Let's Encrypt): " LETSENCRYPT_EMAIL
read -p "Digite a porta SSH atual da sua VPS [Padrão: 22]: " SSH_PORT
SSH_PORT=${SSH_PORT:-22}
read -p "Digite a URL do repositório GitHub (ex: https://github.com/usuario/fullpassword.git): " REPO_URL

# Geração de senhas fortes automáticas
DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
JWT_SECRET=$(openssl rand -hex 64)

# ==========================================
# 2. ATUALIZAÇÃO E DEPENDÊNCIAS BÁSICAS
# ==========================================
echo -e "\n${GREEN}[1/6] Atualizando pacotes do sistema e instalando dependências...${NC}"
apt-get update && apt-get upgrade -y
apt-get install -y curl git ufw fail2ban certbot python3-certbot-nginx apt-transport-https ca-certificates software-properties-common

# ==========================================
# 3. SEGURANÇA DA INFRAESTRUTURA (UFW E FAIL2BAN)
# ==========================================
echo -e "\n${GREEN}[2/6] Configurando Firewall (UFW) e Fail2Ban...${NC}"

# Configurar UFW
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow $SSH_PORT/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Configurar Fail2Ban para SSH
cat > /etc/fail2ban/jail.local << EOF
[sshd]
enabled = true
port = $SSH_PORT
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600
EOF

systemctl restart fail2ban
systemctl enable fail2ban

# ==========================================
# 4. INSTALAÇÃO DO DOCKER E DOCKER COMPOSE
# ==========================================
echo -e "\n${GREEN}[3/6] Verificando/Instalando Docker e Docker Compose...${NC}"

if ! command -v docker &> /dev/null; then
    echo "Instalando Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    systemctl start docker
    systemctl enable docker
else
    echo "Docker já está instalado."
fi

if ! command -v docker-compose &> /dev/null; then
    echo "Instalando Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
else
    echo "Docker Compose já está instalado."
fi

# ==========================================
# 5. CLONE DO REPOSITÓRIO E CONFIGURAÇÃO
# ==========================================
echo -e "\n${GREEN}[4/6] Clonando repositório e configurando ambiente...${NC}"

APP_DIR="/opt/fullpassword"

if [ -d "$APP_DIR" ]; then
    echo -e "${YELLOW}O diretório $APP_DIR já existe. Fazendo backup...${NC}"
    mv $APP_DIR "${APP_DIR}_backup_$(date +%Y%m%d_%H%M%S)"
fi

git clone $REPO_URL $APP_DIR
cd $APP_DIR

# Criar arquivo .env de produção
echo -e "\n${GREEN}Gerando arquivo .env de produção...${NC}"
cat > $APP_DIR/.env << EOF
# Configurações de Banco de Dados
DB_HOST=db
DB_PORT=5432
DB_USER=fullpassword_user
DB_PASSWORD=$DB_PASSWORD
DB_NAME=fullpassword_db

# Configurações do Backend
PORT=3000
NODE_ENV=production
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=8h

# Configurações do Frontend
VITE_API_URL=https://$DOMAIN/api
EOF

# Substituir o domínio no nginx.conf (se existir um template)
if [ -f "$APP_DIR/docker/nginx.conf" ]; then
    sed -i "s/server_name localhost;/server_name $DOMAIN;/g" $APP_DIR/docker/nginx.conf
fi

# ==========================================
# 6. CERTIFICADO SSL (LET'S ENCRYPT)
# ==========================================
echo -e "\n${GREEN}[5/6] Provisionando Certificado SSL Let's Encrypt para $DOMAIN...${NC}"

# Parar o nginx temporariamente se estiver rodando para liberar a porta 80
systemctl stop nginx 2>/dev/null || true

# Obter o certificado (standalone)
certbot certonly --standalone -d $DOMAIN --non-interactive --agree-tos -m $LETSENCRYPT_EMAIL

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Certificado SSL gerado com sucesso!${NC}"
    
    # Atualizar o nginx.conf para usar SSL
    cat > $APP_DIR/docker/nginx.conf << EOF
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Frontend (React)
    location / {
        proxy_pass http://frontend:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    # Backend API (Node.js)
    location /api/ {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
else
    echo -e "${RED}Falha ao gerar o certificado SSL. O Nginx será configurado apenas para HTTP (não recomendado para Web Crypto API).${NC}"
    echo -e "${YELLOW}Certifique-se de que o DNS de $DOMAIN aponta para o IP desta VPS.${NC}"
fi

# ==========================================
# 7. DEPLOY COM DOCKER COMPOSE
# ==========================================
echo -e "\n${GREEN}[6/6] Iniciando os containers com Docker Compose...${NC}"

# Garantir que o nginx no host não conflite com o container
systemctl disable nginx 2>/dev/null || true
systemctl stop nginx 2>/dev/null || true

# Subir os containers
docker-compose up -d --build

echo -e "\n${BLUE}======================================================${NC}"
echo -e "${GREEN}  Instalação Concluída com Sucesso! ${NC}"
echo -e "${BLUE}======================================================${NC}"
echo -e "\n${YELLOW}Credenciais de Banco de Dados geradas (salvas no .env):${NC}"
echo -e "DB_USER: fullpassword_user"
echo -e "DB_PASSWORD: $DB_PASSWORD"
echo -e "\n${YELLOW}Credenciais do Sistema (Seeder padrão):${NC}"
echo -e "Email: admin@admin.com.br"
echo -e "Senha: @dmin123 (Recomendado alterar imediatamente)"
echo -e "\n${GREEN}Acesse o sistema em: https://$DOMAIN${NC}"
echo -e "${BLUE}======================================================${NC}"
