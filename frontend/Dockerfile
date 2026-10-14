FROM node:24.21.0-alpine@sha256:4b2d7eef36889f0aec0d58d1b19778321176c67824b7c951352d86c5c7811d44 AS build

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=/api
ARG VITE_APP_COMMIT=unknown
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_COMMIT=$VITE_APP_COMMIT
RUN npm run build
# Corrige modos herdados de um checkout feito sob umask 077, só nos artefatos públicos.
RUN find dist -type d -exec chmod 755 {} + && find dist -type f -exec chmod 644 {} +

FROM nginx:alpine@sha256:3a7edb153fcd67884f51775c8bed68a418fac7328a31d2be4c4ed5cae816ce8d

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /usr/src/app/dist /usr/share/nginx/html

EXPOSE 80
