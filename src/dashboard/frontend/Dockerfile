# syntax=docker/dockerfile:1.7
# Next.js dashboard frontend — standalone output for a small runtime image.

# ---- deps ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# BACKEND_ORIGIN is only read at runtime (rewrites run per-request), so the
# build does not need it. next build emits .next/standalone.
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=5173
ENV HOSTNAME=0.0.0.0
WORKDIR /app
RUN useradd --uid 10002 --create-home nextjs
# Standalone server + static assets.
COPY --from=build --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/.next/static ./.next/static
USER nextjs
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5173/login', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["node", "server.js"]
