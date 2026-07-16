FROM node:20-alpine AS build

WORKDIR /usr/src/app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

ARG VITE_API_URL=/api
ARG VITE_APP_COMMIT=unknown
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_COMMIT=$VITE_APP_COMMIT
RUN npm run build

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /usr/src/app/dist /usr/share/nginx/html

EXPOSE 80
