# Notifications Module

> Spec: [docs/modules/notifications.md](../../../docs/modules/notifications.md) — roadmap item 17 (Phase 4).

Ghost Bot's single, unified outbound messaging system. Anything that needs to
reach a human — a Discord user or channel, a webhook, an email inbox, a browser
push subscription — does it through this module. It abstracts the transport
behind one `NotificationProvider` contract, renders i18n templates, respects
per-user/per-guild delivery preferences, and guarantees at-least-once delivery
through BullMQ with retries and a dead-letter queue.

## Public API

```ts
import {
  INotificationService, // the ONLY entry point (inject anywhere)
  NotificationProvider, // transport contract (drop-in a new channel)
  NotificationClaims, // notifications.* claims
  NotificationEvents, // emitted event names
  type DispatchNotificationInput,
  type DispatchResult,
  type NotificationChannel,
  type NotificationCategory,
} from '../notifications';
```

Everything else (repositories, queues, providers, workers, config, routing) is
module-private. `INotificationService.dispatch` is the ONLY sanctioned way to
send.

### Dispatch

```ts
constructor(private readonly notifications: INotificationService) {}

await this.notifications.dispatch({
  guildId: 'g1',
  category: 'moderation',
  priority: 'high',
  templateKey: 'moderation.banned',
  vars: { target: '123', moderator: '456', reason: 'spam', caseId: 'c1' },
  recipients: [{ channelId: 'staff-channel-id' }],
  channels: ['DISCORD_CHANNEL'],
  dedupeKey: 'moderation.banned:c1', // idempotent across retries / replays
});
```

`dispatch` persists a `Notification` + one `NotificationDelivery` per resolved
channel, emits `notification.created`, and enqueues one BullMQ delivery job per
row. It never transports directly — the `DeliveryProcessor` worker does.

## Architecture

```
Controller / Command / DomainEventConsumer
  -> NotificationService.dispatch          (orchestration; no transport)
       -> DedupeService                     (idempotency claim)
       -> PreferenceResolver                (guild+user merge, quiet hours)
       -> NotificationRepository            (persist notification + deliveries)
       -> NotificationQueues                (enqueue one delivery job per channel)
       -> NotificationEventEmitter          (notification.created)

DeliveryProcessor (BullMQ worker)
  -> TemplateService.render                 (i18n ICU render, PT->EN->key)
  -> ProviderRegistry.resolve(channel)
       -> NotificationProvider              (Discord DM/Channel | Webhook | Email | Push)
  -> NotificationRepository.markResult      (SENT / FAILED / DEAD)
  -> NotificationEventEmitter               (notification.delivered | .failed)
```

- **Providers self-register** under the `NOTIFICATION_PROVIDERS` DI token;
  `ProviderRegistry` indexes them by `channel`. Add a transport by implementing
  `NotificationProvider` and listing it — no application-service change.
- **Delivery reliability:** each send is a BullMQ job with bounded attempts and
  exponential backoff. A transient failure throws (BullMQ retries); a permanent
  one marks `DEAD`; exhausted retries land in the DLQ (`removeOnFail: false`).
- **Idempotency:** a `dedupeKey` is claimed in the cache for a TTL; a repeat
  within the window short-circuits so replays produce no duplicate.
- **Integrations:** Twitch/YouTube are polled (`integration-poll` worker) and
  GitHub is webhook-driven; each fans out its `integration.*` event exactly once
  by advancing a per-subscription cursor after a successful publish.

## Channels

| Channel           | Address (recipient field)        | Notes                                    |
| ----------------- | -------------------------------- | ---------------------------------------- |
| `DISCORD_DM`      | `userId`                         | via discord.js `users.fetch().send`      |
| `DISCORD_CHANNEL` | `channelId`                      | text-sendable channels only              |
| `WEBHOOK`         | `webhookUrl`                     | POST JSON; 429/5xx retryable             |
| `EMAIL`           | `email`                          | disabled by default; SMTP seam           |
| `PUSH`            | `pushEndpoint`                   | disabled by default; web-push seam       |

`EMAIL` and `PUSH` ship as contract-complete providers that stay dormant until
`NOTIFICATIONS_EMAIL_ENABLED` / `NOTIFICATIONS_PUSH_ENABLED` are set and their
transport (SMTP client / web-push) is bound at the `deliver()` seam. Enabling
the flag without wiring the transport produces a visible DLQ entry, never a
silent drop.

## Configuration

Global config is ENV-sourced (`NOTIFICATIONS_*`), guild config lives in
`GuildConfig.settings.notifications`. See
[config/notifications.config.ts](config/notifications.config.ts). Key knobs:
`maxDeliveryAttempts`, `backoffBaseMs`, `dedupeTtlSeconds`, quiet-hours window +
timezone, digest cron, integration poll intervals, `githubWebhookSecret`.

## API

REST under `/api/v1/notifications` (guild-scoped via `req.user.guildId`,
`notifications.*` claims). GitHub ingest at `/webhooks/github` authenticates via
`X-Hub-Signature-256` HMAC — not the permission guard.

| Method | Path                                             | Claim                                |
| ------ | ------------------------------------------------ | ------------------------------------ |
| POST   | `/api/v1/notifications`                          | `notifications.dispatch`             |
| GET    | `/api/v1/notifications`                          | `notifications.read`                 |
| GET    | `/api/v1/notifications/:id`                      | `notifications.read`                 |
| DELETE | `/api/v1/notifications/:id`                      | `notifications.cancel`               |
| GET    | `/api/v1/notifications/health`                   | `notifications.read`                 |
| GET    | `/api/v1/notifications/dlq`                       | `notifications.read`                 |
| GET/PUT| `/api/v1/notifications/preferences/:userId`      | `notifications.prefs.*` (self-scope) |
| GET/POST/DELETE | `/api/v1/notifications/integrations[...]` | `notifications.integrations.*`       |
| POST   | `/webhooks/github`                               | HMAC signature                       |

## Commands

`/notify-test`, `/notifications-prefs`, `/notify-integration-add`,
`/notify-integration-remove` (Necord, ephemeral replies).

## Observability

Module-private Prometheus registry (`NotificationsMetrics`):
`notifications_dispatched_total{channel,category}`,
`notifications_delivery_latency_ms`, `notifications_failed_total{channel,reason}`,
`notifications_dlq_total{channel}`, `notifications_provider_health{channel}`.
OpenTelemetry spans via `NotificationsTracing` (real once the Metrics module's
exporter is up).

## As-built deltas from the spec

- REST is scoped via `req.user.guildId` (scheduler/audit precedent), not the
  spec's `/guilds/:guildId/...` path. Preferences/integrations live under
  `/api/v1/notifications/...`.
- Request validation uses **zod** parsed in the handler (audit/scheduler
  precedent), not `class-validator` DTOs. Response DTOs use `@ApiProperty`.
- Routed source events are the real registered names
  (`moderation.ban.executed`, `tickets.ticket.opened`), not the spec's
  illustrative `moderation.member.banned` / `tickets.ticket.created`.
- `EMAIL`/`PUSH` transports are contract-complete but dormant (no `nodemailer` /
  `web-push` dependency added); wiring them is additive at the `deliver()` seam.
- Templates fall back to a built-in `DEFAULT_TEMPLATES` catalog when no DB row
  exists, so keys render on a fresh install before any seeding.
- Migration `20260702160000_add_notifications_module` is HAND-AUTHORED (DB
  offline); run `prisma migrate deploy` when the DB is up.
- Dashboard frontend (spec §14) and Playwright e2e (spec §13) follow the prior
  phases' deferral (frontend excluded from tsc/tests; e2e pending a harness).

## Testing

48 unit specs: template rendering + locale fallback + plurals, preference merge
+ quiet-hours timezone math, dedupe TTL window, provider send mapping + registry
resolution, GitHub HMAC + exactly-once ingest, integration exactly-once poll,
and `NotificationService.dispatch` (persist, one job per channel, dedupe
short-circuit, skipped reasons, cancel). Run:

```
npx vitest run src/modules/notifications
```
