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
RUN useradd --uid 10001 --create-home armstrong
COPY --from=build --chown=armstrong:armstrong /app/node_modules ./node_modules
COPY --from=build --chown=armstrong:armstrong /app/dist ./dist
COPY --from=build --chown=armstrong:armstrong /app/prisma ./prisma
USER armstrong
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"
EXPOSE 3000
CMD ["node", "dist/main.js"]
