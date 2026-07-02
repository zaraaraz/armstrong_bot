# Webhooks Module

> Spec: [docs/modules/webhooks.md](../../../docs/modules/webhooks.md) — roadmap item 18 (Phase 4).

Ghost Bot's secure ingress/egress gateway for third-party integrations. It is the
**only** place in the platform allowed to terminate raw external HTTP integration
traffic. Inbound, it verifies provider signatures, deduplicates, and normalizes
heterogeneous payloads into a single canonical `IntegrationEvent` on the Event
Bus — downstream modules depend on our contract, never on a provider's wire
format. Outbound, it delivers the platform's own domain events to externally
registered endpoints with HMAC signing, retry/backoff, and a dead-letter queue.

## Trust boundary

```
External provider ──HTTP──▶ WebhookController (raw body preserved)
        │
        ▼  accept-then-process (fast 202)
  InboundWebhookService
    ├─ resolve endpoint by token (repo + cache-through)
    ├─ SignatureVerifier (per provider, constant-time)   ── verify
    ├─ IdempotencyGuard (cache dedupe) + DB @@unique      ── dedupe
    ├─ persist WebhookIngressDelivery (raw body retained)
    └─ enqueue webhooks.inbound  ─────────────────────────▶ 202 Accepted
                                                              │
  InboundProcessor (BullMQ worker) ◀──────────────────────────┘
    ├─ PayloadNormalizer (per provider) ─▶ IntegrationEvent
    └─ EventBus.publish('integration.event')  ─▶ consumed by other modules

Platform domain events ─▶ OutboundTriggerConsumer ─▶ OutboundDispatchService
    ├─ match WebhookSubscription (allowlisted events, optional JSON filter)
    └─ enqueue webhooks.outbound ─▶ OutboundDeliveryWorker
                                     └─ HMAC-sign ─▶ POST ─▶ retry/backoff ─▶ DLQ
```

## Public API

```ts
import {
  WebhookProvider,      // github | stripe | fivem | custom
  DeliveryStatus,       // received | verified | ... | dead_lettered
  WebhookClaims,        // webhooks.* permission claims
  WebhookEvents,        // emitted bus event names
  SignatureVerifier,    // strategy contract (add a provider additively)
  PayloadNormalizer,    // strategy contract
  type IntegrationEvent,
} from '../webhooks';
```

Cross-module consumers **do not** call this module's services. They subscribe to
`integration.event` on the Event Bus and read the provider-agnostic
`IntegrationEvent` envelope. Everything else (repositories, queues, verifiers,
normalizers, workers, config, services) is module-private.

## Inbound

`POST /webhooks/in/:token` (public, `@ApiExcludeController`). The controller
preserves the raw request body (`main.ts` sets `rawBody: true`) so HMAC is
computed over the exact received bytes. It does the minimum — resolve, verify,
dedupe, persist, enqueue — and returns `202 Accepted`. Normalization and fan-out
happen in the `webhooks.inbound` worker.

- **GitHub** — `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 over the raw body.
- **Stripe** — `Stripe-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 over
  `<t>.<rawBody>` (concatenated as bytes), with a timestamp tolerance for replay
  defense.
- **FiveM / Custom** — shared-secret HMAC-SHA256 in `X-Signature-256` or
  `X-Webhook-Signature` (optional `sha256=` prefix).

All comparisons are constant-time (`crypto.timingSafeEqual`, length-guarded).
Verifiers fail closed on a missing/blank secret. A bad signature returns `401`
and emits nothing; an unknown/disabled endpoint returns `404`; an oversized body
is rejected before parsing (`413`).

## Outbound

Register a `WebhookSubscription` for an allowlisted platform event
(`config.outbound.allowedOutboundEvents`, incl. `integration.event` to
re-broadcast normalized inbound events). The dispatcher matches subscriptions,
applies an optional JSON filter, and enqueues one `webhooks.outbound` job per
match. The worker HMAC-signs the body, POSTs to the target URL, retries 5xx/429/
network failures with exponential backoff up to `maxAttempts`, then dead-letters
(emitting `webhooks.outbound.dead_lettered`). `removeOnFail: false` IS the DLQ.

## Admin API

`/api/v1/webhooks/*`, guild-scoped via `req.user.guildId`, guarded by
`webhooks.*` claims. Endpoints CRUD + rotate, delivery log (paginated/filterable)
+ replay, and outbound subscription CRUD. Signing secrets are **encrypted at
rest** (`EncryptionService`, AES-256-GCM) and returned to the caller exactly once
on create/rotate — never logged, never returned again.

## Configuration

`WEBHOOKS_*` env vars, Zod-validated (`config/webhooks.config.ts`): inbound body
cap, Stripe timestamp tolerance, dedupe TTL, outbound attempts/backoff/timeout,
and the outbound event allowlist. See spec §8.

## Events

| Event | When |
|---|---|
| `integration.event` | A normalizer produced a canonical envelope |
| `webhooks.delivery.failed` | Inbound verification/processing rejected |
| `webhooks.outbound.dead_lettered` | Outbound retries exhausted |

The specific normalized kind (`github.push`, `stripe.payment.succeeded`, …)
travels in `IntegrationEvent.type`, not as its own bus event name.

## As-built deltas from the spec

- Admin routes are `api/v1/webhooks/*` with the guild resolved from
  `req.user.guildId` (audit/notifications precedent), not the spec's
  `/api/guilds/:guildId/webhooks` path param.
- Prisma models are named `WebhookEndpoint`, `WebhookIngressDelivery`,
  `WebhookSubscription`, `WebhookOutboundDelivery` — the ingress/outbound
  delivery models are renamed from the spec's `WebhookDelivery`/`OutboundDelivery`
  to avoid a collision with the pre-existing generic `WebhookDelivery` model and
  the notifications `DeliveryStatus` enum.
- No shared core Queue layer exists; the module ships its own private
  `WebhooksQueues` BullMQ wrapper (same pattern as scheduler/audit/metrics/
  notifications).
- Request DTOs are Zod-parsed at the handler boundary; response DTOs are
  `@ApiProperty` classes (codebase precedent, no global ValidationPipe).
- Dashboard frontend (§14) and Playwright e2e (§13) are DEFERRED, consistent
  with every prior Phase 4 module.
- Migration `20260702180000_add_webhooks_module` is hand-authored (MySQL offline
  at author time); run `prisma migrate deploy` when the DB is up.
