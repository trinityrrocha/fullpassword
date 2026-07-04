FROM node:20-alpine

WORKDIR /usr/src/app

# Copiar os arquivos de dependências
COPY package*.json ./

# Instalar dependências
RUN npm install

# Copiar o resto do código
COPY . .

# Expor a porta do Vite
EXPOSE 5173

# Comando para iniciar o Vite com host 0.0.0.0
CMD ["npm", "run", "dev", "--", "--host"]
