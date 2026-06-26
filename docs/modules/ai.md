# AI Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations for every schema change. Generate tests and docs.
> - Generate DTOs for every endpoint. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Create indexes for searchable fields. Support pagination, caching, translations, and the dashboard.
> - Controllers NEVER touch Prisma; only Repositories touch Prisma. Controller -> Application Service -> Domain Service -> Repository -> Database.
> - No module touches Redis or the LLM provider SDK directly: go through the Cache layer and the `LlmProvider` abstraction.
> - This module communicates with other modules ONLY via the Event Bus or its published public API. It NEVER imports another module's internal services.
> - Default the LLM provider to Anthropic Claude using the latest models (`claude-opus-4-8` for chat/reasoning, `claude-haiku-4-5` for cheap/fast tasks). Keep providers pluggable.
> - Adaptive thinking only on Claude 4.6+ models: `thinking: { type: "adaptive" }`. NEVER send `budget_tokens` / `temperature` / `top_p` to `claude-opus-4-8` (they 400). Use `output_config.effort`.
> - Stream any request with large `max_tokens`. Always budget tokens, enforce per-guild rate limits, and track cost before and after every call.

---

## 1. Purpose

The AI Module is Ghost Bot's integrated AI surface. It provides Discord slash commands — `/ask`, `/summarize`, `/translate`, `/image`, `/moderate`, `/chat` — backed by a provider-agnostic LLM abstraction that defaults to Anthropic Claude. It centralises every concern that AI features share: a pluggable provider interface, token budgeting, per-guild rate limiting, content moderation, conversation memory, and cost tracking.

No other module talks to an LLM SDK directly. Instead they consume the AI Module's published public API (`AiPublicApi`) or react to its events. This keeps provider credentials, cost accounting, and safety policy in one auditable place, and lets the bot swap Claude for another provider (or run several side by side) without touching call sites.

The module is fully guild-aware: every request is scoped to a guild, every budget and rate limit is per-guild, every conversation memory thread belongs to a guild + channel + user, and all user-facing strings are translated through the i18n layer (PT primary, EN secondary).

## 2. Goals

- Expose six first-class slash commands with a consistent UX, streaming responses where useful, and translated output.
- Provide a strict `LlmProvider` abstraction so providers are pluggable; ship an Anthropic Claude provider as the default and a stub/local provider for tests.
- Enforce **token budgeting**: estimate before, measure after, never exceed a per-guild daily/monthly token allowance.
- Enforce **per-guild rate limits** (requests-per-minute and tokens-per-minute) through the Cache layer, with graceful, translated rejection.
- Run **content moderation** on inbound prompts and outbound completions; block, redact, or flag per guild policy.
- Maintain **conversation memory** for `/chat` (and optionally `/ask` follow-ups), windowed and summarised to fit the context window.
- Track **cost** per request, per user, per guild — persisted, queryable, and surfaced on the dashboard.
- Never leak provider internals, API keys, raw stack traces, or another user's data into a Discord channel.
- Be observable: Prometheus metrics, OpenTelemetry spans per provider call, structured Pino logs, audit hooks for moderation decisions.

## 3. Architecture

The module follows the project's strict layer flow. Controllers (Necord command handlers + REST controllers) never touch Prisma or the provider SDK; they call Application Services, which orchestrate Domain Services, the provider abstraction, the Cache layer, the Queue, and Repositories.

```
Discord (Necord)            REST / Swagger
      │                          │
      ▼                          ▼
┌───────────────────────────────────────────┐
│            Controllers / Commands           │  AskCommand, ChatCommand, AiController …
└───────────────────────────────────────────┘
      │ (DTOs only)
      ▼
┌───────────────────────────────────────────┐
│           Application Services               │  AskService, ChatService, ImageService …
│  orchestrate: budget → moderate → provider   │
│  → memory → cost → events                    │
└───────────────────────────────────────────┘
      │                 │                │
      ▼                 ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│Domain Services│ │ LlmProvider   │ │ Core systems      │
│ Budget,        │ │ abstraction   │ │ Cache, Events,    │
│ Moderation,    │ │ (Claude /     │ │ Permissions,      │
│ Memory, Cost   │ │  pluggable)   │ │ Queue, Config     │
└──────────────┘ └──────────────┘ └──────────────────┘
      │
      ▼
┌──────────────┐
│ Repositories  │  (ONLY layer that touches Prisma)
└──────────────┘
      │
      ▼
   MySQL
```

Provider calls are wrapped by a `LlmProviderRegistry` that resolves the active provider from config (`ENV -> Database -> Defaults`). Long-running generations are streamed; heavy/async work (e.g. image generation, bulk summarisation) is dispatched to BullMQ. Cross-module communication is event-driven through the Core Event Bus.

## 4. Folder Structure

```
src/modules/ai/
├── ai.module.ts
├── public/                          # the ONLY surface other modules import
│   ├── ai.public-api.ts             # AiPublicApi abstract class (DI token)
│   ├── ai.public-api.impl.ts
│   ├── ai.contracts.ts              # public DTO/contract types
│   └── index.ts
├── commands/                        # Necord slash command handlers (Controllers)
│   ├── ask.command.ts
│   ├── summarize.command.ts
│   ├── translate.command.ts
│   ├── image.command.ts
│   ├── moderate.command.ts
│   └── chat.command.ts
├── api/                             # REST controllers
│   ├── ai.controller.ts
│   └── ai-usage.controller.ts
├── application/                     # Application Services
│   ├── ask.service.ts
│   ├── summarize.service.ts
│   ├── translate.service.ts
│   ├── image.service.ts
│   ├── moderate.service.ts
│   └── chat.service.ts
├── domain/                          # Domain Services + value objects
│   ├── token-budget.service.ts
│   ├── rate-limit.service.ts
│   ├── moderation.service.ts
│   ├── conversation-memory.service.ts
│   ├── cost-tracking.service.ts
│   └── value-objects/
│       ├── token-usage.vo.ts
│       └── moderation-verdict.vo.ts
├── providers/                       # LLM provider abstraction
│   ├── llm-provider.interface.ts    # LlmProvider abstract class
│   ├── llm-provider.registry.ts
│   ├── anthropic/
│   │   ├── anthropic.provider.ts    # default — wraps @anthropic-ai/sdk
│   │   └── anthropic.mapper.ts
│   └── noop/
│       └── noop.provider.ts         # deterministic stub for tests
├── repositories/                    # ONLY layer touching Prisma
│   ├── ai-request.repository.ts
│   ├── ai-conversation.repository.ts
│   ├── ai-message.repository.ts
│   ├── ai-usage.repository.ts
│   └── ai-moderation-log.repository.ts
├── jobs/                            # BullMQ processors
│   ├── image-generation.processor.ts
│   └── conversation-summarize.processor.ts
├── events/
│   ├── ai.events.ts                 # event name constants + payload types
│   └── handlers/
│       └── guild-removed.handler.ts # purge memory/usage on guild leave
├── config/
│   └── ai.config.ts                 # Zod schema + defaults
├── dto/
│   ├── ask.request.dto.ts
│   ├── ask.response.dto.ts
│   ├── usage-query.dto.ts
│   └── usage.response.dto.ts
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

## 5. Public Interfaces

The provider abstraction and the module's published public API. Everything is strict TypeScript, no `any`.

```typescript
// providers/llm-provider.interface.ts

/** Capabilities a provider may advertise. */
export interface ProviderCapabilities {
  readonly chat: boolean;
  readonly streaming: boolean;
  readonly vision: boolean;
  readonly imageGeneration: boolean;
  readonly nativeModeration: boolean;
  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;
}

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LlmCompletionRequest {
  readonly model: string;
  readonly system?: string;
  readonly messages: ReadonlyArray<LlmMessage>;
  readonly maxOutputTokens: number;
  /** Effort maps to output_config.effort on Claude 4.6+. */
  readonly effort?: 'low' | 'medium' | 'high';
  readonly stream?: boolean;
  /** Correlation id for tracing/cost attribution. */
  readonly requestId: string;
}

export interface LlmTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface LlmCompletionResult {
  readonly text: string;
  readonly model: string;
  readonly usage: LlmTokenUsage;
  readonly stopReason: 'end_turn' | 'max_tokens' | 'refusal' | 'tool_use' | 'stop_sequence';
}

export interface LlmStreamChunk {
  readonly delta: string;
  readonly done: boolean;
  readonly usage?: LlmTokenUsage;
}

export interface LlmImageRequest {
  readonly prompt: string;
  readonly count: number;
  readonly size: '512x512' | '1024x1024' | '1792x1024';
  readonly requestId: string;
}

export interface LlmImageResult {
  /** Buffers are uploaded as Discord attachments — never raw URLs from the provider. */
  readonly images: ReadonlyArray<Buffer>;
  readonly model: string;
  readonly usage: LlmTokenUsage;
}

export interface ProviderModerationResult {
  readonly flagged: boolean;
  readonly categories: ReadonlyArray<string>;
  readonly score: number;
}

/**
 * Pluggable LLM provider. The Anthropic implementation is the default.
 * Resolved at runtime by LlmProviderRegistry from guild/global config.
 */
export abstract class LlmProvider {
  abstract readonly id: string; // e.g. 'anthropic'
  abstract capabilities(): ProviderCapabilities;
  abstract complete(req: LlmCompletionRequest): Promise<LlmCompletionResult>;
  abstract stream(req: LlmCompletionRequest): AsyncIterable<LlmStreamChunk>;
  abstract generateImage(req: LlmImageRequest): Promise<LlmImageResult>;
  /** Optional native moderation; falls back to the Moderation domain service. */
  abstract moderate(text: string): Promise<ProviderModerationResult | null>;
  /** Accurate token count for budgeting; provider-specific tokenizer. */
  abstract countTokens(model: string, messages: ReadonlyArray<LlmMessage>): Promise<number>;
}
```

```typescript
// public/ai.public-api.ts

export interface AskOptions {
  readonly guildId: string;
  readonly userId: string;
  readonly prompt: string;
  readonly locale: string;
  readonly model?: string;
}

export interface AskResult {
  readonly requestId: string;
  readonly text: string;
  readonly usage: LlmTokenUsage;
  readonly costMicroUsd: bigint;
}

export interface SummarizeOptions {
  readonly guildId: string;
  readonly userId: string;
  readonly text: string;
  readonly targetLocale: string;
}

/**
 * The ONLY way another module may use AI capabilities.
 * Bound to AI_PUBLIC_API DI token; never expose internal services.
 */
export abstract class AiPublicApi {
  abstract ask(options: AskOptions): Promise<AskResult>;
  abstract summarize(options: SummarizeOptions): Promise<AskResult>;
  abstract translate(guildId: string, userId: string, text: string, to: string): Promise<AskResult>;
  abstract isWithinBudget(guildId: string): Promise<boolean>;
}

export const AI_PUBLIC_API = Symbol('AI_PUBLIC_API');
```

```typescript
// domain/token-budget.service.ts (interface shape)

export interface BudgetCheck {
  readonly allowed: boolean;
  readonly remainingDaily: number;
  readonly remainingMonthly: number;
  readonly reason?: 'daily_exceeded' | 'monthly_exceeded';
}

export abstract class ITokenBudgetService {
  abstract check(guildId: string, estimatedTokens: number): Promise<BudgetCheck>;
  abstract record(guildId: string, usage: LlmTokenUsage): Promise<void>;
}
```

## 6. Events

All events go through the Core Event Bus. Names are namespaced `ai.*`. Payloads are strict and contain no PII beyond Discord IDs.

```typescript
// events/ai.events.ts

export const AiEvents = {
  RequestCreated: 'ai.request.created',
  RequestCompleted: 'ai.request.completed',
  RequestFailed: 'ai.request.failed',
  ModerationFlagged: 'ai.moderation.flagged',
  BudgetExceeded: 'ai.budget.exceeded',
  RateLimited: 'ai.rate_limited',
  CostRecorded: 'ai.cost.recorded',
  ImageGenerated: 'ai.image.generated',
} as const;

export interface AiRequestCompletedPayload {
  readonly requestId: string;
  readonly guildId: string;
  readonly userId: string;
  readonly command: 'ask' | 'summarize' | 'translate' | 'image' | 'moderate' | 'chat';
  readonly provider: string;
  readonly model: string;
  readonly usage: LlmTokenUsage;
  readonly costMicroUsd: string; // bigint serialised
  readonly durationMs: number;
}

export interface AiModerationFlaggedPayload {
  readonly requestId: string;
  readonly guildId: string;
  readonly userId: string;
  readonly direction: 'inbound' | 'outbound';
  readonly categories: ReadonlyArray<string>;
  readonly action: 'blocked' | 'redacted' | 'flagged';
}

export interface AiBudgetExceededPayload {
  readonly guildId: string;
  readonly scope: 'daily' | 'monthly';
  readonly limitTokens: number;
}
```

**Emitted:** `ai.request.created`, `ai.request.completed`, `ai.request.failed`, `ai.moderation.flagged`, `ai.budget.exceeded`, `ai.rate_limited`, `ai.cost.recorded`, `ai.image.generated`.

**Consumed:**
- `guild.removed` (from the Core/Guild domain) → purge conversation memory, usage rows, and cached budgets for the guild.
- `config.updated` (Config system) → invalidate cached guild AI config.

## 7. Dependencies

Relies only on CORE systems — never on another module's internals.

| Core system | Usage |
|---|---|
| **Cache** | Rate-limit counters (RPM/TPM), guild config, conversation-memory hot window, budget tallies. Namespaced keys, TTLs. No direct Redis access. |
| **Events** | Emit/consume the `ai.*` and lifecycle events in §6 via the Event Bus. |
| **Permissions** | Wildcard claim checks (`ai.*`, `ai.ask`, …) before any command executes. |
| **Database** | Through Repositories only (Prisma). |
| **Queue (BullMQ)** | Image generation, bulk/async summarisation, conversation summarisation, retries + DLQ. |
| **Config** | Guild + global AI settings, validated with Zod, priority `ENV -> Database -> Defaults`. |
| **i18n** | All user-facing strings (errors, embeds, rejections) translated; namespace `ai`. |
| **Logging / Telemetry** | Pino structured logs, Prometheus metrics, OTel spans. |

The `LlmProvider` SDK (`@anthropic-ai/sdk`) is imported **only** inside `providers/anthropic/`. Application and domain code depend on the abstract `LlmProvider`.

## 8. Configuration

Guild-scoped and global settings, Zod-validated, priority `ENV -> Database -> Defaults`.

```typescript
// config/ai.config.ts
import { z } from 'zod';

export const aiGuildConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultModel: z.string().default('claude-opus-4-8'),
  cheapModel: z.string().default('claude-haiku-4-5'),
  effort: z.enum(['low', 'medium', 'high']).default('medium'),
  maxOutputTokens: z.number().int().min(64).max(64000).default(4096),
  dailyTokenBudget: z.number().int().min(0).default(1_000_000),
  monthlyTokenBudget: z.number().int().min(0).default(20_000_000),
  rateLimitPerMinute: z.number().int().min(1).max(120).default(10),
  tokensPerMinute: z.number().int().min(1000).default(100_000),
  moderation: z.object({
    enabled: z.boolean().default(true),
    blockInbound: z.boolean().default(true),
    redactOutbound: z.boolean().default(true),
    blockedCategories: z.array(z.string()).default(['sexual/minors', 'violence/graphic']),
  }).default({}),
  memory: z.object({
    enabled: z.boolean().default(true),
    maxTurns: z.number().int().min(1).max(50).default(12),
    ttlSeconds: z.number().int().min(60).default(3600),
    summariseAfterTurns: z.number().int().min(2).default(20),
  }).default({}),
  imageEnabled: z.boolean().default(false),
});

export type AiGuildConfig = z.infer<typeof aiGuildConfigSchema>;

export const aiGlobalConfigSchema = z.object({
  provider: z.enum(['anthropic', 'noop']).default('anthropic'),
  anthropicApiKey: z.string().min(1), // from ENV only — never DB, never logged
  globalDailyTokenCeiling: z.number().int().default(50_000_000),
  costPerInputTokenMicroUsd: z.number().default(5),   // claude-opus-4-8: $5 / 1M
  costPerOutputTokenMicroUsd: z.number().default(25), // claude-opus-4-8: $25 / 1M
});

export type AiGlobalConfig = z.infer<typeof aiGlobalConfigSchema>;
```

The API key resolves from `ENV` only and is never persisted to the database nor written to logs. Guild config is editable from the dashboard; global config is ENV/deploy-managed.

## 9. Database

Prisma models. All guild-scoped tables carry `guildId` and are indexed for the dashboard's filtered, paginated queries. Soft delete via `deletedAt` where rows may need retention before purge; conversation memory is hard-deleted on guild leave for privacy.

```prisma
model AiRequest {
  id            String   @id @default(cuid())
  guildId       String
  userId        String
  command       String   // ask | summarize | translate | image | moderate | chat
  provider      String
  model         String
  status        String   // pending | completed | failed | blocked
  inputTokens   Int      @default(0)
  outputTokens  Int      @default(0)
  cacheReadTokens  Int   @default(0)
  cacheWriteTokens Int   @default(0)
  costMicroUsd  BigInt   @default(0)
  durationMs    Int      @default(0)
  errorCode     String?
  createdAt     DateTime @default(now())
  deletedAt     DateTime?

  conversation  AiConversation? @relation(fields: [conversationId], references: [id])
  conversationId String?

  @@index([guildId, createdAt])
  @@index([guildId, userId, createdAt])
  @@index([guildId, command])
}

model AiConversation {
  id          String   @id @default(cuid())
  guildId     String
  channelId   String
  userId      String
  title       String?
  summary     String?  @db.Text   // rolling summary for context-window fit
  turnCount   Int      @default(0)
  lastActiveAt DateTime @default(now())
  createdAt   DateTime @default(now())
  deletedAt   DateTime?

  messages    AiMessage[]
  requests    AiRequest[]

  @@unique([guildId, channelId, userId])
  @@index([guildId, lastActiveAt])
}

model AiMessage {
  id              String   @id @default(cuid())
  conversationId  String
  role            String   // system | user | assistant
  content         String   @db.Text
  tokenCount      Int      @default(0)
  createdAt       DateTime @default(now())

  conversation    AiConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
}

model AiUsageDaily {
  id            String   @id @default(cuid())
  guildId       String
  day           DateTime @db.Date
  inputTokens   BigInt   @default(0)
  outputTokens  BigInt   @default(0)
  costMicroUsd  BigInt   @default(0)
  requestCount  Int      @default(0)

  @@unique([guildId, day])
  @@index([guildId, day])
}

model AiModerationLog {
  id         String   @id @default(cuid())
  guildId    String
  userId     String
  requestId  String?
  direction  String   // inbound | outbound
  action     String   // blocked | redacted | flagged
  categories String   @db.Text // JSON array
  score      Float    @default(0)
  createdAt  DateTime @default(now())

  @@index([guildId, createdAt])
  @@index([guildId, userId])
}
```

## 10. API

REST endpoints under `/api/ai`, documented with Swagger/OpenAPI. DTOs validated with Zod (via a Zod validation pipe). All guild-scoped; permission-guarded.

| Method | Path | Body / Query | Description |
|---|---|---|---|
| `POST` | `/api/ai/guilds/:guildId/ask` | `AskRequestDto` | Run a one-shot completion. Returns `AskResponseDto`. |
| `POST` | `/api/ai/guilds/:guildId/summarize` | `SummarizeRequestDto` | Summarise text. |
| `POST` | `/api/ai/guilds/:guildId/translate` | `TranslateRequestDto` | Translate text. |
| `GET` | `/api/ai/guilds/:guildId/usage` | `UsageQueryDto` (paginated, date range) | Usage + cost rollups. Returns `UsageResponseDto`. |
| `GET` | `/api/ai/guilds/:guildId/conversations` | pagination query | List conversations for the guild. |
| `DELETE` | `/api/ai/guilds/:guildId/conversations/:id` | — | Purge a conversation (memory wipe). |
| `GET` | `/api/ai/guilds/:guildId/config` | — | Read guild AI config. |
| `PATCH` | `/api/ai/guilds/:guildId/config` | `UpdateAiConfigDto` | Update guild AI config (Zod-validated). |
| `GET` | `/api/ai/guilds/:guildId/moderation-logs` | paginated | Moderation audit log. |

```typescript
// dto/ask.request.dto.ts
import { z } from 'zod';

export const askRequestSchema = z.object({
  userId: z.string().min(1),
  prompt: z.string().min(1).max(8000),
  model: z.string().optional(),
  locale: z.string().default('pt'),
});
export type AskRequestDto = z.infer<typeof askRequestSchema>;

// dto/ask.response.dto.ts
export interface AskResponseDto {
  readonly requestId: string;
  readonly text: string;
  readonly usage: { inputTokens: number; outputTokens: number };
  readonly costMicroUsd: string;
}
```

**WS:** streaming completions (for the dashboard playground) are exposed over a `ai` WebSocket namespace, emitting `chunk` and `done` frames; the underlying generation reuses the provider `stream()` path.

## 11. Permissions

Wildcard claims this module defines (groups, inheritance, and Discord roles resolve through the Permissions core):

| Claim | Grants |
|---|---|
| `ai.*` | All AI capabilities. |
| `ai.ask` | `/ask` |
| `ai.summarize` | `/summarize` |
| `ai.translate` | `/translate` |
| `ai.image` | `/image` |
| `ai.moderate` | `/moderate` (run moderation on demand) |
| `ai.chat` | `/chat` |
| `ai.config.read` | View AI config / usage. |
| `ai.config.write` | Edit guild AI config. |
| `ai.usage.read` | View usage + cost dashboards. |
| `ai.moderation.read` | View moderation logs. |

Each command handler and REST controller checks the relevant claim before any work. Budget/rate-limit rejections are distinct from permission denials and translated separately.

## 12. Logging

- **Categories:** `ai.request`, `ai.provider`, `ai.budget`, `ai.rate_limit`, `ai.moderation`, `ai.cost`, `ai.memory`.
- Every provider call opens an OpenTelemetry span (`ai.provider.complete`) tagged with `guildId`, `provider`, `model`, `requestId`, token counts, and `durationMs`.
- Prometheus metrics: `ai_requests_total{command,provider,status}`, `ai_tokens_total{direction}`, `ai_cost_micro_usd_total{guild}`, `ai_rate_limited_total`, `ai_moderation_flagged_total{action}`, `ai_provider_latency_seconds` (histogram).
- **Audit hooks:** every moderation decision and every budget-exceeded event writes an audit entry (via `AiModerationLog` + `ai.moderation.flagged` event) so dashboards and compliance can review.
- API keys, prompts containing secrets, and raw provider error bodies are **never** logged; prompts are truncated/redacted per the moderation policy before logging.

## 13. Testing

- **Unit:** `TokenBudgetService` (boundary math, daily/monthly rollover), `RateLimitService` (RPM/TPM window), `ModerationService` (verdict mapping, redaction), `ConversationMemoryService` (windowing + summarise trigger), `CostTrackingService` (micro-USD math with `bigint`), `AnthropicMapper` (request/response mapping, `effort`, no forbidden params). Provider is mocked via `NoopProvider`.
- **Integration:** Application Services with real Repositories against a test MySQL (Prisma migrations applied) — full flow budget → moderate → provider(noop) → memory → cost → events; verify events emitted and rows persisted. Cache and Queue backed by test Redis.
- **E2E:** Necord command simulation for `/ask` and `/chat` (Playwright drives the dashboard playground over WS for streaming), plus REST contract tests for every endpoint against Swagger schema.
- Must cover: budget rejection, rate-limit rejection, inbound block, outbound redaction, refusal handling (`stop_reason: "refusal"`), provider failure → `ai.request.failed`, guild-removed purge.
- Coverage gate: ≥ 85% lines on `application/` and `domain/`.

## 14. Dashboard Integration

- **Usage panel:** daily/monthly token + cost charts per guild, top users, per-command breakdown (from `AiUsageDaily` / `AiRequest`).
- **Budget controls:** edit daily/monthly token budgets, rate limits, default model, effort — writes through `PATCH /config`.
- **Moderation log viewer:** paginated, filterable by user/date/action; backed by `AiModerationLog`.
- **Conversation manager:** list/purge conversations (privacy control).
- **Playground:** test `/ask`-style prompts with live streaming over the `ai` WS namespace (requires `ai.ask`).
- **Provider status:** active provider, model, capability badges, health.

## 15. Future Extensions

- Additional providers (OpenAI, Gemini, local Ollama) behind the same `LlmProvider` abstraction.
- Tool use / function calling so `/ask` can invoke other modules' public APIs through a guarded tool bridge.
- RAG over guild knowledge bases (per-guild vector store) feeding `/ask` and `/chat`.
- Prompt-cache optimisation for repeated system prompts to cut cost.
- Per-user (not just per-guild) budgets and quotas.
- Voice transcription + summarisation for voice channels.

## 16. Tasks for Claude

1. **Schema:** add the five Prisma models in §9, create the migration, regenerate the client.
2. **Config:** implement `ai.config.ts` Zod schemas; wire `ENV -> Database -> Defaults` resolution through the Config core.
3. **Provider abstraction:** implement `LlmProvider`, `LlmProviderRegistry`, the `AnthropicProvider` (default, `claude-opus-4-8`, adaptive thinking, `output_config.effort`, streaming, image, `countTokens`), and `NoopProvider`.
4. **Repositories:** implement all five repositories (the only Prisma touchpoints) with pagination and indexed queries.
5. **Domain services:** `TokenBudgetService`, `RateLimitService` (via Cache), `ModerationService`, `ConversationMemoryService` (windowing + summarise), `CostTrackingService`.
6. **Application services:** `Ask/Summarize/Translate/Image/Moderate/Chat` services orchestrating budget → moderate → provider → memory → cost → events.
7. **Events:** define `ai.events.ts`; emit all events; implement `guild-removed` purge handler.
8. **Commands:** implement the six Necord slash commands with permission guards, i18n, and streaming where useful.
9. **Jobs:** BullMQ `image-generation` and `conversation-summarize` processors with retries + DLQ.
10. **API:** REST controllers + DTOs + Swagger; the `ai` WS namespace for streaming.
11. **Public API:** implement `AiPublicApi` + bind the `AI_PUBLIC_API` token; export only `public/`.
12. **Dashboard:** usage, budget, moderation, conversation, playground panels.
13. **Tests:** unit, integration, e2e per §13.
14. **Docs:** update module README and Swagger; document config keys and permission claims.

## 17. Acceptance Criteria

- `/ask`, `/summarize`, `/translate`, `/image`, `/moderate`, `/chat` work end to end, guild-scoped, with translated output (PT/EN).
- Provider is resolved from config and is swappable to `NoopProvider` in tests without touching call sites.
- Anthropic calls use `claude-opus-4-8` with `thinking: { type: "adaptive" }` and `output_config.effort`; no `budget_tokens`/`temperature`/`top_p` are sent.
- Exceeding a per-guild token budget or rate limit produces a translated rejection and emits `ai.budget.exceeded` / `ai.rate_limited` — no provider call is made.
- Inbound prompts and outbound completions are moderated per guild policy; blocks/redactions are logged and audited.
- `/chat` keeps windowed conversation memory, summarising when `summariseAfterTurns` is hit, fitting the context window.
- Every completed request persists token usage + `costMicroUsd` and emits `ai.request.completed` + `ai.cost.recorded`.
- No module imports an AI internal service; all external use goes through `AiPublicApi` or events.
- Dashboard shows usage/cost, budgets, moderation logs, conversations, and a working streaming playground.

## 18. Definition of Done

- All unit/integration/e2e tests pass; coverage gate met.
- Prisma migration created and applied; client regenerated.
- Zod schemas validate all config and DTOs; no `any` anywhere; ESLint + Prettier clean.
- Swagger/OpenAPI generated for all endpoints; module README and config/permission docs written.
- Prometheus metrics, OTel spans, and Pino categories emit as specified; moderation audit hooks fire.
- Commitlint-compliant Conventional Commits on a `feature/ai` branch; PR opened against `develop` (never a direct commit to `main`); Husky hooks pass; CI green.
