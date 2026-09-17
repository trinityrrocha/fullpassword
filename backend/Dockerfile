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

ARG BACKEND_APP_COMMIT=unknown
ENV BACKEND_APP_COMMIT=$BACKEND_APP_COMMIT
ENV NODE_ENV=production

# Expor a porta da aplicação
EXPOSE 3000

# Falha de startup encerra o processo para o Docker reiniciá-lo.
CMD ["node", "src/server.js"]
