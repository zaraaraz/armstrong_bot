# Games Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - This module **never** imports another module's internal services. Economy, leveling, and notifications integrate **only** via the Event Bus or a published public API/contract.
> - Keep backwards compatibility. Create Prisma migrations for every schema change. Generate tests and docs alongside code.
> - Generate DTOs for every API surface. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection everywhere.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Create indexes for searchable fields (guildId, gameKey, userId, status). Support pagination, caching, translations (PT primary, EN secondary), and dashboard wiring.
> - The Game engine is a plug-in pattern: every game implements the `Game<TState, TMove>` contract. Never special-case a single game inside the engine core.
> - All game session state goes through the `GameSessionRepository` and is cached via the Cache layer. No module touches Prisma or Redis directly except this module's repositories and the Cache layer.
> - Economy is **optional**. The engine must run fully with economy disabled; wagers degrade to no-ops when the economy module does not acknowledge a debit request.

---

## 1. Purpose

The **Games Module** provides an extensible, multi-guild collection of interactive games playable directly inside Discord via slash commands and button/select-menu interactions. It ships a curated set of games — **TicTacToe, Connect4, Blackjack, Poker, Slots, Roulette, Trivia, Wordle, Hangman, Mines, Guess Number, Chess, and Uno** — on top of a single, reusable **game engine**.

The module is responsible for:

- A **plug-in game engine**: every game is a self-contained implementation of the `Game<TState, TMove>` contract. New games are added without touching engine internals.
- **Per-game session state**: each active match is a `GameSession` with serialized typed state, players, turn tracking, and lifecycle status.
- A **Discord interaction layer** that renders game state as embeds + button/select-menu components and routes component interactions back into the engine as moves.
- **Optional economy integration** (wagers, payouts) strictly through the Event Bus — never a direct import of the economy module.
- **Leaderboards** per guild, per game, with windowed ranking (all-time, monthly, weekly).

This document is the single source of truth for the Games Module implementation. It defines the public API the rest of the platform may rely on; everything else is internal and may change.

## 2. Goals

- **Pluggable**: add a new game by implementing one interface and registering it. Engine code never changes.
- **Strictly typed**: each game declares its own `TState` and `TMove`. No `any`, no untyped JSON blobs leaking out of the engine boundary.
- **Guild-aware**: every session, leaderboard entry, and config is scoped to a `guildId`. Defaults are per-guild overridable.
- **Resilient state**: sessions survive bot restarts (persisted in MySQL via Prisma), are cached for hot reads, and expire via TTL + a BullMQ reaper.
- **Economy-optional**: games with wagers work when economy is present and degrade gracefully when it is absent or denies the debit.
- **Concurrency-safe**: a single session processes one move at a time (per-session lock via the Cache layer) to avoid double-moves from rapid button clicks.
- **i18n-first**: all user-facing strings come from the `games` i18n namespace (PT primary, EN secondary).
- **Observable**: every match start/move/end is logged, counted (Prometheus), and traced (OpenTelemetry).
- **Fair**: randomness for Slots/Roulette/Blackjack/Poker uses a single auditable RNG service with logged seeds for dispute resolution.

## 3. Architecture

The module follows the strict layer flow from `00-project.md`:

```
Discord Interaction (slash cmd / button / select)
        │
        ▼
GamesController (Necord)  ── NEVER touches Prisma/Redis
        │
        ▼
GameSessionService (Application)
        │
        ├─► GameRegistry ──► Game<TState,TMove> (plug-in: TicTacToe, Blackjack, …)
        │                         │
        │                         └─► RngService (domain)
        │
        ├─► GameSessionRepository ──► Prisma ──► MySQL
        ├─► LeaderboardService ──► LeaderboardRepository ──► Prisma
        ├─► CacheService (memory + Redis, session lock + hot state)
        ├─► EventBus (economy wager/payout, achievements, notifications)
        └─► QueueService (BullMQ: session reaper, AI/timeout turns)
```

Key design points:

- **GameRegistry** holds every registered `Game` keyed by `gameKey`. The engine is generic: it asks the registry for the game, calls `applyMove`, and persists the returned new state. It does not know what TicTacToe *is*.
- **The engine is pure-ish**: `Game.applyMove(state, move, ctx)` returns a new state + a list of side-effect intents (e.g. `RequestPayout`). The service translates intents into Event Bus messages. Games never publish events themselves.
- **Rendering is delegated**: each `Game` exposes `render(state, i18n)` returning a `GameView` (embed + components). The controller turns the `GameView` into Discord payloads.
- **Economy is decoupled**: wagers are a request/response over the Event Bus with a correlation id and timeout. If no economy module answers, the wager is treated as zero.

## 4. Folder Structure

```
src/modules/games/
├── games.module.ts
├── games.controller.ts                 # Necord slash commands + component handlers
├── application/
│   ├── game-session.service.ts         # lifecycle: create / move / end / abandon
│   ├── leaderboard.service.ts
│   ├── matchmaking.service.ts          # join/invite/challenge flows
│   └── economy-bridge.service.ts       # wager/payout via Event Bus (no direct import)
├── domain/
│   ├── game.interface.ts               # Game<TState,TMove>, GameContext, GameView, intents
│   ├── game-registry.ts                # registers + resolves games by key
│   ├── rng.service.ts                  # auditable RNG (seeded, logged)
│   ├── session-state.ts               # SessionStatus, PlayerSlot, base session types
│   └── errors.ts                       # GameError hierarchy
├── games/                              # the plug-ins
│   ├── tictactoe/tictactoe.game.ts
│   ├── connect4/connect4.game.ts
│   ├── blackjack/blackjack.game.ts
│   ├── poker/poker.game.ts
│   ├── slots/slots.game.ts
│   ├── roulette/roulette.game.ts
│   ├── trivia/trivia.game.ts
│   ├── wordle/wordle.game.ts
│   ├── hangman/hangman.game.ts
│   ├── mines/mines.game.ts
│   ├── guess-number/guess-number.game.ts
│   ├── chess/chess.game.ts
│   └── uno/uno.game.ts
├── infrastructure/
│   ├── game-session.repository.ts
│   ├── leaderboard.repository.ts
│   └── prisma/                         # (schema lives in central schema.prisma)
├── interaction/
│   ├── component-id.codec.ts           # encode/decode customId <-> {sessionId,action,payload}
│   ├── view-renderer.ts                # GameView -> Discord embed + ActionRows
│   └── dto/
│       ├── start-game.dto.ts
│       ├── session-response.dto.ts
│       └── leaderboard-query.dto.ts
├── config/
│   └── games.config.ts                 # Zod schema, defaults, guild overrides
├── jobs/
│   ├── session-reaper.processor.ts     # expire stale sessions
│   └── ai-turn.processor.ts            # bot/AI moves + timed-out turns
├── api/
│   └── games.api.controller.ts         # REST (dashboard)
└── public/
    └── games.contract.ts               # the ONLY thing other modules may import
```

## 5. Public Interfaces

The `Game<TState, TMove>` plug-in contract is the heart of the engine. Every game implements it.

```typescript
// src/modules/games/domain/game.interface.ts

/** Stable identifier used in DB, customIds, leaderboards, config. */
export type GameKey =
  | 'tictactoe' | 'connect4' | 'blackjack' | 'poker' | 'slots'
  | 'roulette' | 'trivia' | 'wordle' | 'hangman' | 'mines'
  | 'guess_number' | 'chess' | 'uno';

export type PlayerKind = 'human' | 'ai' | 'dealer';

export interface GamePlayer {
  readonly slot: number;            // 0-based seat index
  readonly userId: string | null;   // null for AI/dealer
  readonly kind: PlayerKind;
  readonly displayName: string;
}

/** Immutable per-move context passed to the game logic. */
export interface GameContext {
  readonly guildId: string;
  readonly sessionId: string;
  readonly players: readonly GamePlayer[];
  readonly actingUserId: string | null; // who triggered this move (null = system/AI)
  readonly now: Date;
  readonly rng: Rng;                     // auditable, seeded
  readonly wager: bigint;                // 0n when economy disabled/denied
}

/** Side-effect intents returned by a move; the service translates them to events. */
export type GameIntent =
  | { readonly type: 'request_payout'; readonly userId: string; readonly amount: bigint; readonly reason: string }
  | { readonly type: 'request_refund'; readonly userId: string; readonly amount: bigint }
  | { readonly type: 'schedule_turn'; readonly delayMs: number }   // AI / timed turn
  | { readonly type: 'notify'; readonly i18nKey: string; readonly vars: Readonly<Record<string, string | number>> };

export interface MoveResult<TState> {
  readonly state: TState;
  readonly status: SessionStatus;
  readonly winnerSlots: readonly number[];    // empty until decided; draw => empty + status 'finished'
  readonly nextTurnSlot: number | null;       // null when no active turn (finished / simultaneous)
  readonly intents: readonly GameIntent[];
}

/** A renderable view: an embed description + interaction components. */
export interface GameView {
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly vars: Readonly<Record<string, string | number>>;
  readonly fields: readonly { readonly nameKey: string; readonly valueKey: string; readonly inline: boolean }[];
  readonly components: readonly GameComponentRow[];
  readonly imageDataUri?: string;             // optional board render (e.g. chess PNG)
}

export interface GameComponentRow {
  readonly kind: 'buttons' | 'select';
  readonly items: readonly GameComponentItem[];
}

export interface GameComponentItem {
  readonly action: string;                    // game-defined, e.g. 'cell:4', 'hit', 'col:3'
  readonly labelKey: string;
  readonly style?: 'primary' | 'secondary' | 'success' | 'danger';
  readonly emoji?: string;
  readonly disabled?: boolean;
}

/**
 * The plug-in contract. TState MUST be JSON-serializable. TMove is the decoded
 * component action for this game. Implementations MUST be deterministic given
 * (state, move, ctx.rng) so matches are reproducible from the logged seed.
 */
export interface Game<TState extends object, TMove> {
  readonly key: GameKey;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly supportsWager: boolean;
  readonly supportsAi: boolean;

  /** Build the initial state for a new session. */
  createInitialState(ctx: GameContext): TState;

  /** Decode a raw component action string into a typed move; reject invalid input. */
  parseMove(raw: string, state: TState, ctx: GameContext): TMove;

  /** Validate + apply a move. Pure: returns new state, never mutates the input. */
  applyMove(state: TState, move: TMove, ctx: GameContext): MoveResult<TState>;

  /** Produce the renderable view for current state. */
  render(state: TState, ctx: GameContext): GameView;

  /** Optional AI/dealer move generator for bot turns. */
  computeAiMove?(state: TState, ctx: GameContext): TMove;
}
```

`Rng` and the registry:

```typescript
// src/modules/games/domain/rng.service.ts
export interface Rng {
  readonly seed: string;
  int(minInclusive: number, maxExclusive: number): number;
  shuffle<T>(items: readonly T[]): T[];
  pick<T>(items: readonly T[]): T;
}

// src/modules/games/domain/game-registry.ts
export abstract class GameRegistry {
  abstract register<TState extends object, TMove>(game: Game<TState, TMove>): void;
  abstract resolve(key: GameKey): Game<object, unknown>;
  abstract list(): readonly GameKey[];
  abstract has(key: GameKey): boolean;
}
```

The Application service contract:

```typescript
// src/modules/games/application/game-session.service.ts
export interface StartGameParams {
  readonly guildId: string;
  readonly channelId: string;
  readonly gameKey: GameKey;
  readonly hostUserId: string;
  readonly opponentUserIds: readonly string[]; // empty => open challenge or vs AI
  readonly wager: bigint;                       // requested; clamped to economy result
}

export abstract class GameSessionService {
  abstract start(params: StartGameParams): Promise<SessionSnapshot>;
  abstract applyComponentAction(sessionId: string, userId: string, action: string): Promise<SessionSnapshot>;
  abstract join(sessionId: string, userId: string): Promise<SessionSnapshot>;
  abstract abandon(sessionId: string, userId: string): Promise<SessionSnapshot>;
  abstract get(sessionId: string): Promise<SessionSnapshot | null>;
}
```

## 6. Events

All economy/notification/achievement interaction happens over the Event Bus. Events are namespaced `games.*` (emitted) and `economy.*` (consumed). Payloads are versioned and Zod-validated at the bus boundary.

**Emitted events**

```typescript
export interface GameStartedEvent {
  readonly v: 1;
  readonly guildId: string;
  readonly sessionId: string;
  readonly gameKey: GameKey;
  readonly players: readonly { userId: string | null; slot: number; kind: PlayerKind }[];
  readonly wager: string;        // bigint serialized as string
  readonly startedAt: string;    // ISO
}

export interface GameFinishedEvent {
  readonly v: 1;
  readonly guildId: string;
  readonly sessionId: string;
  readonly gameKey: GameKey;
  readonly winnerUserIds: readonly string[];   // empty => draw / house
  readonly loserUserIds: readonly string[];
  readonly wager: string;
  readonly durationMs: number;
  readonly finishedAt: string;
}

// Economy request/response (correlation-based; economy module answers if present)
export interface GameWagerRequestedEvent {
  readonly v: 1;
  readonly correlationId: string;
  readonly guildId: string;
  readonly userId: string;
  readonly amount: string;       // bigint as string
  readonly sessionId: string;
}

export interface GamePayoutRequestedEvent {
  readonly v: 1;
  readonly correlationId: string;
  readonly guildId: string;
  readonly userId: string;
  readonly amount: string;
  readonly sessionId: string;
  readonly reason: string;
}
```

| Event | Direction | When | Consumers |
|---|---|---|---|
| `games.session.started` | emit | session created | analytics, achievements, dashboard WS |
| `games.session.finished` | emit | match decided/draw/abandoned | leaderboard refresh, achievements |
| `games.wager.requested` | emit | wager game starts | economy (debit) |
| `games.payout.requested` | emit | win resolved | economy (credit) |
| `economy.wager.confirmed` | consume | economy debited the user | unblock session start |
| `economy.wager.denied` | consume | insufficient funds | cancel/zero-wager session |
| `economy.payout.confirmed` | consume | credit applied | mark payout settled |

**Consumed-event handling**: `economy.wager.denied` for a pending session either (a) starts the match at wager `0n` if `allowZeroWagerFallback` is true, or (b) cancels the session and notifies the host. Correlation ids tie responses to the originating session; a configurable timeout treats silence as "economy absent" -> wager `0n`.

## 7. Dependencies

Relies **only** on CORE systems — never another module directly.

- **Event Bus** — emit `games.*`, consume `economy.*`. Sole channel to economy/achievements/notifications.
- **Cache layer** — hot session state (`games:session:<id>`), per-session move lock (`games:lock:<id>`), leaderboard snapshots (`games:lb:<guildId>:<gameKey>:<window>`). TTL + namespaced keys; module never touches Redis directly.
- **Permissions** — claim checks before start/admin actions (see §11).
- **Database (Prisma)** — only via this module's repositories.
- **Queue (BullMQ)** — `games.reaper` (expire stale sessions), `games.ai-turn` (AI + timed-out turns), retries + DLQ.
- **Config** — ENV -> Database -> Defaults, Zod-validated (see §8).
- **i18n** — `games` namespace, PT primary / EN secondary.
- **Logging/Tracing** — Pino + OpenTelemetry + Prometheus.

The economy module is an **optional, decoupled** collaborator: present => richer behavior; absent => games run at zero wager.

## 8. Configuration

Config priority ENV -> Database (guild override) -> Defaults, validated with Zod.

```typescript
// src/modules/games/config/games.config.ts
import { z } from 'zod';

export const gameToggleSchema = z.object({
  enabled: z.boolean().default(true),
  minWager: z.coerce.bigint().nonnegative().default(0n),
  maxWager: z.coerce.bigint().nonnegative().default(10_000n),
});

export const gamesConfigSchema = z.object({
  /** Master switch for the whole module in a guild. */
  enabled: z.boolean().default(true),

  /** Economy integration. When false, all wagers are forced to 0. */
  economyEnabled: z.boolean().default(true),
  allowZeroWagerFallback: z.boolean().default(true),
  economyResponseTimeoutMs: z.number().int().min(250).max(15_000).default(3_000),

  /** Session lifecycle. */
  sessionIdleTimeoutMs: z.number().int().min(10_000).max(3_600_000).default(180_000),
  turnTimeoutMs: z.number().int().min(5_000).max(600_000).default(60_000),
  maxConcurrentSessionsPerChannel: z.number().int().min(1).max(50).default(5),
  maxConcurrentSessionsPerUser: z.number().int().min(1).max(20).default(3),

  /** Per-game toggles + wager bounds. Missing keys inherit defaults. */
  perGame: z.record(z.string(), gameToggleSchema).default({}),

  /** Leaderboard windows exposed. */
  leaderboardWindows: z.array(z.enum(['all_time', 'monthly', 'weekly'])).default(['all_time', 'monthly', 'weekly']),

  /** RNG audit: persist seed for these games for dispute resolution. */
  auditRngFor: z.array(z.string()).default(['slots', 'roulette', 'blackjack', 'poker']),
});

export type GamesConfig = z.infer<typeof gamesConfigSchema>;
```

Defaults table:

| Setting | Default | Scope |
|---|---|---|
| `enabled` | `true` | guild |
| `economyEnabled` | `true` | guild |
| `allowZeroWagerFallback` | `true` | guild |
| `economyResponseTimeoutMs` | `3000` | guild/global |
| `sessionIdleTimeoutMs` | `180000` | guild |
| `turnTimeoutMs` | `60000` | guild |
| `maxConcurrentSessionsPerUser` | `3` | guild |
| `perGame.<key>.maxWager` | `10000` | guild |

## 9. Database

Prisma models added to the central `schema.prisma`. Soft-delete via `deletedAt` on long-lived rows; sessions are hard-pruned by the reaper after retention.

```prisma
enum GameSessionStatus {
  PENDING        // waiting for players / wager confirmation
  IN_PROGRESS
  FINISHED
  ABANDONED
  EXPIRED
  CANCELLED
}

enum LeaderboardWindow {
  ALL_TIME
  MONTHLY
  WEEKLY
}

model GameSession {
  id              String            @id @default(cuid())
  guildId         String
  channelId       String
  messageId       String?           // the rendered Discord message
  gameKey         String
  status          GameSessionStatus @default(PENDING)

  state           Json              // serialized TState (engine boundary owns the shape)
  rngSeed         String
  wager           BigInt            @default(0)
  currentTurnSlot Int?

  hostUserId      String
  winnerUserIds   Json              @default("[]")
  correlationId   String?           // pending economy request

  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
  lastMoveAt      DateTime          @default(now())
  finishedAt      DateTime?

  players         GameSessionPlayer[]
  moves           GameMove[]

  @@index([guildId, status])
  @@index([guildId, gameKey, status])
  @@index([channelId, status])
  @@index([lastMoveAt])               // reaper scan
  @@map("game_sessions")
}

model GameSessionPlayer {
  id          String      @id @default(cuid())
  sessionId   String
  session     GameSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  guildId     String
  userId      String?     // null for AI/dealer
  slot        Int
  kind        String      // 'human' | 'ai' | 'dealer'

  @@unique([sessionId, slot])
  @@index([guildId, userId])
  @@map("game_session_players")
}

model GameMove {
  id          String      @id @default(cuid())
  sessionId   String
  session     GameSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  slot        Int
  action      String      // raw decoded action e.g. 'cell:4'
  createdAt   DateTime    @default(now())

  @@index([sessionId, createdAt])
  @@map("game_moves")
}

model GameLeaderboardEntry {
  id          String            @id @default(cuid())
  guildId     String
  gameKey     String
  userId      String
  window      LeaderboardWindow
  periodKey   String            // 'all', '2026-06', '2026-W26'

  wins        Int               @default(0)
  losses      Int               @default(0)
  draws       Int               @default(0)
  played      Int               @default(0)
  netWinnings BigInt            @default(0)
  rating      Int               @default(1000) // Elo-style, used by chess/connect4

  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  @@unique([guildId, gameKey, userId, window, periodKey])
  @@index([guildId, gameKey, window, periodKey, wins])
  @@index([guildId, gameKey, window, periodKey, rating])
  @@map("game_leaderboard_entries")
}
```

Notes:
- `state` is `Json`; its typed shape is owned exclusively by each `Game` implementation and never crosses the public API as raw JSON.
- Composite leaderboard index supports `ORDER BY wins DESC` / `rating DESC` paginated reads per window+period.
- `lastMoveAt` index drives the reaper's stale-session scan.
- Soft-delete is unnecessary for sessions (transient); leaderboard rows are retained.

## 10. API

REST under `/api/guilds/:guildId/games`, Swagger-documented, guild-scoped, auth via dashboard JWT + permission checks. WS used for live session updates on the dashboard spectate view.

```typescript
// interaction/dto/start-game.dto.ts
export class StartGameDto {
  @IsEnum(GAME_KEYS) gameKey!: GameKey;
  @IsString() channelId!: string;
  @IsArray() @IsString({ each: true }) opponentUserIds!: string[];
  @IsString() @Matches(/^\d+$/) wager!: string;   // bigint as string
}

// interaction/dto/leaderboard-query.dto.ts
export class LeaderboardQueryDto {
  @IsEnum(['all_time', 'monthly', 'weekly']) window: LeaderboardWindow = 'all_time';
  @IsOptional() @IsString() periodKey?: string;
  @IsInt() @Min(1) @Max(100) limit = 25;
  @IsInt() @Min(0) cursor = 0;
}

export class SessionResponseDto {
  id!: string;
  gameKey!: GameKey;
  status!: GameSessionStatus;
  players!: { slot: number; userId: string | null; kind: PlayerKind }[];
  currentTurnSlot!: number | null;
  wager!: string;
  updatedAt!: string;
}
```

| Method | Path | Body / Query | Returns | Permission |
|---|---|---|---|---|
| GET | `/api/guilds/:guildId/games` | – | available games + config | `games.view` |
| GET | `/api/guilds/:guildId/games/sessions` | `?status&gameKey&limit&cursor` | paginated `SessionResponseDto[]` | `games.view` |
| GET | `/api/guilds/:guildId/games/sessions/:id` | – | `SessionResponseDto` | `games.view` |
| POST | `/api/guilds/:guildId/games/sessions` | `StartGameDto` | `SessionResponseDto` | `games.play` |
| DELETE | `/api/guilds/:guildId/games/sessions/:id` | – | `204` (admin force-end) | `games.manage` |
| GET | `/api/guilds/:guildId/games/:gameKey/leaderboard` | `LeaderboardQueryDto` | paginated entries | `games.view` |
| PATCH | `/api/guilds/:guildId/games/config` | partial `GamesConfig` | updated config | `games.config` |
| WS | `games:session:<id>` | – | live `SessionResponseDto` patches | `games.view` |

All list endpoints are cursor-paginated and cache-backed. Swagger groups under tag `Games`.

## 11. Permissions

Wildcard-friendly claims (groups/inheritance/Discord roles apply per `00-project.md`).

| Claim | Grants |
|---|---|
| `games.*` | everything below |
| `games.view` | view games, sessions, leaderboards (dashboard + commands) |
| `games.play` | start and play games (default: @everyone, guild-overridable) |
| `games.play.wager` | start games with a non-zero wager |
| `games.manage` | force-end / cancel any session in the guild |
| `games.config` | edit guild games config (toggles, wager bounds, timeouts) |
| `games.leaderboard.reset` | reset a leaderboard window/period |

Per-game gating: `games.play` is required for any game; specific high-stakes games (slots/roulette/poker/blackjack) additionally require `games.play.wager` when `wager > 0`. Checks run in the Application service before any state mutation.

## 12. Logging

Pino structured logs, category `games`, with audit hooks for moderation-relevant actions.

- **Lifecycle**: `games.session.start` / `games.session.finish` / `games.session.abandon` / `games.session.expire` — `{ guildId, sessionId, gameKey, players, wager, durationMs }`.
- **Moves**: debug-level `games.move` — `{ sessionId, slot, action, latencyMs }`.
- **RNG audit**: for `auditRngFor` games, log `{ sessionId, gameKey, rngSeed }` at start (info) so any outcome is reproducible for disputes.
- **Economy bridge**: `games.wager.request/confirm/deny`, `games.payout.request/confirm` with `correlationId`.
- **Errors**: categorized `GameError` (validation, illegal-move, not-your-turn, session-not-found, economy-timeout) — never leak internals to users; user sees an i18n message, logs hold the detail + traceId.
- **Audit hooks**: force-end (`games.manage`), config change (`games.config`), leaderboard reset emit to the central audit-log stream.
- **Metrics**: `games_sessions_started_total{gameKey}`, `games_sessions_finished_total{gameKey,outcome}`, `games_move_latency_ms` histogram, `games_active_sessions` gauge, `games_economy_timeout_total`.
- **Tracing**: spans `games.start`, `games.applyMove`, `games.render`, `games.economy.wager` with `sessionId`/`gameKey` attributes.

## 13. Testing

Vitest for unit/integration, Playwright for dashboard e2e. Strict-typed fixtures, no `any`.

- **Unit — game logic (highest priority)**: each `Game` implementation gets exhaustive `applyMove` tests:
  - TicTacToe/Connect4: win/draw/illegal-move/full-board detection.
  - Blackjack: hit/stand/bust/dealer-rules/blackjack-payout/split (if implemented).
  - Poker: hand evaluation ranking correctness (royal flush down to high card), betting rounds.
  - Slots/Roulette: payout tables match spec; outcomes reproducible from a fixed seed.
  - Wordle/Hangman/Guess Number: feedback correctness, attempt limits, win/lose.
  - Mines: reveal/flag, mine hit ends game, full safe reveal wins.
  - Chess: legal-move generation, check/checkmate/stalemate, no illegal-move acceptance.
  - Uno: card legality, draw/skip/reverse/wild effects, win on empty hand.
- **Determinism**: replay a logged seed + move list reproduces the exact final state for every audited game.
- **Unit — engine**: registry resolution, concurrency lock (no double-move), turn-timeout scheduling.
- **Integration**: full session lifecycle through service + repository + in-memory cache + fake Event Bus; economy present (confirmed/denied) and economy absent (timeout -> zero wager).
- **Component-id codec**: round-trip encode/decode, rejection of tampered/foreign customIds.
- **API**: DTO validation, pagination cursors, permission enforcement (403 without claim).
- **e2e (Playwright)**: dashboard lists sessions, opens a leaderboard, edits config; live WS spectate updates.
- **Coverage gate**: game logic files ≥ 95%, module overall ≥ 85%.

## 14. Dashboard Integration

- **Games overview**: grid of available games with per-game enabled toggle, wager bounds, play counts.
- **Active sessions**: live table (status, players, game, channel) with admin **force-end** action (`games.manage`).
- **Spectate view**: read-only live render of a session via WS (`games:session:<id>`), board + move log.
- **Leaderboards**: per-game, window switcher (all-time/monthly/weekly), paginated, user avatars, net winnings + rating columns.
- **Config editor**: form bound to `gamesConfigSchema` (toggles, timeouts, wager bounds, leaderboard windows) with inline Zod validation; saving calls `PATCH .../games/config`.
- **i18n**: all labels via `games` namespace; PT/EN switch respected.
- **Audit feed**: surfaces force-ends, config changes, leaderboard resets.

## 15. Future Extensions

- **Tournaments / brackets** with seeding and BullMQ-scheduled rounds.
- **Cross-guild ladders** (opt-in, global leaderboards) — respecting the global-vs-guild rule.
- **Stronger AI**: pluggable difficulty per game (minimax for Connect4/Chess, configurable depth).
- **Team games** (2v2 Uno, partnered modes).
- **Spectator betting** via the economy module (Event Bus) on in-progress matches.
- **Replay sharing**: shareable replay links rendered from move log + seed.
- **More games**: Battleship, Checkers, Minesweeper variants, Scrabble — each a new plug-in, zero engine changes.
- **Daily challenge** (shared Wordle word per guild per day) via a scheduled job.

## 16. Tasks for Claude

**Phase 1 — Schema & migration**
1. Add `GameSession`, `GameSessionPlayer`, `GameMove`, `GameLeaderboardEntry` models + enums to `schema.prisma`; create the Prisma migration. Add all indexes in §9.

**Phase 2 — Domain & engine core**
2. Implement `game.interface.ts` (Game, GameContext, GameView, intents), `session-state.ts`, `errors.ts`.
3. Implement `RngService` (seeded, auditable) and `GameRegistry`.

**Phase 3 — Repositories & infrastructure**
4. Implement `GameSessionRepository` and `LeaderboardRepository` (Repository Pattern, no Prisma outside them).
5. Implement `component-id.codec.ts` and `view-renderer.ts`.

**Phase 4 — Application services**
6. Implement `GameSessionService` (start/move/join/abandon, per-session cache lock, turn timeout scheduling).
7. Implement `EconomyBridgeService` (wager/payout via Event Bus, correlation + timeout fallback) and `LeaderboardService`.

**Phase 5 — Events**
8. Wire emitted `games.*` events and consumed `economy.*` handlers; Zod-validate payloads at the bus boundary.

**Phase 6 — Game plug-ins**
9. Implement the games in this order, each fully unit-tested before the next: TicTacToe, Connect4, Guess Number, Hangman, Wordle, Mines, Slots, Roulette, Blackjack, Trivia, Uno, Poker, Chess.

**Phase 7 — Commands**
10. Implement `GamesController`: `/game play <game> [opponent] [wager]`, `/game stats [user]`, `/game leaderboard <game> [window]`, plus button/select component handlers.

**Phase 8 — Dashboard & API**
11. Implement `games.api.controller.ts` + DTOs + WS spectate; wire dashboard overview, sessions, leaderboards, config editor.

**Phase 9 — Jobs**
12. Implement `session-reaper.processor.ts` and `ai-turn.processor.ts` (BullMQ, retries, DLQ).

**Phase 10 — Tests & docs**
13. Complete unit/integration/e2e per §13; ensure coverage gates; write `games` i18n PT+EN; finalize docs.

## 17. Acceptance Criteria

- [ ] All 13 games are playable end-to-end via slash command + buttons/selects; each enforces legal moves and correct win/draw detection.
- [ ] A new game can be added by implementing `Game<TState,TMove>` and registering it — **zero** engine-core changes required.
- [ ] Sessions persist in MySQL and survive a bot restart; the reaper expires idle sessions per `sessionIdleTimeoutMs`.
- [ ] Rapid double button-clicks never apply two moves (per-session lock holds).
- [ ] With economy present, a wager debits before start and a win credits the payout; with economy absent or denied, the game runs at wager `0n` (when `allowZeroWagerFallback`).
- [ ] Audited games (slots/roulette/blackjack/poker) log a seed; replaying seed + moves reproduces the exact result.
- [ ] Leaderboards are correct per window (all-time/monthly/weekly) and paginated.
- [ ] Permissions enforced: no `games.play` -> cannot start; no `games.play.wager` -> cannot wager; no `games.manage` -> cannot force-end.
- [ ] All user-facing strings resolve in PT and EN.
- [ ] No module imports another module's internals; economy reached only via Event Bus.

## 18. Definition of Done

- [ ] Prisma migration created and applied; schema matches §9.
- [ ] No `any`; TypeScript strict passes. ESLint + Prettier clean; Husky/Commitlint satisfied.
- [ ] Unit coverage ≥ 95% on game-logic files, ≥ 85% module overall; integration + e2e green in CI (GitHub Actions).
- [ ] Swagger/OpenAPI documents all REST endpoints under tag `Games`.
- [ ] Prometheus metrics + OpenTelemetry spans emitted; Pino logs categorized with audit hooks.
- [ ] i18n `games` namespace complete (PT primary, EN secondary).
- [ ] Dashboard overview, sessions, spectate, leaderboards, and config editor functional.
- [ ] Conventional Commits on a `feature/games` branch; PR opened to `develop` (never direct to `main`); CI passing; this doc updated.
