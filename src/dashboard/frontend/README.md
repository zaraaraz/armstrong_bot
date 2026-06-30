# Ghost Bot Dashboard (Frontend)

Next.js (App Router) SPA — a **separate deployable** that consumes only the
Dashboard Backend BFF (`/api/dashboard/*`). It never talks to Discord, Prisma,
Redis or other modules directly.

## Status

This is the **scaffold** delivered in Phase 3 (backend-first). It includes:

- App Router structure, root + guild shell layouts
- Edge `middleware.ts` session-cookie route guard
- Login page → backend OAuth redirect; guild selector; overview page
- Typed BFF client (`lib/api/client.ts`) and realtime hook (`lib/realtime`)

## Deferred to a follow-up

The remaining guild pages (modules, config, logs, analytics, permissions,
translations, plugins, full api-keys/backups CRUD UI) and the Playwright e2e
suite are intentionally deferred — they depend on module public APIs that land
in later roadmap phases. Each new page drops into `app/g/[guildId]/<page>` and
calls a typed method on `lib/api/client.ts`.

## Develop

```bash
cd src/dashboard/frontend
npm install
BACKEND_ORIGIN=http://localhost:3000 npm run dev   # serves on :5173
```

## Generate the typed client

The committed `lib/api/client.ts` is hand-written to mirror the backend
contracts. To regenerate from the live OpenAPI document once the backend is
running:

```bash
# example using openapi-typescript (add as a devDependency when wiring CI)
npx openapi-typescript http://localhost:3000/api/docs/json -o lib/api/schema.d.ts
```
