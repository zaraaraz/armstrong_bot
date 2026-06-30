# API

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - This document defines the **public REST + WebSocket + Webhook surface** only. It NEVER implements business logic — controllers delegate to Application Services, which use the Repository Pattern. Controllers NEVER touch Prisma or Redis directly.
> - Keep backwards compatibility: `/api/v1` is frozen once shipped. Breaking changes require `/api/v2`.
> - Create Prisma migrations for the `ApiKey`, `ApiKeyScope`, and `WebhookDelivery` models. Generate DTOs with `class-validator` + Zod, tests, and Swagger docs for every endpoint.
> - Use Dependency Injection everywhere. No `any` — every DTO, guard, and interceptor is fully typed. Keep methods small (<50 lines where reasonable).
> - Every list endpoint MUST support pagination (cursor + offset), the standard response envelope, caching via the Cache layer, and i18n error messages.
> - Create indexes for all searchable / lookup fields (`hashedKey`, `guildId`, `prefix`). Soft-delete API keys (`revokedAt`), never hard-delete.
> - All auth, rate limiting, and error shaping live in **cross-cutting Nest providers** (Guards, Interceptors, Filters) under `src/api`, not duplicated per controller.

---

## 1. Purpose

The **API unit** is the single, versioned HTTP + realtime ingress/egress boundary of Ghost Bot. It exposes a stable, documented, secured surface that the **dashboard** (first-party SPA) and **third-party integrations** (FiveM panels, CI systems, external automation) consume.

It is responsible for:

- Hosting all NestJS **controllers** under a versioned prefix (`/api/v1`).
- Providing **three authentication strategies**: Discord OAuth2 session (browser/dashboard), API keys (machine-to-machine), and JWT (short-lived service/internal tokens).
- Enforcing **rate limiting**, **request validation**, the **pagination envelope**, and the **error envelope** uniformly.
- Publishing a complete, auto-generated **Swagger/OpenAPI 3.1** contract.
- Hosting the **WebSocket gateway** for realtime dashboard updates (live logs, job progress, presence).
- Accepting **inbound webhooks** (Discord interaction callbacks, payment providers, GitHub) and routing them onto the Event Bus.

The API unit is **transport only**. It owns no domain rules — it authenticates, validates, shapes, and delegates.

## 2. Goals

- **Versioned & stable**: `/api/v1` never breaks once published; consumers can pin a version.
- **Self-documenting**: 100% of endpoints appear in Swagger with DTO schemas, examples, auth requirements, and error codes.
- **Uniform envelopes**: every success and every error has the same outer shape regardless of controller.
- **Multi-tenant safe**: every guild-scoped route resolves and authorizes the `guildId` before reaching a service.
- **Defense in depth**: auth → rate limit → validation → authorization (permissions) → handler, in that order.
- **Realtime**: dashboard receives push updates with the same auth/permission model as REST.
- **Observable**: every request is traced (OpenTelemetry), logged (Pino), and metered (Prometheus) with correlation IDs.
- **Zero leakage**: internal errors, stack traces, and Prisma errors are never serialized to clients.

## 3. Architecture

The API unit sits at the top of the strict layer flow and fans out into modules' published Application Services:

```
            ┌────────────────────────────────────────────────┐
HTTP / WS → │  src/api  (transport boundary)                  │
            │  ┌──────────────────────────────────────────┐  │
            │  │ Guards:  Auth → RateLimit → Permissions    │  │
            │  │ Pipes:   ZodValidationPipe                 │  │
            │  │ Interceptors: Envelope, Logging, Trace     │  │
            │  │ Filters: GlobalExceptionFilter             │  │
            │  └──────────────────────────────────────────┘  │
            │                  Controllers                    │
            └───────────────────────┬────────────────────────┘
                                    │ (DI: public Application Services only)
                                    ▼
                  Application Service → Domain Service → Repository → DB
                                    │
                                    ▼  (realtime fan-out / ingress)
                              Event Bus  ⇄  WebSocket Gateway / Webhook Router
```

Key rules:

- Controllers depend **only** on a module's **published public service interface** (exported from that module's public API barrel), never on internal services or repositories.
- Cross-cutting concerns are global Nest providers registered once in `ApiModule`.
- The WebSocket gateway and webhook router are **subscribers** of the Event Bus for outbound pushes and **publishers** for inbound events — they never call domain logic directly.
- Caching of read responses happens through the **Cache layer** via a `@CacheResponse()` decorator, never `redis.get` in a controller.

## 4. Folder Structure

```text
src/api/
├── api.module.ts                      # Registers global guards, pipes, interceptors, filters
├── versioning.ts                      # URI versioning config (/api/v1)
├── swagger.ts                         # OpenAPI document builder + bootstrap
├── common/
│   ├── envelope/
│   │   ├── response-envelope.ts       # SuccessEnvelope<T>, PaginatedEnvelope<T>
│   │   ├── error-envelope.ts          # ErrorEnvelope, ApiErrorCode enum
│   │   └── envelope.interceptor.ts    # Wraps handler return in SuccessEnvelope
│   ├── pagination/
│   │   ├── page-query.dto.ts          # cursor/offset/limit/sort DTO
│   │   └── paginate.ts                # buildPaginatedEnvelope helper
│   ├── filters/
│   │   └── global-exception.filter.ts # Maps all throwables -> ErrorEnvelope
│   ├── interceptors/
│   │   ├── logging.interceptor.ts     # Pino request log + correlation id
│   │   ├── trace.interceptor.ts       # OTel span per request
│   │   └── cache.interceptor.ts       # @CacheResponse via Cache layer
│   ├── pipes/
│   │   └── zod-validation.pipe.ts     # Zod schema -> typed DTO
│   └── decorators/
│       ├── current-user.decorator.ts  # @CurrentUser(): AuthenticatedActor
│       ├── current-guild.decorator.ts # @CurrentGuild(): resolved guild ctx
│       ├── require-claims.decorator.ts# @RequireClaims('tickets.read')
│       └── cache-response.decorator.ts
├── auth/
│   ├── auth.module.ts
│   ├── strategies/
│   │   ├── discord-oauth.strategy.ts  # Passport Discord OAuth2 (session)
│   │   ├── jwt.strategy.ts            # Bearer JWT
│   │   └── api-key.strategy.ts        # x-api-key header
│   ├── guards/
│   │   ├── composite-auth.guard.ts    # Tries session -> jwt -> api key
│   │   ├── rate-limit.guard.ts        # Per-actor + per-route buckets (Redis via Cache)
│   │   └── permissions.guard.ts       # Resolves @RequireClaims against Permissions core
│   ├── auth.controller.ts             # /auth/login, /auth/callback, /auth/logout, /auth/me
│   ├── api-keys.controller.ts         # /guilds/:guildId/api-keys CRUD
│   ├── api-keys.service.ts            # hashing, scope checks (Application Service)
│   └── dto/
│       ├── create-api-key.dto.ts
│       └── api-key.response.dto.ts
├── realtime/
│   ├── realtime.gateway.ts            # @WebSocketGateway namespace /ws
│   ├── realtime.auth.ts               # handshake auth (session/jwt)
│   └── events.contract.ts            # typed server->client / client->server events
├── webhooks/
│   ├── webhooks.controller.ts         # /webhooks/:provider ingress
│   ├── signature.verifier.ts          # HMAC / Ed25519 verification per provider
│   └── webhook-router.service.ts      # Maps verified payload -> Event Bus
└── health/
    └── health.controller.ts           # /health, /ready (Terminus)
```

## 5. Public Interfaces

```typescript
/** The authenticated principal behind a request, regardless of strategy. */
export type AuthMethod = 'session' | 'jwt' | 'api-key';

export interface AuthenticatedActor {
  readonly id: string;                 // Discord user id OR api-key subject id
  readonly type: 'user' | 'service';
  readonly method: AuthMethod;
  readonly displayName: string;
  /** Resolved, expanded permission claims (wildcards already expanded contextually). */
  readonly claims: ReadonlySet<string>;
  /** Guilds this actor may act within; empty set => global/service scope. */
  readonly guildScope: ReadonlySet<string>;
}

/** Resolved guild context attached to guild-scoped routes. */
export interface GuildContext {
  readonly guildId: string;
  readonly locale: string;             // resolved per-guild i18n locale
}

/** Standard success envelope returned for non-paginated handlers. */
export interface SuccessEnvelope<T> {
  readonly success: true;
  readonly data: T;
  readonly meta: ResponseMeta;
}

export interface PaginatedEnvelope<T> {
  readonly success: true;
  readonly data: ReadonlyArray<T>;
  readonly pagination: PaginationMeta;
  readonly meta: ResponseMeta;
}

export interface ResponseMeta {
  readonly requestId: string;          // correlation id (also in headers)
  readonly timestamp: string;          // ISO-8601
  readonly version: 'v1';
}

export interface PaginationMeta {
  readonly limit: number;
  readonly total: number | null;       // null when count is skipped for perf
  readonly nextCursor: string | null;
  readonly prevCursor: string | null;
  readonly hasMore: boolean;
}

export interface ErrorEnvelope {
  readonly success: false;
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;          // i18n-resolved, user-facing
    readonly details?: ReadonlyArray<FieldError>;
    readonly requestId: string;
  };
}

export interface FieldError {
  readonly field: string;
  readonly issue: string;
}

export enum ApiErrorCode {
  ValidationFailed = 'VALIDATION_FAILED',
  Unauthorized = 'UNAUTHORIZED',
  Forbidden = 'FORBIDDEN',
  NotFound = 'NOT_FOUND',
  Conflict = 'CONFLICT',
  RateLimited = 'RATE_LIMITED',
  WebhookSignatureInvalid = 'WEBHOOK_SIGNATURE_INVALID',
  Internal = 'INTERNAL_ERROR',
}

/** Application service contract for API key management (lives in src/api/auth). */
export abstract class ApiKeyService {
  abstract issue(input: IssueApiKeyInput): Promise<IssuedApiKey>;
  abstract verify(rawKey: string): Promise<AuthenticatedActor | null>;
  abstract revoke(guildId: string, keyId: string, actorId: string): Promise<void>;
  abstract list(guildId: string, page: PageQuery): Promise<PaginatedEnvelope<ApiKeyView>>;
}

export interface IssueApiKeyInput {
  readonly guildId: string;
  readonly label: string;
  readonly scopes: ReadonlyArray<string>;   // permission claims granted to the key
  readonly expiresAt: Date | null;
  readonly createdBy: string;
}

/** Returned exactly ONCE at creation; the raw key is never stored or shown again. */
export interface IssuedApiKey {
  readonly id: string;
  readonly rawKey: string;                    // `gbk_<prefix>_<secret>`
  readonly prefix: string;
  readonly view: ApiKeyView;
}

export interface ApiKeyView {
  readonly id: string;
  readonly label: string;
  readonly prefix: string;
  readonly scopes: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}
```

## 6. Events

The API unit does not own a domain, but it bridges transport ⇄ Event Bus.

**Consumed (Event Bus → API, fanned out over WebSocket):**

| Event | Payload (shape) | Action |
| --- | --- | --- |
| `job.progress` | `{ guildId, jobId, name, progress: number, state }` | Push to `ws:guild:<id>` room subscribers with `job.read` claim |
| `module.log.created` | `{ guildId, level, category, message, ts }` | Push to live-log subscribers |
| `presence.updated` | `{ guildId, online: number, members: number }` | Push to dashboard presence widget |
| `api-key.revoked` | `{ guildId, keyId }` | Force-disconnect any WS sessions authed by that key |

**Emitted (API → Event Bus):**

| Event | Trigger | Payload |
| --- | --- | --- |
| `api.request.completed` | every request finished | `{ requestId, actorId, method, path, status, durationMs, guildId? }` |
| `api.auth.failed` | failed auth attempt | `{ method, reason, ip, requestId }` |
| `webhook.received` | verified inbound webhook | `{ provider, eventType, guildId?, payload, requestId }` |
| `api-key.used` | api-key request succeeds | `{ keyId, guildId, requestId }` (drives `lastUsedAt` async) |

```typescript
export interface WebhookReceivedEvent {
  readonly provider: 'discord' | 'github' | 'stripe' | 'fivem';
  readonly eventType: string;
  readonly guildId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly requestId: string;
  readonly receivedAt: string;
}
```

All Event Bus interaction goes through the core Event Bus abstraction injected via DI — the gateway/router never import another module's emitter directly.

## 7. Dependencies

Relies **only** on CORE systems (never another module's internals):

- **Events (Event Bus)** — outbound realtime fan-out and inbound webhook routing.
- **Permissions** — `PermissionsService.resolve(actorId, guildId)` + claim matching for `permissions.guard.ts`.
- **Cache** — rate-limit counters, session store backing, and `@CacheResponse()` read caching (namespaced keys, TTL). The API never touches Redis directly.
- **Database** — only via the `ApiKeyRepository` / `WebhookDeliveryRepository` (Repository Pattern, Prisma confined to repos).
- **Queue (BullMQ)** — webhook processing is enqueued (`webhook-ingest` queue) for retry/DLQ; `lastUsedAt` updates are debounced via a low-priority queue.
- **Config** — Zod-validated API config (see §8).
- **Logging / Tracing** — Pino logger + OpenTelemetry tracer injected into interceptors.

Module Application Services consumed by controllers are reached **only** through their published public interfaces (e.g. `TicketsPublicApi`, `FivemPublicApi`), satisfying the "no internal cross-module import" rule.

## 8. Configuration

```typescript
import { z } from 'zod';

export const apiConfigSchema = z.object({
  // Global (ENV -> Database -> Defaults)
  port: z.coerce.number().int().positive().default(3000),
  basePath: z.string().default('/api'),
  defaultVersion: z.literal('v1').default('v1'),
  corsOrigins: z.array(z.string().url()).default(['http://localhost:5173']),

  jwt: z.object({
    issuer: z.string().default('ghost-bot'),
    accessTtlSeconds: z.coerce.number().int().positive().default(900),     // 15m
    secret: z.string().min(32),                                            // ENV only
  }),

  session: z.object({
    cookieName: z.string().default('gb_session'),
    ttlSeconds: z.coerce.number().int().positive().default(86_400),        // 24h
    secure: z.boolean().default(true),
  }),

  discordOAuth: z.object({
    clientId: z.string(),
    clientSecret: z.string(),                                              // ENV only
    redirectUri: z.string().url(),
    scopes: z.array(z.string()).default(['identify', 'guilds']),
  }),

  rateLimit: z.object({
    windowSeconds: z.coerce.number().int().positive().default(60),
    anonymousMax: z.coerce.number().int().positive().default(30),
    userMax: z.coerce.number().int().positive().default(120),
    apiKeyMax: z.coerce.number().int().positive().default(600),
  }),

  pagination: z.object({
    defaultLimit: z.coerce.number().int().positive().max(200).default(25),
    maxLimit: z.coerce.number().int().positive().max(200).default(100),
  }),

  webhooks: z.object({
    enabledProviders: z.array(z.enum(['discord', 'github', 'stripe', 'fivem'])).default(['discord']),
    maxBodyBytes: z.coerce.number().int().positive().default(1_048_576),   // 1 MiB
  }),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;
```

Guild-scoped overrides (stored in DB, validated by the same schema fragment): per-guild CORS origins for embedded dashboards and per-guild rate-limit tier. Secrets (`jwt.secret`, `discordOAuth.clientSecret`) are **ENV-only** and never read from DB.

## 9. Database

```prisma
model ApiKey {
  id          String        @id @default(cuid())
  guildId     String
  label       String
  prefix      String        @unique           // public, shown in lists: gbk_a1b2c3
  hashedKey   String        @unique            // argon2id of full raw key
  scopes      ApiKeyScope[]
  createdBy   String                           // Discord user id
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  revokedAt   DateTime?                         // soft-delete: never hard delete
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@index([guildId])
  @@index([guildId, revokedAt])
  @@index([prefix])
  @@map("api_keys")
}

model ApiKeyScope {
  id        String  @id @default(cuid())
  apiKeyId  String
  claim     String                              // permission claim, e.g. "tickets.read"
  apiKey    ApiKey  @relation(fields: [apiKeyId], references: [id], onDelete: Cascade)

  @@unique([apiKeyId, claim])
  @@index([apiKeyId])
  @@map("api_key_scopes")
}

model WebhookDelivery {
  id           String   @id @default(cuid())
  provider     String                            // discord | github | stripe | fivem
  eventType    String
  guildId      String?
  signature    String?
  status       String   @default("received")     // received | processed | failed
  attempts     Int      @default(0)
  payload      Json
  error        String?
  requestId    String
  receivedAt   DateTime @default(now())
  processedAt  DateTime?

  @@index([provider, eventType])
  @@index([guildId])
  @@index([status])
  @@index([requestId])
  @@map("webhook_deliveries")
}
```

Notes:
- API keys are **soft-deleted** via `revokedAt`; verification queries always filter `revokedAt: null AND (expiresAt IS NULL OR expiresAt > now())`.
- `hashedKey` uses argon2id; only the `prefix` is queryable for fast lookup before hash comparison.
- `WebhookDelivery` retains an audit trail; a scheduled BullMQ job prunes rows older than the configured retention.

## 10. API

### Conventions
- **Base**: `https://<host>/api/v1`
- **Auth header**: `Authorization: Bearer <jwt>` OR `x-api-key: gbk_...` OR session cookie.
- **Correlation**: every response includes `X-Request-Id`; rate limits include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` on `429`.

### Endpoints (representative)

| Method + Path | Auth | Claims | Body / Query | Description |
| --- | --- | --- | --- | --- |
| `GET /auth/login` | none | – | – | Redirect to Discord OAuth2 |
| `GET /auth/callback` | none | – | `?code` | Exchange code, set session, redirect |
| `POST /auth/logout` | session | – | – | Destroy session |
| `GET /auth/me` | any | – | – | Current `AuthenticatedActor` |
| `GET /guilds/:guildId/api-keys` | session | `apikeys.read` | `PageQuery` | List keys (paginated) |
| `POST /guilds/:guildId/api-keys` | session | `apikeys.create` | `CreateApiKeyDto` | Issue key (raw shown once) |
| `DELETE /guilds/:guildId/api-keys/:id` | session | `apikeys.revoke` | – | Revoke (soft-delete) |
| `GET /guilds/:guildId/tickets` | any | `tickets.read` | `PageQuery` + filters | Delegates to `TicketsPublicApi` |
| `POST /webhooks/:provider` | signature | – | provider payload | Verified ingress → Event Bus |
| `GET /health` | none | – | – | Liveness |
| `GET /ready` | none | – | – | Readiness (DB/Redis/queue) |

### Sample controller + DTOs

```typescript
import {
  Controller, Get, Post, Delete, Param, Query, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOkResponse, ApiCreatedResponse, ApiOperation } from '@nestjs/swagger';
import { z } from 'zod';

const createApiKeySchema = z.object({
  label: z.string().min(3).max(64),
  scopes: z.array(z.string().regex(/^[a-z0-9_]+\.[a-z0-9_.*]+$/)).min(1),
  expiresAt: z.string().datetime().nullable().default(null),
});

export class CreateApiKeyDto {
  /** Human label shown in the dashboard. */
  label!: string;
  /** Permission claims granted to this key (wildcards allowed). */
  scopes!: string[];
  /** ISO-8601 expiry, or null for non-expiring. */
  expiresAt!: string | null;

  static readonly schema = createApiKeySchema;
}

@ApiTags('api-keys')
@ApiBearerAuth()
@Controller({ path: 'guilds/:guildId/api-keys', version: '1' })
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Get()
  @RequireClaims('apikeys.read')
  @CacheResponse({ ttlSeconds: 15, scope: 'guild' })
  @ApiOperation({ summary: 'List API keys for a guild' })
  @ApiOkResponse({ description: 'Paginated API key views' })
  async list(
    @CurrentGuild() guild: GuildContext,
    @Query() page: PageQueryDto,
  ): Promise<PaginatedEnvelope<ApiKeyView>> {
    return this.apiKeys.list(guild.guildId, page);
  }

  @Post()
  @RequireClaims('apikeys.create')
  @ApiCreatedResponse({ description: 'Raw key returned exactly once' })
  async create(
    @CurrentGuild() guild: GuildContext,
    @CurrentUser() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(CreateApiKeyDto.schema)) dto: CreateApiKeyDto,
  ): Promise<IssuedApiKey> {
    return this.apiKeys.issue({
      guildId: guild.guildId,
      label: dto.label,
      scopes: dto.scopes,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdBy: actor.id,
    });
  }

  @Delete(':id')
  @RequireClaims('apikeys.revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke (soft-delete) an API key' })
  async revoke(
    @CurrentGuild() guild: GuildContext,
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id') id: string,
  ): Promise<void> {
    await this.apiKeys.revoke(guild.guildId, id, actor.id);
  }
}
```

```typescript
/** Shared pagination query DTO — cursor preferred, offset supported. */
export class PageQueryDto implements PageQuery {
  limit: number = 25;          // clamped to config.pagination.maxLimit
  cursor?: string;             // opaque base64 cursor (preferred)
  offset?: number;             // fallback offset pagination
  sort: string = '-createdAt'; // field with optional leading '-' for desc

  static readonly schema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().optional(),
    offset: z.coerce.number().int().min(0).optional(),
    sort: z.string().regex(/^-?[a-zA-Z][a-zA-Z0-9_]*$/).default('-createdAt'),
  });
}
```

### WebSocket gateway

```typescript
@WebSocketGateway({ namespace: '/ws', cors: true })
export class RealtimeGateway implements OnGatewayConnection {
  // client -> server
  // 'subscribe' { guildId, channels: ('jobs'|'logs'|'presence')[] }
  // server -> client
  // 'job.progress' | 'log' | 'presence' | 'error'
}
```

Handshake auth reuses session/JWT; on connect, the actor's claims gate which guild rooms and channels they may join. A client lacking `job.read` cannot subscribe to `jobs`.

### Webhook ingress

`POST /api/v1/webhooks/:provider` verifies the provider signature (Discord Ed25519, GitHub HMAC-SHA256, Stripe `Stripe-Signature`), persists a `WebhookDelivery`, enqueues processing on the `webhook-ingest` BullMQ queue, and emits `webhook.received`. Returns `202 Accepted` immediately.

## 11. Permissions

Claims defined/required by this unit:

| Claim | Used by |
| --- | --- |
| `apikeys.read` | List API keys |
| `apikeys.create` | Issue API keys |
| `apikeys.revoke` | Revoke API keys |
| `api.docs.read` | Access Swagger UI in non-public deployments |
| `realtime.connect` | Open a WebSocket session |
| `webhooks.manage` | Configure webhook providers per guild |

Module-owned claims (e.g. `tickets.read`) are **not** redefined here — they are enforced by `permissions.guard.ts` reading `@RequireClaims()` and matching against the Permissions core (wildcard-aware, group/inheritance/role-resolved). API keys carry a subset of claims (their `scopes`); the effective claim set for a key request is `intersection(keyScopes, actorOrServiceClaims)`.

## 12. Logging

- **Request log** (Pino, category `api.request`): method, path, status, `durationMs`, `actorId`, `guildId`, `requestId`, response size. No request bodies for auth routes.
- **Auth log** (`api.auth`): success/failure, method, masked principal, ip — failures emit `api.auth.failed`.
- **Rate-limit log** (`api.ratelimit`): bucket key, limit, when a `429` is issued.
- **Webhook log** (`api.webhook`): provider, eventType, signature result, delivery id.
- **Error log** (`api.error`): full internal error + stack logged server-side only; client receives a sanitized `ErrorEnvelope`.
- **Audit hooks**: API key issue/revoke and webhook-provider changes write to the central audit trail (`actorId`, `guildId`, `action`, `targetId`).
- Every log line carries the OpenTelemetry `traceId`/`spanId` for correlation with Grafana/Tempo.

## 13. Testing

- **Unit**
  - `ZodValidationPipe`: valid/invalid DTOs map to typed objects / `VALIDATION_FAILED`.
  - `ApiKeyService`: hashing, prefix generation, expiry/revocation filtering, scope intersection.
  - `EnvelopeInterceptor` / `GlobalExceptionFilter`: every throwable maps to the correct `ApiErrorCode` and never leaks internals.
  - `RateLimitGuard`: bucket math, header emission, tier selection.
  - `signature.verifier.ts`: per-provider valid/invalid signatures.
- **Integration** (Nest test app + test DB + Redis)
  - Auth strategies: session, JWT, API key happy + failure paths.
  - `permissions.guard.ts` with wildcard claims and missing claims (`403`).
  - Pagination: cursor + offset, `maxLimit` clamping, stable ordering.
  - Webhook ingress: signature verify → `WebhookDelivery` persisted → `webhook.received` emitted → `202`.
- **E2E** (Playwright against running stack)
  - OAuth login → `/auth/me` → guild-scoped list → create + revoke API key.
  - WebSocket subscribe/receive with and without claims.
- **Contract**: Swagger doc snapshot test — no endpoint may ship without schema + auth + error responses.

## 14. Dashboard Integration

- **API Keys page**: list (paginated, shows prefix + last used), create (modal returns raw key once with copy-to-clipboard + warning), revoke (confirm).
- **Realtime**: dashboard opens `/ws`, subscribes to `jobs`/`logs`/`presence` per current guild; live job progress bars, live log stream, presence widget.
- **Webhooks settings**: enable/disable providers, view recent `WebhookDelivery` rows with status/error.
- **API explorer**: embedded Swagger UI (gated by `api.docs.read`) for integrators.
- All dashboard calls use the same `/api/v1` envelopes; a shared TypeScript client is generated from the OpenAPI document.

## 15. Future Extensions

- `/api/v2` with breaking changes once `v1` consumers can migrate.
- **GraphQL** read gateway over the same Application Services for flexible dashboard queries.
- **gRPC** internal API for service-to-service calls.
- **OAuth2 client-credentials** flow for third parties (beyond static API keys).
- **Per-key IP allowlists** and **mTLS** for high-trust integrations.
- **Webhook egress** (outbound, signed, retried) so guilds can subscribe to Ghost Bot events.
- **Field-level response shaping** (`?fields=`) and **ETags/conditional GET**.

## 16. Tasks for Claude

1. **Phase 1 — Schema**: Add `ApiKey`, `ApiKeyScope`, `WebhookDelivery` Prisma models; create migration; add `ApiKeyRepository` + `WebhookDeliveryRepository`.
2. **Phase 2 — Cross-cutting core**: Implement envelope types, `EnvelopeInterceptor`, `GlobalExceptionFilter`, `ZodValidationPipe`, `LoggingInterceptor`, `TraceInterceptor`, `CacheInterceptor`; register globally in `ApiModule`.
3. **Phase 3 — Auth**: Implement Discord OAuth2, JWT, and API-key strategies; `CompositeAuthGuard`, `RateLimitGuard`, `PermissionsGuard`; `ApiKeyService` (argon2id, prefix, scope intersection).
4. **Phase 4 — Events**: Wire `api.request.completed`, `api.auth.failed`, `api-key.used` emission and consumption of `job.progress`/`module.log.created`/`presence.updated`.
5. **Phase 5 — Controllers/commands**: `AuthController`, `ApiKeysController`, `HealthController`; pagination DTO + helper.
6. **Phase 6 — Realtime**: `RealtimeGateway` with handshake auth, room/claim gating, typed event contract.
7. **Phase 7 — Webhooks**: `WebhooksController`, per-provider `signature.verifier`, `WebhookRouterService`, `webhook-ingest` BullMQ processor.
8. **Phase 8 — Dashboard hooks**: Expose endpoints + generate the OpenAPI TS client.
9. **Phase 9 — API/Swagger**: Build the OpenAPI 3.1 document (`swagger.ts`), annotate every endpoint, add the contract snapshot test.
10. **Phase 10 — Tests**: Unit, integration, e2e per §13.
11. **Phase 11 — Docs**: Update module README + this spec's deltas.

## 17. Acceptance Criteria

- [ ] All routes mounted under `/api/v1` via URI versioning; `v1` schema is frozen.
- [ ] Every endpoint appears in Swagger with DTO schema, auth scheme, and documented error responses.
- [ ] Session, JWT, and API-key auth all work; failures emit `api.auth.failed` and return `401`.
- [ ] `PermissionsGuard` enforces `@RequireClaims()` with wildcard support; missing claim → `403`.
- [ ] Every success response is a `SuccessEnvelope`/`PaginatedEnvelope`; every error is an `ErrorEnvelope` with a stable `ApiErrorCode`.
- [ ] Internal errors / stack traces / Prisma errors are never serialized to clients.
- [ ] List endpoints paginate (cursor + offset), clamp `limit` to config max, and cache via the Cache layer.
- [ ] Rate limiting enforced per actor tier with correct headers and `429` + `Retry-After`.
- [ ] API key raw value shown exactly once; stored only as argon2id hash; revocation is soft-delete.
- [ ] WebSocket gateway authenticates the handshake and gates rooms/channels by claims.
- [ ] Webhook ingress verifies signatures, persists `WebhookDelivery`, emits `webhook.received`, returns `202`.
- [ ] Every request carries a correlation id present in logs, traces, and the `X-Request-Id` header.

## 17b. Implementation Notes (Phase 3 deltas)

Reconciliation decisions taken when implementing against the **existing** Phase 2
codebase (recorded per §16.11 / §18 "deltas discovered"):

- **API keys reuse `@shared/security`.** Phase 2 already shipped `ApiKeyService`
  (raw key `ghk_<base64url>`, scrypt hash via `EncryptionService` — argon2id is
  not a dependency), `ApiKeyController` (`api/v1/guilds/:guildId/api-keys`),
  `ApiKeyGuard`, `RateLimitService`, `AuditInterceptor` and the `ApiKey` Prisma
  model. To honour DRY and "never re-implement", `src/api` does **not** define a
  competing `ApiKeyService`/keys controller; the security controller remains the
  canonical key surface. Consequently the `ApiKeyScope` table from §9 was **not**
  added — scopes stay on the existing `ApiKey.scopes` (comma-joined Text). The
  raw-key format is `ghk_…`, not `gbk_…`.
- **Versioning** uses hard-coded `@Controller('api/v1/...')` paths (the existing
  project convention, e.g. `api/v1/plugins`) rather than Nest URI versioning, to
  avoid re-prefixing other modules' root-mounted controllers.
- **Cross-cutting providers** are applied via the `@ApiProtected()` /
  `@ApiPublic()` composite decorators at the API controller boundary instead of
  global `APP_*` providers, so the bot's other controllers are untouched.
- **Webhook processing** flows through the Event Bus (`api.webhook.received`,
  durable async delivery + dead-letter) rather than a dedicated `webhook-ingest`
  BullMQ queue (BullMQ is a dependency but not yet wired anywhere). This reuses
  existing retry/DLQ infrastructure; a queue can be introduced later without
  changing the controller contract.
- **Event names** follow the registry's 3-segment `module.entity.action` rule:
  `api.request.completed`, `api.auth.failed`, `api.key.used`,
  `api.webhook.received` (registered in `core/events/registry`).
- **OpenTelemetry** spans are stubbed in `TraceInterceptor` (trace id generated +
  propagated); binding a real OTel SDK is Phase 6 monitoring work.

## 18. Definition of Done

- [ ] All unit, integration, and e2e tests pass (Vitest + Playwright); coverage meets the project threshold.
- [ ] Prisma migration for the three models created and applied; no drift.
- [ ] ESLint + Prettier clean; no `any`; methods kept small.
- [ ] Swagger document builds and the contract snapshot test passes.
- [ ] OpenAPI TypeScript client generated for the dashboard.
- [ ] Conventional Commits used on a `feature/api` branch; no direct commits to `main`; PR opened against `develop` with this spec linked.
- [ ] Logging, tracing, and Prometheus metrics verified on a sample request.
- [ ] This document updated to reflect any deltas discovered during implementation.
