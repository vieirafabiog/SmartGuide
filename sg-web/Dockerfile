# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app

ARG EXPO_PUBLIC_API_URL=/api
ARG EXPO_PUBLIC_DEFAULT_LOCALE=pt-BR
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}
ENV EXPO_PUBLIC_DEFAULT_LOCALE=${EXPO_PUBLIC_DEFAULT_LOCALE}

COPY sg-web/package.json sg-web/package-lock.json ./
RUN npm ci

COPY sg-web/ ./
RUN npx expo export --platform web

FROM nginx:1.27-alpine AS runner

COPY docker/nginx/sg-web.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
