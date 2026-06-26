# Notifications Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations for every schema change. Generate tests and docs.
> - Generate DTOs for every endpoint. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Never touch Prisma outside a Repository. Never touch Redis outside the Cache layer. Never read ENV directly — go through the typed config service.
> - Create indexes for searchable fields. Support pagination, caching, translations, and dashboard surfaces.
> - All outbound delivery goes through BullMQ. Channels are pluggable via the `NotificationProvider` contract — never hardcode a transport in the application service.
> - This module NEVER imports another module's internal services. It consumes domain events from the Event Bus and exposes a published public API for in-process callers.

---

## 1. Purpose

The Notifications Module is Ghost Bot's single, unified outbound messaging system. Any part of the
platform that needs to reach a human — a Discord user, a guild channel, an external webhook, an
email inbox, or a browser push subscription — does so through this module. It abstracts the
**transport** (Discord / Webhook / Email / Push) behind a uniform `NotificationProvider` contract,
renders **i18n templates** with variable interpolation and pluralisation, respects **per-user and
per-guild delivery preferences**, and guarantees **at-least-once delivery** through BullMQ with
retries and a dead-letter queue.

It also hosts the **external integration notifiers** — Twitch (stream online/offline), YouTube
(new upload), and GitHub (push / release / PR) — which poll or receive provider events and fan them
out as platform notifications, all governed by the same templating, preference, and delivery
machinery.

This module is the only place delivery logic lives. Other modules describe *what* happened (via
events) and *who should know* (via subscriptions); Notifications decides *how* and *when* it reaches
them.

## 2. Goals

- **One contract, many transports.** Add a new channel by implementing `NotificationProvider`
  without touching the application service.
- **Reliable delivery.** Every send is a BullMQ job with bounded retries, exponential backoff, and a
  DLQ for permanent failures. No fire-and-forget in the hot path.
- **i18n-first.** Templates are namespaced, support plurals and variable interpolation, primary PT,
  secondary EN, unlimited languages. The recipient's resolved locale drives rendering.
- **Preference-aware.** Users and guilds control which categories reach them and on which channels;
  quiet hours, digests, and per-category opt-out are first-class.
- **Guild-aware.** Every notification is scoped to a guild unless explicitly global (e.g. platform
  maintenance announcements).
- **Integration-ready.** Twitch / YouTube / GitHub notifiers are thin adapters that publish into the
  same pipeline; adding a new integration is additive.
- **Observable.** Delivery attempts, latencies, failures, and provider health are logged, metered
  (Prometheus), and traced (OpenTelemetry).
- **Idempotent.** A `dedupeKey` prevents duplicate sends across retries and redundant event emissions.

## 3. Architecture

The module follows the strict layer flow from `00-project.md`:

```
Controller / Event Consumer
        -> NotificationService            (Application Service: orchestration, preference resolution)
              -> TemplateService           (Domain: render i18n templates)
              -> PreferenceResolver        (Domain: merge guild + user prefs, quiet hours)
              -> NotificationRepository    (persistence of notification + delivery rows)
              -> NotificationQueue (BullMQ) (enqueue delivery jobs)

DeliveryProcessor (BullMQ worker)
        -> ProviderRegistry.resolve(channel)
              -> NotificationProvider      (Discord | Webhook | Email | Push)
        -> NotificationRepository          (update delivery status)
        -> EventBus.emit(notification.delivered | .failed)
```

Key principles:

- **Application service does not transport.** `NotificationService` persists the notification and
  enqueues one delivery job per resolved channel. The BullMQ worker (`DeliveryProcessor`) performs
  the actual send via a provider.
- **ProviderRegistry** is a DI-populated map keyed by `NotificationChannel`. Providers self-register.
- **Integration notifiers** (Twitch/YouTube/GitHub) are separate domain services that detect upstream
  events and call the same public `NotificationService.dispatch(...)`.
- **Cache layer** holds rendered templates, resolved preferences, and provider rate-limit windows.
- **Event Bus** is the inbound surface: other modules emit domain events; a set of consumers maps
  those to notification dispatches via a configurable routing table.

## 4. Folder Structure

```
src/modules/notifications/
├── notifications.module.ts
├── notifications.public.ts                 # the ONLY exported surface (public API + contracts)
├── application/
│   ├── notification.service.ts             # orchestration, dispatch()
│   ├── notification-routing.service.ts     # maps domain events -> dispatch payloads
│   └── integration/
│       ├── twitch-notifier.service.ts
│       ├── youtube-notifier.service.ts
│       └── github-notifier.service.ts
├── domain/
│   ├── template.service.ts                 # render + i18n
│   ├── preference-resolver.service.ts      # merge guild/user prefs, quiet hours, digests
│   ├── dedupe.service.ts
│   └── value-objects/
│       ├── notification-channel.vo.ts
│       └── notification-category.vo.ts
├── providers/
│   ├── provider.contract.ts                # NotificationProvider abstract class
│   ├── provider.registry.ts
│   ├── discord.provider.ts
│   ├── webhook.provider.ts
│   ├── email.provider.ts
│   └── push.provider.ts
├── infrastructure/
│   ├── notification.repository.ts          # ONLY file touching Prisma here
│   ├── notification-preference.repository.ts
│   ├── notification-template.repository.ts
│   └── integration-subscription.repository.ts
├── jobs/
│   ├── delivery.processor.ts               # BullMQ worker
│   ├── digest.processor.ts                 # recurring digest builder
│   ├── integration-poll.processor.ts       # Twitch/YouTube/GitHub polling
│   └── queues.ts                           # queue names + options
├── events/
│   ├── notification.events.ts              # emitted events
│   └── consumers/
│       └── domain-event.consumer.ts        # inbound consumers
├── api/
│   ├── notifications.controller.ts
│   ├── preferences.controller.ts
│   ├── integrations.controller.ts
│   └── dto/
│       ├── dispatch-notification.dto.ts
│       ├── update-preference.dto.ts
│       ├── create-integration-subscription.dto.ts
│       └── notification-response.dto.ts
├── commands/
│   └── notifications.commands.ts           # Necord slash commands
├── config/
│   └── notifications.config.ts             # Zod schema + defaults
└── tests/
    ├── notification.service.spec.ts
    ├── template.service.spec.ts
    ├── preference-resolver.spec.ts
    ├── delivery.processor.spec.ts
    ├── providers/*.spec.ts
    └── e2e/notifications.e2e-spec.ts
```

## 5. Public Interfaces

These are the only symbols exported from `notifications.public.ts`. All transport-specific types
stay internal.

```typescript
export type NotificationChannel = 'DISCORD_DM' | 'DISCORD_CHANNEL' | 'WEBHOOK' | 'EMAIL' | 'PUSH';

export type NotificationCategory =
  | 'system'
  | 'moderation'
  | 'tickets'
  | 'integrations'
  | 'digest'
  | 'marketing';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';

export interface NotificationRecipient {
  /** Discord user id when targeting a person; omit for channel/global sends. */
  readonly userId?: string;
  /** Discord channel id for DISCORD_CHANNEL sends. */
  readonly channelId?: string;
  /** Resolved when the email channel is requested. */
  readonly email?: string;
}

/** Variables interpolated into the template; values are scalars only (no `any`). */
export type TemplateVars = Readonly<Record<string, string | number | boolean | Date>>;

export interface DispatchNotificationInput {
  readonly guildId: string | null; // null => global/platform notification
  readonly category: NotificationCategory;
  readonly priority?: NotificationPriority; // default 'normal'
  readonly templateKey: string; // e.g. 'integrations.twitch.online'
  readonly vars: TemplateVars;
  readonly recipients: ReadonlyArray<NotificationRecipient>;
  /** Force specific channels; otherwise resolved from preferences. */
  readonly channels?: ReadonlyArray<NotificationChannel>;
  /** Idempotency guard across retries / duplicate events. */
  readonly dedupeKey?: string;
  /** Optional locale override; otherwise resolved per recipient. */
  readonly localeOverride?: string;
}

export interface DispatchResult {
  readonly notificationId: string;
  readonly enqueuedDeliveries: number;
  readonly skipped: ReadonlyArray<{ channel: NotificationChannel; reason: string }>;
}

/** Public application API consumed in-process by routing + integration notifiers. */
export abstract class INotificationService {
  abstract dispatch(input: DispatchNotificationInput): Promise<DispatchResult>;
  abstract cancelPending(notificationId: string): Promise<void>;
}

/** Rendered, transport-agnostic message handed to a provider. */
export interface RenderedMessage {
  readonly subject: string | null; // used by email; null for chat transports
  readonly body: string;
  readonly locale: string;
  readonly category: NotificationCategory;
  readonly priority: NotificationPriority;
}

/** Outcome a provider returns for a single delivery attempt. */
export interface ProviderSendResult {
  readonly ok: boolean;
  readonly providerMessageId?: string;
  readonly retryable: boolean;
  readonly error?: string;
}

/** Every transport implements this. Registered into ProviderRegistry via DI. */
export abstract class NotificationProvider {
  abstract readonly channel: NotificationChannel;
  abstract send(
    recipient: NotificationRecipient,
    message: RenderedMessage,
    guildId: string | null,
  ): Promise<ProviderSendResult>;
  /** Lightweight health probe surfaced to metrics + dashboard. */
  abstract healthCheck(): Promise<{ healthy: boolean; detail?: string }>;
}
```

## 6. Events

Payloads are versioned and namespaced. Emitted events use the `notification.*` namespace.

```typescript
export interface NotificationCreatedEvent {
  readonly notificationId: string;
  readonly guildId: string | null;
  readonly category: NotificationCategory;
  readonly channels: ReadonlyArray<NotificationChannel>;
}

export interface NotificationDeliveredEvent {
  readonly notificationId: string;
  readonly deliveryId: string;
  readonly channel: NotificationChannel;
  readonly providerMessageId: string | null;
  readonly latencyMs: number;
}

export interface NotificationFailedEvent {
  readonly notificationId: string;
  readonly deliveryId: string;
  readonly channel: NotificationChannel;
  readonly attempts: number;
  readonly movedToDlq: boolean;
  readonly error: string;
}
```

**Emitted**

| Event                       | When                                              |
| --------------------------- | ------------------------------------------------- |
| `notification.created`      | After persistence, before enqueue.                |
| `notification.delivered`    | Provider returns `ok: true`.                      |
| `notification.failed`       | Attempt fails (per attempt; flags DLQ on final).  |

**Consumed** (mapped to dispatches via `NotificationRoutingService`; routing table is config-driven)

| Event (from other modules) | Resulting notification                                  |
| -------------------------- | ------------------------------------------------------- |
| `moderation.member.banned` | `moderation.banned` to configured staff channel/users.  |
| `tickets.ticket.created`   | `tickets.created` to ticket subscribers.                |
| `integration.twitch.online`| `integrations.twitch.online` to guild announce channel. |
| `integration.youtube.upload` | `integrations.youtube.upload` to subscribers.         |
| `integration.github.push`  | `integrations.github.push` to dev channel.             |

The module never imports the emitting modules; it only knows the event contract names registered in
the routing table.

## 7. Dependencies

Only CORE systems — never another module directly.

- **Event Bus** — inbound domain events (consumers) and outbound `notification.*` events.
- **Cache layer** — rendered template cache, resolved-preference cache, provider rate-limit windows,
  integration poll cursors. Namespaced keys (`notif:tmpl:*`, `notif:pref:*`, `notif:rl:*`).
  Never touches Redis directly.
- **Queue (BullMQ)** — `notifications.delivery`, `notifications.digest`,
  `notifications.integration-poll` queues; retries, backoff, DLQ.
- **Permissions** — claim checks for command/API surfaces (`notifications.*`).
- **Database** — only through this module's repositories (Prisma).
- **Config service** — typed, Zod-validated config (ENV -> DB -> defaults).
- **i18n core** — translation catalogues, plural rules, locale resolution.
- **Discord client (Necord/discord.js)** — used exclusively inside `DiscordProvider`.

## 8. Configuration

Config priority ENV -> Database -> Defaults, validated with Zod. Guild-scoped values override
global defaults.

```typescript
import { z } from 'zod';

export const notificationChannelEnum = z.enum([
  'DISCORD_DM',
  'DISCORD_CHANNEL',
  'WEBHOOK',
  'EMAIL',
  'PUSH',
]);

export const notificationsGlobalConfigSchema = z.object({
  defaultLocale: z.string().min(2).default('pt'),
  maxDeliveryAttempts: z.number().int().min(1).max(10).default(5),
  backoffBaseMs: z.number().int().min(100).default(2000),
  dedupeTtlSeconds: z.number().int().min(0).default(3600),
  email: z.object({
    enabled: z.boolean().default(false),
    fromAddress: z.string().email().default('no-reply@ghostbot.dev'),
    smtpUrl: z.string().url().optional(),
  }),
  push: z.object({
    enabled: z.boolean().default(false),
    vapidPublicKey: z.string().optional(),
  }),
  integrations: z.object({
    twitchPollSeconds: z.number().int().min(30).default(60),
    youtubePollSeconds: z.number().int().min(60).default(300),
    githubWebhookSecret: z.string().optional(),
  }),
});

export const notificationsGuildConfigSchema = z.object({
  enabledChannels: z.array(notificationChannelEnum).default(['DISCORD_CHANNEL']),
  announceChannelId: z.string().nullable().default(null),
  staffChannelId: z.string().nullable().default(null),
  quietHours: z
    .object({
      enabled: z.boolean().default(false),
      startHour: z.number().int().min(0).max(23).default(23),
      endHour: z.number().int().min(0).max(23).default(7),
      timezone: z.string().default('Europe/Lisbon'),
    })
    .default({ enabled: false, startHour: 23, endHour: 7, timezone: 'Europe/Lisbon' }),
  digest: z
    .object({
      enabled: z.boolean().default(false),
      cron: z.string().default('0 9 * * *'),
    })
    .default({ enabled: false, cron: '0 9 * * *' }),
});

export type NotificationsGlobalConfig = z.infer<typeof notificationsGlobalConfigSchema>;
export type NotificationsGuildConfig = z.infer<typeof notificationsGuildConfigSchema>;
```

## 9. Database

Prisma models. All searchable fields indexed; rows soft-deleted via `deletedAt`. All guild-scoped
rows carry `guildId` (nullable for global notifications).

```prisma
enum NotificationChannel {
  DISCORD_DM
  DISCORD_CHANNEL
  WEBHOOK
  EMAIL
  PUSH
}

enum DeliveryStatus {
  PENDING
  SENT
  FAILED
  DEAD
  CANCELLED
}

enum IntegrationProvider {
  TWITCH
  YOUTUBE
  GITHUB
}

model Notification {
  id          String              @id @default(cuid())
  guildId     String?
  category    String
  priority    String              @default("normal")
  templateKey String
  vars        Json
  dedupeKey   String?
  createdAt   DateTime            @default(now())
  deletedAt   DateTime?
  deliveries  NotificationDelivery[]

  @@index([guildId, category])
  @@index([dedupeKey])
  @@index([createdAt])
}

model NotificationDelivery {
  id                String              @id @default(cuid())
  notificationId    String
  notification      Notification        @relation(fields: [notificationId], references: [id])
  channel           NotificationChannel
  status            DeliveryStatus      @default(PENDING)
  recipientUserId   String?
  recipientRef      String?             // channelId / email / push endpoint
  providerMessageId String?
  attempts          Int                 @default(0)
  lastError         String?             @db.Text
  scheduledFor      DateTime?
  deliveredAt       DateTime?
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  @@index([notificationId])
  @@index([status, scheduledFor])
  @@index([channel, status])
}

model NotificationPreference {
  id          String              @id @default(cuid())
  guildId     String
  userId      String
  category    String
  channel     NotificationChannel
  enabled     Boolean             @default(true)
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  deletedAt   DateTime?

  @@unique([guildId, userId, category, channel])
  @@index([guildId, userId])
}

model NotificationTemplate {
  id        String   @id @default(cuid())
  guildId   String?  // null => global default template
  key       String
  locale    String
  subject   String?
  body      String   @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  @@unique([guildId, key, locale])
  @@index([key, locale])
}

model IntegrationSubscription {
  id            String              @id @default(cuid())
  guildId       String
  provider      IntegrationProvider
  externalId    String              // twitch login, youtube channel id, github repo
  announceChannelId String?
  cursor        String?             // last seen video id / commit sha / stream id
  active        Boolean             @default(true)
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt
  deletedAt     DateTime?

  @@unique([guildId, provider, externalId])
  @@index([provider, active])
}
```

Soft-delete note: repositories scope all reads to `deletedAt IS NULL`; the dashboard may expose
archived templates/subscriptions via an explicit `includeDeleted` flag gated by permission.

## 10. API

REST under `/api/v1`, documented in Swagger. All endpoints guild-scoped via path or query and guarded
by permission claims. List endpoints paginate (`page`, `pageSize`, max 100).

| Method | Path                                                  | Claim                          | Description                          |
| ------ | ----------------------------------------------------- | ------------------------------ | ------------------------------------ |
| POST   | `/guilds/:guildId/notifications`                      | `notifications.dispatch`       | Dispatch an ad-hoc notification.     |
| GET    | `/guilds/:guildId/notifications`                      | `notifications.read`           | List notifications (paginated).      |
| GET    | `/guilds/:guildId/notifications/:id`                  | `notifications.read`           | Get one with delivery status.        |
| DELETE | `/guilds/:guildId/notifications/:id`                  | `notifications.cancel`         | Cancel pending deliveries.           |
| GET    | `/guilds/:guildId/preferences/:userId`                | `notifications.prefs.read`     | Read merged preferences.             |
| PUT    | `/guilds/:guildId/preferences/:userId`                | `notifications.prefs.manage`   | Upsert preferences.                  |
| GET    | `/guilds/:guildId/integrations`                       | `notifications.integrations.read` | List integration subscriptions.   |
| POST   | `/guilds/:guildId/integrations`                       | `notifications.integrations.manage` | Subscribe to Twitch/YT/GitHub.  |
| DELETE | `/guilds/:guildId/integrations/:id`                   | `notifications.integrations.manage` | Remove a subscription.          |
| POST   | `/webhooks/github`                                    | (HMAC signature)               | GitHub webhook ingest.               |

```typescript
import { IsString, IsOptional, IsEnum, IsArray, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class DispatchNotificationDto {
  @IsEnum(['system', 'moderation', 'tickets', 'integrations', 'digest', 'marketing'])
  category!: NotificationCategory;

  @IsString()
  templateKey!: string;

  @IsObject()
  vars!: TemplateVars;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipientDto)
  recipients!: RecipientDto[];

  @IsOptional()
  @IsArray()
  @IsEnum(['DISCORD_DM', 'DISCORD_CHANNEL', 'WEBHOOK', 'EMAIL', 'PUSH'], { each: true })
  channels?: NotificationChannel[];

  @IsOptional()
  @IsString()
  dedupeKey?: string;
}

export class CreateIntegrationSubscriptionDto {
  @IsEnum(['TWITCH', 'YOUTUBE', 'GITHUB'])
  provider!: 'TWITCH' | 'YOUTUBE' | 'GITHUB';

  @IsString()
  externalId!: string;

  @IsOptional()
  @IsString()
  announceChannelId?: string;
}
```

WS: the dashboard subscribes to `notification.delivered` / `notification.failed` over the existing
gateway for live delivery status — no new socket is introduced by this module.

## 11. Permissions

Wildcard-capable claims under the `notifications` namespace:

- `notifications.dispatch` — send ad-hoc notifications.
- `notifications.read` — view notifications and delivery status.
- `notifications.cancel` — cancel pending deliveries.
- `notifications.prefs.read` — read preferences (own or others).
- `notifications.prefs.manage` — modify preferences.
- `notifications.integrations.read` — view integration subscriptions.
- `notifications.integrations.manage` — create/remove integration subscriptions.
- `notifications.templates.manage` — edit guild templates.
- `notifications.*` — full module access (groups/inheritance/Discord roles apply per the core model).

Users may always manage their *own* preferences without `prefs.manage` (self-scope check).

## 12. Logging

Pino structured logs, category `notifications`, with sub-categories:

- `notifications.dispatch` — dispatch accepted, recipient count, resolved channels, dedupe hits.
- `notifications.delivery` — per-attempt outcome, channel, latencyMs, providerMessageId, retry/backoff.
- `notifications.dlq` — permanent failures moved to DLQ (priority `high`).
- `notifications.integration` — poll cursors advanced, upstream events detected.

Every log carries `traceId`, `guildId`, `notificationId`, and `deliveryId` for OpenTelemetry
correlation. Prometheus metrics: `notifications_dispatched_total{channel,category}`,
`notifications_delivery_latency_ms` (histogram), `notifications_failed_total{channel,reason}`,
`notifications_dlq_total`, `notifications_provider_health{channel}`.

Audit hooks: preference changes, template edits, and integration subscription create/delete emit
audit-log entries via the core audit hook (actor, before/after, guildId).

## 13. Testing

- **Unit** — `TemplateService` (interpolation, plurals, locale fallback PT->EN->key),
  `PreferenceResolver` (guild+user merge, quiet hours window math across timezones, self-scope),
  `DedupeService` (TTL window), each provider's `send` mapping to `ProviderSendResult`.
- **Integration** — `NotificationService.dispatch` against a test DB + in-memory queue: persistence,
  one job per resolved channel, dedupe short-circuit, skipped-channel reasons.
  `DeliveryProcessor` retry/backoff and DLQ transition with a flaky fake provider.
- **e2e (Playwright/Vitest)** — POST dispatch -> worker delivers via fake providers -> GET shows
  `SENT`; GitHub webhook ingest with valid/invalid HMAC; integration poll detects a new upload and
  fans out exactly once (cursor advances, no duplicate on re-poll).
- Coverage gates: provider registry resolution, all `DeliveryStatus` transitions, all branches of
  preference resolution. No `any` in tests; fakes implement the real `NotificationProvider` contract.

## 14. Dashboard Integration

- **Notifications feed** — paginated list with live status badges (PENDING/SENT/FAILED/DEAD) fed by
  `notification.delivered` / `notification.failed` over the dashboard gateway.
- **Preference center** — per-category × per-channel toggle grid (guild and per-user), quiet hours
  editor with timezone, digest schedule toggle.
- **Template editor** — i18n-aware editor (locale tabs PT/EN/+), live preview with sample vars,
  validation of unknown variables.
- **Integrations panel** — add/remove Twitch/YouTube/GitHub subscriptions, choose announce channel,
  show last-seen cursor and provider health.
- **DLQ inspector** — failed deliveries with last error and a retry action (gated by
  `notifications.dispatch`).

## 15. Future Extensions

- SMS and Slack/Teams providers (drop-in `NotificationProvider`).
- Rich Discord embed/component templates beyond plain body.
- Per-recipient rate limiting and batching/throttling windows.
- A/B template variants and engagement tracking (opens/clicks for email/push).
- Webhook-based (EventSub / PubSubHubbub) integrations to replace polling for Twitch/YouTube.
- Localised digest summarisation with per-category sections.

## 16. Tasks for Claude

1. **Schema** — add `Notification`, `NotificationDelivery`, `NotificationPreference`,
   `NotificationTemplate`, `IntegrationSubscription` models and enums; create the Prisma migration.
2. **Repositories** — implement the four repositories (Prisma-only); add indexes and soft-delete scoping.
3. **Config** — add `notifications.config.ts` Zod schemas (global + guild) wired through the config service.
4. **Domain services** — `TemplateService`, `PreferenceResolver`, `DedupeService` with unit tests.
5. **Providers** — `NotificationProvider` contract, `ProviderRegistry`, and Discord/Webhook/Email/Push
   providers; register via DI.
6. **Application service** — `NotificationService.dispatch` + `cancelPending`; persist, resolve, enqueue.
7. **Queues + workers** — `delivery.processor`, `digest.processor`, `integration-poll.processor`;
   retries, backoff, DLQ.
8. **Events** — emit `notification.*`; implement `domain-event.consumer` + `NotificationRoutingService`.
9. **Integration notifiers** — Twitch/YouTube/GitHub services + GitHub webhook ingest.
10. **Commands** — Necord slash commands (see below).
11. **API** — controllers + DTOs + Swagger for notifications, preferences, integrations.
12. **Dashboard** — feed, preference center, template editor, integrations panel, DLQ inspector.
13. **Tests** — unit/integration/e2e per section 13.
14. **Docs** — update module README and public API reference.

Slash commands:

```
/notify-test <category> [channel]
/notifications-prefs
/notify-integration-add <provider> <externalId> [channel]
/notify-integration-remove <id>
```

## 17. Acceptance Criteria

- [ ] Dispatching a notification persists a `Notification` and one `NotificationDelivery` per resolved channel.
- [ ] Each delivery runs as a BullMQ job; transient failures retry with backoff; permanent failures land in the DLQ.
- [ ] `dedupeKey` prevents duplicate sends within the configured TTL across retries and repeated events.
- [ ] Templates render in the recipient's resolved locale with interpolation and plurals; missing locale falls back PT->EN->key.
- [ ] Per-user and per-guild preferences correctly enable/disable channels; quiet hours defer non-critical sends.
- [ ] Twitch online, YouTube upload, and GitHub push each fan out exactly once (cursor advances; re-poll produces no duplicate).
- [ ] GitHub webhook rejects invalid HMAC signatures.
- [ ] `notification.delivered` / `notification.failed` events are emitted and visible live on the dashboard.
- [ ] All endpoints enforce `notifications.*` claims and paginate list responses.
- [ ] No module imports Prisma/Redis directly outside the repository/cache layers.

## 18. Definition of Done

- [ ] All unit, integration, and e2e tests pass (Vitest + Playwright); coverage gates met.
- [ ] Prisma migration created, reviewed, and applied cleanly; rollback verified.
- [ ] ESLint/Prettier clean; no `any`; Commitlint-valid Conventional Commits.
- [ ] Swagger/OpenAPI updated; DTOs documented; public API reference written.
- [ ] Prometheus metrics and OpenTelemetry traces emitted and verified in Grafana.
- [ ] Dashboard surfaces implemented and wired to live events.
- [ ] Docs (this file + module README) updated; no other module modified.
- [ ] PR opened against `develop` from `feature/notifications`; CI green; reviewed and approved.
