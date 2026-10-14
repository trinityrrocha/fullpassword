FROM node:24.21.0-alpine@sha256:4b2d7eef36889f0aec0d58d1b19778321176c67824b7c951352d86c5c7811d44

WORKDIR /usr/src/app

# Copiar os arquivos de dependências
COPY package*.json ./

# Instalar dependências
RUN npm ci --omit=dev

# Copiar o resto do código
COPY --chown=node:node . .
RUN mkdir -p /var/lib/fullpassword-updater /var/lib/fullpassword-backups \
    && chown -R node:node /var/lib/fullpassword-updater /var/lib/fullpassword-backups
USER node

ARG BACKEND_APP_COMMIT=unknown
ENV BACKEND_APP_COMMIT=$BACKEND_APP_COMMIT
ENV NODE_ENV=production

# Expor a porta da aplicação
EXPOSE 3000

# Falha de startup encerra o processo para o Docker reiniciá-lo.
CMD ["node", "src/server.js"]
