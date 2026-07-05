FROM node:20-alpine

WORKDIR /usr/src/app

# Copiar os arquivos de dependências
COPY package*.json ./

# Instalar docker-cli, compose plugin e git para o WebUpdater
RUN apk add --no-cache docker-cli docker-cli-compose git

# Instalar dependências
RUN npm install

# Copiar o resto do código
COPY . .

# Expor a porta da aplicação
EXPOSE 3000

# Comando para iniciar em desenvolvimento (usando nodemon se disponível)
CMD ["npm", "run", "dev"]
