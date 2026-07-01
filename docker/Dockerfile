# syntax=docker/dockerfile:1.7

# ---- deps ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Prisma's query/migration engines need OpenSSL at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN useradd --uid 10001 --create-home armstrong
COPY --from=build --chown=armstrong:armstrong /app/node_modules ./node_modules
COPY --from=build --chown=armstrong:armstrong /app/dist ./dist
COPY --from=build --chown=armstrong:armstrong /app/prisma ./prisma
# prisma.config.ts + package.json are needed by `prisma migrate deploy`
# (Prisma 7 reads datasource.url from the config file, not the schema).
COPY --from=build --chown=armstrong:armstrong /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=armstrong:armstrong /app/package.json ./package.json
USER armstrong
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
