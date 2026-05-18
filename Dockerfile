# syntax=docker/dockerfile:1.7

# --- Build stage --------------------------------------------------------------
FROM node:25-alpine AS builder

WORKDIR /app

# Dependências de build do better-sqlite3 e argon2.
RUN apk add --no-cache python3 make g++ && ln -sf python3 /usr/bin/python

COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY tsconfig*.json biome.json vite.config.ts vitest.config.ts drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle

# Build apenas do front-end (web). O server roda direto do TS via tsx.
RUN npm run build

# Limpa dev deps para a imagem final.
RUN rm -rf node_modules \
 && npm ci --omit=dev \
 && npm cache clean --force

# --- Runtime stage ------------------------------------------------------------
FROM node:25-alpine AS runner

LABEL org.opencontainers.image.title="mm-metricas-unifi"
LABEL org.opencontainers.image.description="Coleta e BI de métricas UniFi"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/guiloklex-hub/mm-metricas-unifi"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/app.db

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app \
 && mkdir -p /app/data \
 && chown -R app:app /app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/drizzle ./drizzle
COPY --from=builder --chown=app:app /app/src ./src
COPY --from=builder --chown=app:app /app/tsconfig.json /app/tsconfig.server.json ./
COPY --from=builder --chown=app:app /app/package.json ./package.json

USER app

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 || exit 1

CMD ["npx", "tsx", "src/server/index.ts"]
