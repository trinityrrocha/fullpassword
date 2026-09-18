FROM node:24.21.0-alpine@sha256:4b2d7eef36889f0aec0d58d1b19778321176c67824b7c951352d86c5c7811d44

WORKDIR /usr/src/app

# Copiar os arquivos de dependências
COPY package*.json ./

# Instalar docker-cli, compose plugin e git para o WebUpdater
RUN apk add --no-cache docker-cli docker-cli-compose git

# Instalar dependências
RUN npm ci --omit=dev

# Copiar o resto do código
COPY . .

ARG BACKEND_APP_COMMIT=unknown
ENV BACKEND_APP_COMMIT=$BACKEND_APP_COMMIT
ENV NODE_ENV=production

# Expor a porta da aplicação
EXPOSE 3000

# Falha de startup encerra o processo para o Docker reiniciá-lo.
CMD ["node", "src/server.js"]
