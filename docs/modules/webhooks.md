# Webhooks Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields. Support pagination, caching, translations, dashboard.
> - SECURITY FIRST: never trust an inbound payload until its signature is verified. Constant-time
>   comparison only. Never log raw secrets, signing keys, or full payload bodies at `info` level.
> - This module is the ONLY place allowed to terminate raw external HTTP integration traffic. It
>   normalizes everything onto the Event Bus; downstream modules NEVER parse provider payloads.
> - No module touches Redis directly — use the Cache layer. No controller touches Prisma — use Repositories.

---

## 1. Purpose

The Webhooks Module is Ghost Bot's secure ingress and egress gateway for third-party integrations.
It does two complementary jobs:

- **Inbound**: receive HTTP webhooks from external providers (GitHub, Stripe, FiveM panels, and
  arbitrary custom sources), verify their authenticity (signatures / HMAC / shared secrets),
  deduplicate, normalize the provider-specific payload into a canonical internal event, and publish
  that event onto the Event Bus so other modules can react without ever knowing the wire format.
- **Outbound**: deliver Ghost Bot's own domain events to externally registered endpoints (e.g. a
  guild's status page, an n8n flow, a Discord-external dashboard) with HMAC signing, retry/backoff,
  and a dead-letter queue for permanent failures.

It is **guild-aware**: every inbound endpoint and every outbound subscription is owned by exactly one
guild (or is explicitly global/system). It is the single trust boundary between the public internet
and the rest of the platform.

## 2. Goals

- Provide a hardened, single ingress for all provider webhooks with **per-provider signature
  verification** (GitHub `X-Hub-Signature-256`, Stripe `Stripe-Signature` with timestamp tolerance,
  FiveM/custom shared-secret HMAC).
- **Normalize** heterogeneous provider payloads into a stable `IntegrationEvent` envelope emitted on
  the Event Bus, so downstream modules depend on our contract, never the provider's.
- Guarantee **at-least-once** inbound processing with **idempotency** (dedupe by delivery id) and
  at-least-once **outbound** delivery with retry/backoff and a DLQ.
- Make webhook management self-service: a **per-guild dashboard UI** to create/rotate/disable endpoints
  and outbound subscriptions, view delivery logs, and replay failed deliveries.
- Be observable: every receipt, verification result, normalization, and delivery attempt is logged,
  metered, and traceable end-to-end via OpenTelemetry.
- Fail safe: reject fast on bad signatures, never leak internals in error responses, never block the
  HTTP request thread on downstream work (accept -> enqueue -> 2xx).

## 3. Architecture

The module follows the strict platform layer flow and isolates raw HTTP at the edge:

```
External Provider ──HTTP──> WebhookController (api layer, raw body preserved)
        │
        ▼
  InboundWebhookService (application)
        ├─ resolve endpoint by token (Repository + Cache)
        ├─ SignatureVerifier strategy (per provider)  ── verify (constant-time)
        ├─ IdempotencyGuard (Cache: dedupe by delivery id, TTL)
        ├─ persist WebhookDelivery (Repository -> Prisma)
        └─ enqueue "webhooks.inbound.process" (BullMQ)  ──> 202 Accepted (fast)

  InboundProcessor (jobs / BullMQ worker)
        ├─ PayloadNormalizer strategy (per provider) -> IntegrationEvent
        ├─ EventBus.publish(IntegrationEvent)         ──> consumed by other modules
        └─ update WebhookDelivery status

  Domain events from platform ──> OutboundDispatchService (application, EventBus consumer)
        ├─ match WebhookSubscription (Repository + Cache)
        ├─ enqueue "webhooks.outbound.deliver" (BullMQ, per subscription)
        └─ OutboundDeliveryWorker -> sign (HMAC) -> POST -> retry/backoff -> DLQ on exhaustion
```

Key decisions:
- **Accept-then-process**: the controller does the minimum (resolve + verify + dedupe + persist +
  enqueue) and returns quickly. Normalization and fan-out happen in BullMQ workers.
- **Strategy pattern** for `SignatureVerifier` and `PayloadNormalizer`, keyed by provider, so adding a
  provider is additive and closed for modification (OCP).
- CQRS is **not** used here — the read/write split does not pay off for this unit. Plain Application
  Services + Repositories.

## 4. Folder Structure

```
src/modules/webhooks/
├── webhooks.module.ts
├── index.ts                          # PUBLIC API barrel — the ONLY thing other modules may import
├── api/
│   ├── webhook.controller.ts         # POST /webhooks/in/:token  (raw body)
│   └── webhook-admin.controller.ts   # CRUD + replay (dashboard-facing, guild-scoped)
├── application/
│   ├── inbound-webhook.service.ts
│   ├── outbound-dispatch.service.ts
│   ├── webhook-endpoint.service.ts   # manage inbound endpoints
│   └── webhook-subscription.service.ts # manage outbound subscriptions
├── domain/
│   ├── integration-event.ts          # canonical envelope (value object)
│   ├── webhook-provider.enum.ts
│   ├── delivery-status.enum.ts
│   └── errors/
│       ├── signature-invalid.error.ts
│       ├── endpoint-disabled.error.ts
│       └── unsupported-provider.error.ts
├── verification/                     # SignatureVerifier strategies
│   ├── signature-verifier.interface.ts
│   ├── github.verifier.ts
│   ├── stripe.verifier.ts
│   ├── hmac-shared-secret.verifier.ts # FiveM + custom
│   └── verifier.registry.ts
├── normalization/                    # PayloadNormalizer strategies
│   ├── payload-normalizer.interface.ts
│   ├── github.normalizer.ts
│   ├── stripe.normalizer.ts
│   ├── fivem.normalizer.ts
│   ├── custom.normalizer.ts
│   └── normalizer.registry.ts
├── jobs/
│   ├── inbound-processor.worker.ts
│   ├── outbound-delivery.worker.ts
│   └── webhooks.queue.ts             # queue names + job typing
├── repositories/
│   ├── webhook-endpoint.repository.ts
│   ├── webhook-subscription.repository.ts
│   └── webhook-delivery.repository.ts
├── dto/
│   ├── create-endpoint.dto.ts
│   ├── update-endpoint.dto.ts
│   ├── create-subscription.dto.ts
│   ├── replay-delivery.dto.ts
│   └── delivery-query.dto.ts
└── config/
    └── webhooks.config.ts            # Zod schema + defaults
```

## 5. Public Interfaces

These are the only types `src/modules/webhooks/index.ts` re-exports. Other modules consume
`IntegrationEvent` via the Event Bus; they do not call our services directly.

```typescript
// domain/webhook-provider.enum.ts
export enum WebhookProvider {
  GitHub = 'github',
  Stripe = 'stripe',
  FiveM = 'fivem',
  Custom = 'custom',
}

// domain/delivery-status.enum.ts
export enum DeliveryStatus {
  Received = 'received',
  Verified = 'verified',
  Rejected = 'rejected',
  Processing = 'processing',
  Processed = 'processed',
  Failed = 'failed',
  DeadLettered = 'dead_lettered',
}

// domain/integration-event.ts — the canonical envelope published on the Event Bus
export interface IntegrationEvent<TData = Readonly<Record<string, unknown>>> {
  /** Stable internal type, e.g. "github.push", "stripe.payment.succeeded". */
  readonly type: string;
  readonly provider: WebhookProvider;
  /** Owning guild, or null for global/system endpoints. */
  readonly guildId: string | null;
  /** Provider's delivery id (idempotency key), if any. */
  readonly deliveryId: string | null;
  /** Our WebhookDelivery row id, for traceability. */
  readonly internalDeliveryId: string;
  readonly occurredAt: Date;
  /** Normalized, provider-agnostic data. Never the raw provider body. */
  readonly data: TData;
}

// verification/signature-verifier.interface.ts
export interface VerificationContext {
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly signingSecret: string;
  readonly toleranceSeconds: number;
}

export abstract class SignatureVerifier {
  abstract readonly provider: WebhookProvider;
  /** MUST use constant-time comparison. Throws SignatureInvalidError on failure. */
  abstract verify(ctx: VerificationContext): Promise<void>;
}

// normalization/payload-normalizer.interface.ts
export interface NormalizationContext {
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly guildId: string | null;
  readonly internalDeliveryId: string;
}

export abstract class PayloadNormalizer {
  abstract readonly provider: WebhookProvider;
  /** Returns null when the event is recognized but intentionally ignored. */
  abstract normalize(ctx: NormalizationContext): Promise<IntegrationEvent | null>;
}

// repositories/webhook-delivery.repository.ts (abstract contract)
export interface PageResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}
```

## 6. Events

**Emitted onto the Event Bus** (consumed by any module that opts in):

| Event name | Payload | When |
|---|---|---|
| `integration.event` | `IntegrationEvent` | After a normalizer produces an envelope |
| `webhooks.delivery.failed` | `{ internalDeliveryId: string; guildId: string \| null; provider: WebhookProvider; reason: string }` | Verification or processing rejected |
| `webhooks.outbound.dead_lettered` | `{ subscriptionId: string; guildId: string; eventType: string; attempts: number }` | Outbound retries exhausted |

Concretely the bus also carries the specific normalized types as the `type` field of `IntegrationEvent`:
`github.push`, `github.pull_request`, `github.workflow_run`, `stripe.payment.succeeded`,
`stripe.subscription.updated`, `fivem.player.join`, `fivem.server.crash`, `custom.*`.

**Consumed from the Event Bus** (to drive outbound delivery): the `OutboundDispatchService` subscribes
to a configurable allowlist of platform domain events (e.g. `tickets.created`, `moderation.ban.issued`)
and to `integration.event` itself, so guilds can re-broadcast normalized inbound events outward.

```typescript
// payload shape emitted for every normalized inbound event
interface IntegrationEventEnvelopeMessage {
  readonly busEvent: 'integration.event';
  readonly payload: IntegrationEvent;
}
```

## 7. Dependencies

Relies ONLY on CORE systems — never on another module's internals:

- **Event Bus** (`core/events`): publish `IntegrationEvent` and lifecycle events; subscribe to domain
  events for outbound dispatch.
- **Cache** (`core/cache`): endpoint lookup by token (namespace `webhooks:endpoint`), subscription
  lists per guild (`webhooks:subs`), and idempotency dedupe keys (`webhooks:dedupe`). Never touches
  Redis directly.
- **Queue** (`core/queue`, BullMQ): `webhooks.inbound` and `webhooks.outbound` queues with retries,
  backoff, and DLQ.
- **Database** (`core/database`, Prisma): via Repositories only.
- **Permissions** (`core/permissions`): guard admin endpoints with wildcard claims.
- **Config** (`core/config`): ENV -> DB -> Defaults resolution, Zod-validated.
- **Logging** (`core/logging`, Pino) and **Telemetry** (OpenTelemetry).

No imports of `modules/*`. Cross-module communication is exclusively via the Event Bus or this
module's published public API.

## 8. Configuration

Resolution priority: **ENV -> Database -> Defaults**. Validated with Zod.

```typescript
// config/webhooks.config.ts
import { z } from 'zod';

export const webhooksConfigSchema = z.object({
  /** Max accepted inbound body size in bytes (rejects larger before parsing). */
  maxInboundBodyBytes: z.number().int().positive().default(1_048_576), // 1 MiB
  /** Stripe/timestamped providers: allowed clock skew. */
  signatureToleranceSeconds: z.number().int().positive().default(300),
  /** Idempotency dedupe window. */
  dedupeTtlSeconds: z.number().int().positive().default(86_400),
  inbound: z.object({
    enabled: z.boolean().default(true),
    maxConcurrency: z.number().int().positive().default(10),
  }).default({}),
  outbound: z.object({
    enabled: z.boolean().default(true),
    maxAttempts: z.number().int().min(1).max(20).default(8),
    backoff: z.object({
      type: z.enum(['fixed', 'exponential']).default('exponential'),
      baseDelayMs: z.number().int().positive().default(2_000),
      maxDelayMs: z.number().int().positive().default(900_000), // 15 min cap
    }).default({}),
    requestTimeoutMs: z.number().int().positive().default(10_000),
    /** Platform domain events guilds are allowed to subscribe outward. */
    allowedOutboundEvents: z.array(z.string()).default([
      'integration.event',
      'tickets.created',
      'moderation.ban.issued',
    ]),
  }).default({}),
});

export type WebhooksConfig = z.infer<typeof webhooksConfigSchema>;
```

Per-endpoint and per-subscription settings (provider, secret, target URL, enabled flags, event
filters) live in the database (see §9) and override nothing global — they are row-scoped.

## 9. Database

Prisma models. Soft-delete via `deletedAt`. Secrets are stored encrypted at rest (the column holds
ciphertext produced by the core crypto helper; we never store plaintext signing keys).

```prisma
enum WebhookProvider {
  github
  stripe
  fivem
  custom
}

enum DeliveryStatus {
  received
  verified
  rejected
  processing
  processed
  failed
  dead_lettered
}

model WebhookEndpoint {
  id            String          @id @default(cuid())
  guildId       String?         // null = global/system endpoint
  provider      WebhookProvider
  /** Public URL slug: /webhooks/in/:token. Unguessable, rotatable. */
  token         String          @unique
  /** Encrypted signing secret / HMAC key (ciphertext). */
  signingSecret String          @db.Text
  label         String
  enabled       Boolean         @default(true)
  createdById   String
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
  deletedAt     DateTime?

  deliveries    WebhookDelivery[]

  @@index([guildId, provider])
  @@index([enabled])
  @@index([deletedAt])
}

model WebhookDelivery {
  id            String          @id @default(cuid())
  endpointId    String
  endpoint      WebhookEndpoint @relation(fields: [endpointId], references: [id])
  guildId       String?
  provider      WebhookProvider
  /** Provider delivery id — idempotency key. */
  externalId    String?
  eventType     String?         // normalized type once known
  status        DeliveryStatus  @default(received)
  /** Raw body retained for replay; purged by a scheduled job after retention. */
  rawBody       Bytes
  headers       Json
  rejectReason  String?
  attempts      Int             @default(0)
  receivedAt    DateTime        @default(now())
  processedAt   DateTime?

  @@unique([endpointId, externalId])  // dedupe at the DB level too
  @@index([guildId, status])
  @@index([provider, eventType])
  @@index([receivedAt])
}

model WebhookSubscription {
  id            String   @id @default(cuid())
  guildId       String
  /** Platform domain event name to forward outward. */
  eventType     String
  targetUrl     String   @db.Text
  /** Encrypted HMAC signing secret used to sign outbound bodies. */
  signingSecret String   @db.Text
  enabled       Boolean  @default(true)
  /** Optional JSON filter applied to the event payload. */
  filter        Json?
  createdById   String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  deliveries    OutboundDelivery[]

  @@index([guildId, eventType, enabled])
  @@index([deletedAt])
}

model OutboundDelivery {
  id             String              @id @default(cuid())
  subscriptionId String
  subscription   WebhookSubscription @relation(fields: [subscriptionId], references: [id])
  guildId        String
  eventType      String
  status         DeliveryStatus      @default(processing)
  attempts       Int                 @default(0)
  lastStatusCode Int?
  lastError      String?
  payload        Json
  createdAt      DateTime            @default(now())
  deliveredAt    DateTime?

  @@index([subscriptionId, status])
  @@index([guildId, eventType])
  @@index([createdAt])
}
```

Indexes cover the searchable/filterable dashboard columns (guild, provider, status, eventType, time).
The `@@unique([endpointId, externalId])` enforces idempotency even under a cache miss/race.

## 10. API

All admin routes are guild-scoped and guarded by permissions. Swagger-documented. The public ingress
route is intentionally minimal and rate-limited.

| Method | Path | Auth | DTO | Notes |
|---|---|---|---|---|
| `POST` | `/webhooks/in/:token` | none (signature) | raw body | Public ingress. Raw body preserved for HMAC. Returns `202 Accepted` fast. Rate-limited per token. |
| `GET` | `/api/guilds/:guildId/webhooks/endpoints` | `webhooks.endpoints.read` | `DeliveryQueryDto` | Paginated. |
| `POST` | `/api/guilds/:guildId/webhooks/endpoints` | `webhooks.endpoints.manage` | `CreateEndpointDto` | Returns token once. |
| `PATCH` | `/api/guilds/:guildId/webhooks/endpoints/:id` | `webhooks.endpoints.manage` | `UpdateEndpointDto` | Enable/disable, relabel. |
| `POST` | `/api/guilds/:guildId/webhooks/endpoints/:id/rotate` | `webhooks.endpoints.manage` | — | Rotate token + secret. |
| `DELETE` | `/api/guilds/:guildId/webhooks/endpoints/:id` | `webhooks.endpoints.manage` | — | Soft-delete. |
| `GET` | `/api/guilds/:guildId/webhooks/deliveries` | `webhooks.deliveries.read` | `DeliveryQueryDto` | Paginated, filterable. |
| `POST` | `/api/guilds/:guildId/webhooks/deliveries/:id/replay` | `webhooks.deliveries.replay` | `ReplayDeliveryDto` | Re-enqueue from stored raw body. |
| `GET` | `/api/guilds/:guildId/webhooks/subscriptions` | `webhooks.subscriptions.read` | — | Outbound subs. |
| `POST` | `/api/guilds/:guildId/webhooks/subscriptions` | `webhooks.subscriptions.manage` | `CreateSubscriptionDto` | |
| `DELETE` | `/api/guilds/:guildId/webhooks/subscriptions/:id` | `webhooks.subscriptions.manage` | — | Soft-delete. |

```typescript
// dto/create-endpoint.dto.ts
export class CreateEndpointDto {
  provider!: WebhookProvider;
  label!: string;
  /** Optional client-supplied secret; generated if omitted. Write-only, never returned. */
  signingSecret?: string;
}

// dto/create-subscription.dto.ts
export class CreateSubscriptionDto {
  eventType!: string;        // must be in allowedOutboundEvents
  targetUrl!: string;        // https only
  signingSecret?: string;
  filter?: Readonly<Record<string, unknown>>;
}

// dto/delivery-query.dto.ts
export class DeliveryQueryDto {
  page: number = 1;
  pageSize: number = 25;
  provider?: WebhookProvider;
  status?: DeliveryStatus;
  eventType?: string;
  from?: string; // ISO date
  to?: string;
}

// dto/replay-delivery.dto.ts
export class ReplayDeliveryDto {
  /** Skip signature re-verification (already verified once). Default true. */
  skipVerification: boolean = true;
}
```

All DTOs are validated with Zod at the boundary. Error responses use the unified error envelope and
never leak stack traces or secrets.

## 11. Permissions

Wildcard-friendly claims (parent `webhooks.*` grants all):

- `webhooks.endpoints.read`
- `webhooks.endpoints.manage`
- `webhooks.deliveries.read`
- `webhooks.deliveries.replay`
- `webhooks.subscriptions.read`
- `webhooks.subscriptions.manage`

Admins typically receive `webhooks.*`. The public ingress route uses no permission claim — it is
authenticated purely by token + signature verification.

## 12. Logging

Categories (Pino, structured, correlated by `internalDeliveryId` + OTel trace id):

- `webhooks.inbound.received` — token (hashed), provider, body size, source IP. **Never** the raw body.
- `webhooks.inbound.verified` / `webhooks.inbound.rejected` — verification outcome + reason code.
- `webhooks.inbound.normalized` — resolved event type, whether ignored.
- `webhooks.outbound.attempt` — subscription id, status code, attempt number, latency.
- `webhooks.outbound.dead_lettered` — final failure.

Audit hooks: every endpoint/subscription create, rotate, disable, delete, and every manual replay is
written to the core audit log with the acting user, guild, and target id. Secrets and signing keys are
redacted by a Pino redaction path; raw payload bodies are logged only at `debug` and only truncated.

## 13. Testing

- **Unit**: each `SignatureVerifier` (valid sig, tampered body, wrong secret, expired timestamp,
  replayed timestamp); each `PayloadNormalizer` (real captured provider fixtures -> expected
  `IntegrationEvent`, including the ignored-event path returning `null`); `IdempotencyGuard`.
- **Integration**: controller -> service -> repository with a test DB; verify `202` fast-path, dedupe
  via the `@@unique` constraint, and that an `IntegrationEvent` is enqueued. Outbound worker retry +
  backoff + DLQ transition using a mock target server.
- **e2e** (Playwright + a stub provider): GitHub push fixture posted with a valid `X-Hub-Signature-256`
  produces a `github.push` bus event; an invalid signature returns `401` with no bus emission.
- Security tests: constant-time comparison usage, oversized body rejection, raw-body preservation
  through any body parser, secret redaction in logs.
- Coverage gates per `00-project.md`. No `any` in tests.

## 14. Dashboard Integration

The dashboard exposes, per guild:

- **Inbound Endpoints** panel: list/create/rotate/disable; shows the public URL and the signing secret
  exactly once on creation/rotation; provider-specific setup hints.
- **Delivery Log**: paginated, filterable by provider/status/eventType/date; per-row detail with
  headers, normalized event, and a **Replay** button (requires `webhooks.deliveries.replay`).
- **Outbound Subscriptions** panel: subscribe a guild to allowed platform events, set target URL +
  signing secret, optional JSON filter, and view outbound delivery history including DLQ entries.
- Live status badges driven by Prometheus metrics (success rate, DLQ depth). All labels translated
  (PT primary, EN secondary) via i18n namespaces `webhooks.*`.

## 15. Future Extensions

- Additional providers via new strategy classes (PayPal, Sentry, GitLab, Linear) — additive only.
- Payload transformation templates (JSONata/Handlebars) for outbound subscriptions.
- mTLS and IP allowlisting per endpoint for high-security guilds.
- Webhook signing key versioning (overlapping keys during rotation).
- A "test event" sender to fire a synthetic delivery from the dashboard.
- Per-guild rate-limit and quota dashboards.

## 16. Tasks for Claude

Ordered phases:

1. **Schema** — add the four Prisma models + enums from §9; create migration; wire encrypted-secret
   helper for `signingSecret` columns.
2. **Repositories** — implement the three repositories (endpoint, subscription, delivery) with
   pagination and soft-delete filters; add cache-through for endpoint-by-token and subs-by-guild.
3. **Domain + strategies** — `IntegrationEvent`, enums, errors; `SignatureVerifier` + registry
   (GitHub, Stripe, HMAC shared-secret); `PayloadNormalizer` + registry with fixtures.
4. **Application services** — `InboundWebhookService`, `OutboundDispatchService`,
   `WebhookEndpointService`, `WebhookSubscriptionService`.
5. **Events** — publish `IntegrationEvent` + lifecycle events; subscribe outbound dispatcher to the
   allowlisted domain events.
6. **Jobs** — BullMQ `webhooks.inbound` / `webhooks.outbound` queues, workers, retry/backoff, DLQ.
7. **API** — controllers + DTOs + Zod validation + permission guards + Swagger; raw-body middleware for
   the ingress route.
8. **Dashboard** — endpoints, subscriptions, delivery log, replay UI; i18n strings.
9. **Tests** — unit, integration, e2e, security tests per §13.
10. **Docs** — module README, provider setup guides, update `00-project.md` references if needed (only
    references, never decisions).

## 17. Acceptance Criteria

- A GitHub push with a valid `X-Hub-Signature-256` returns `202` and emits a `github.push`
  `IntegrationEvent` on the bus; a tampered body returns `401` and emits nothing.
- A Stripe event outside the timestamp tolerance is rejected; a replayed delivery id is deduped (no
  second bus emission).
- Oversized bodies are rejected before parsing; raw body is preserved intact for HMAC.
- Outbound delivery to a failing endpoint retries with exponential backoff up to `maxAttempts`, then
  lands in the DLQ and emits `webhooks.outbound.dead_lettered`.
- Endpoint/subscription CRUD enforces the correct permission claims and is guild-scoped; secrets are
  never returned after creation and never logged.
- Dashboard can create, rotate, disable, replay, and view delivery logs with pagination + filters in PT
  and EN.

## 18. Definition of Done

- All 18 sections implemented as specified; no architecture decisions changed.
- Prisma migration created and applied; indexes present.
- Strict TypeScript, no `any`; ESLint/Prettier clean; Husky/Commitlint pass.
- Unit + integration + e2e + security tests pass and meet coverage gates.
- Swagger/OpenAPI updated for all routes; i18n keys added (PT + EN).
- Prometheus metrics + OTel spans emitted; secrets redacted in logs.
- Conventional Commits on a `feature/webhooks` branch; PR opened against `develop`. No direct commits
  to `main`.
