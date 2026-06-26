# Economy Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations for every schema change. Generate tests and docs alongside code.
> - Generate DTOs for every endpoint. Use the Repository Pattern (only repositories touch Prisma). Use the Event Bus for cross-module communication. Use Dependency Injection everywhere.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Money is ALWAYS a signed integer (smallest currency unit / "cents"). Never use floats, never use `number` for balances in persistence — use `BigInt`/`bigint`. All money math goes through the `MoneyService` helper.
> - Every mutation of a balance MUST be written through the transaction ledger in the SAME database transaction. No silent balance edits.
> - Create indexes for searchable fields. Support pagination, caching, translations (PT primary, EN secondary), and dashboard integration.
> - Everything is guild-scoped unless a setting is explicitly marked global.

---

## 1. Purpose

The Economy Module is the **canonical source of truth for virtual currency** inside Ghost Bot. It owns balances, the item registry, the inventory system, the shop, trading, leaderboards, and an **audit-grade transaction ledger**. It exposes a stable **public contract** (`EconomyPublicApi`) and a set of **Event Bus** events so that other modules — most notably the Games module (gambling, mini-games), Tickets (paid priority), and FiveM (in-game purchases) — can debit, credit, and reserve funds **without ever touching the economy's internal services or Prisma models directly**.

Core problems it solves:

- A single, consistent, **integer-only** money model that cannot drift, double-spend, or go silently negative.
- A tamper-evident ledger where every credit/debit is reconstructable and reconcilable.
- A safe **reservation/escrow** primitive so games can lock a wager, resolve, then settle — atomically.
- Guild-scoped configuration (currency name, symbol, daily amounts, interest rate) with the standard `ENV -> Database -> Defaults` priority.

## 2. Goals

- **Integrity first.** Balance = `wallet + bank`. Every change is double-entry against the ledger. The sum of ledger deltas for an account always equals its current balance (reconciliation invariant).
- **No floats, ever.** All amounts are `bigint` in TS and `BigInt` (`@db.BigInt`) in Prisma. Display formatting happens only at the i18n/presentation edge.
- **Idempotent operations.** Every external mutation accepts an `idempotencyKey`; replays return the original result instead of duplicating.
- **Concurrency-safe.** Debits use row-level locking / atomic conditional updates so two simultaneous spends cannot overdraw.
- **Pluggable for games.** Reserve -> settle (win/lose/refund) lifecycle exposed via the public API and events.
- **Guild-aware & i18n.** Currency naming, command output, and shop content are translatable and per-guild.
- **Observable.** Counters, histograms, audit logs, OpenTelemetry spans on every money mutation.

## 3. Architecture

The module obeys the strict layer flow from the contract:

```
Slash Command (Necord)  ─┐
REST Controller (Nest)  ─┼─> Application Service ─> Domain Service ─> Repository ─> Prisma/MySQL
Public API facade       ─┘            │
                                       └─> Cache layer (memory + Redis)
                                       └─> Event Bus (emit/consume)
                                       └─> Queue (BullMQ: interest, payouts, decay)
```

Key building blocks:

- **`MoneyService`** (domain, pure): bigint arithmetic, overflow guards, formatting helpers. No I/O.
- **`AccountService`** (application): wallet/bank operations, deposit/withdraw, transfer.
- **`LedgerService`** (domain/application): the ONLY writer of ledger rows; all mutations funnel here.
- **`ReservationService`** (application): escrow lifecycle for games — `reserve`, `commit`, `release`.
- **`ItemRegistryService`** + **`InventoryService`**: item catalogue and per-user holdings.
- **`ShopService`** / **`TradeService`** / **`LeaderboardService`**: feature services.
- **`InterestProcessor`** (job): periodic bank interest accrual.
- **`EconomyPublicApi`** (facade, the published contract): the ONLY thing other modules consume.

CQRS is applied **only** to leaderboards (read-heavy, cache-projected) and ledger queries (read model separated from write path). Everything else is plain service methods.

All write paths that change money run inside a single Prisma `$transaction` so the balance mutation and its ledger entry are atomic.

## 4. Folder Structure

```
src/modules/economy/
├── economy.module.ts
├── public/
│   ├── economy.public-api.ts          # EconomyPublicApi facade (exported)
│   ├── economy.contract.ts            # interfaces + DTO types other modules import
│   └── economy.tokens.ts              # DI injection tokens
├── application/
│   ├── account.service.ts
│   ├── ledger.service.ts
│   ├── reservation.service.ts
│   ├── shop.service.ts
│   ├── trade.service.ts
│   ├── leaderboard.service.ts
│   ├── inventory.service.ts
│   └── item-registry.service.ts
├── domain/
│   ├── money.service.ts               # pure bigint helpers
│   ├── money.vo.ts                    # Money value object
│   ├── account.entity.ts
│   ├── transaction-type.enum.ts
│   ├── reservation-state.enum.ts
│   └── errors/
│       ├── insufficient-funds.error.ts
│       ├── account-locked.error.ts
│       └── invalid-amount.error.ts
├── infrastructure/
│   ├── repositories/
│   │   ├── account.repository.ts
│   │   ├── ledger.repository.ts
│   │   ├── reservation.repository.ts
│   │   ├── item.repository.ts
│   │   ├── inventory.repository.ts
│   │   ├── shop.repository.ts
│   │   └── trade.repository.ts
│   └── prisma/economy.prisma          # schema fragment (merged into root schema)
├── presentation/
│   ├── commands/
│   │   ├── balance.command.ts
│   │   ├── daily.command.ts
│   │   ├── work.command.ts
│   │   ├── crime.command.ts
│   │   ├── rob.command.ts
│   │   ├── bank.command.ts            # deposit/withdraw
│   │   ├── pay.command.ts
│   │   ├── shop.command.ts
│   │   ├── inventory.command.ts
│   │   ├── trade.command.ts
│   │   └── leaderboard.command.ts
│   └── api/
│       ├── economy.controller.ts
│       ├── shop.controller.ts
│       └── dto/
│           ├── balance.dto.ts
│           ├── transfer.dto.ts
│           ├── ledger-query.dto.ts
│           ├── shop-item.dto.ts
│           └── leaderboard.dto.ts
├── jobs/
│   ├── interest.processor.ts
│   └── cooldown.config.ts
├── config/
│   └── economy.config.ts              # Zod schema + defaults
└── i18n/
    ├── pt/economy.json
    └── en/economy.json
```

## 5. Public Interfaces

These are the **strict** interfaces other modules and the rest of the app rely on. Other modules import ONLY from `public/economy.contract.ts` and use the `ECONOMY_PUBLIC_API` token.

```typescript
// public/economy.contract.ts
export type Money = bigint; // smallest currency unit, signed integer

export type AccountScope = 'WALLET' | 'BANK';

export interface BalanceSnapshot {
  readonly guildId: string;
  readonly userId: string;
  readonly wallet: Money;
  readonly bank: Money;
  readonly total: Money; // wallet + bank
  readonly updatedAt: Date;
}

export interface CreditRequest {
  readonly guildId: string;
  readonly userId: string;
  readonly amount: Money;            // must be > 0n
  readonly reason: TransactionType;
  readonly scope?: AccountScope;     // default 'WALLET'
  readonly idempotencyKey: string;   // dedupes replays
  readonly sourceModule: string;     // e.g. 'games', 'tickets'
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface DebitRequest extends CreditRequest {
  readonly allowOverdraft?: false;   // overdraft is never allowed for external callers
}

export interface TransferRequest {
  readonly guildId: string;
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly sourceModule: string;
}

export type ReservationId = string;

export interface ReservationResult {
  readonly reservationId: ReservationId;
  readonly amount: Money;
  readonly expiresAt: Date;
}

export interface SettlementResult {
  readonly reservationId: ReservationId;
  readonly outcome: 'COMMIT' | 'RELEASE';
  readonly payout: Money;            // amount credited back/awarded
  readonly balance: BalanceSnapshot;
}

/**
 * The ONLY surface other modules may use. No internal services leak out.
 */
export interface EconomyPublicApi {
  getBalance(guildId: string, userId: string): Promise<BalanceSnapshot>;
  credit(req: CreditRequest): Promise<BalanceSnapshot>;
  debit(req: DebitRequest): Promise<BalanceSnapshot>;
  transfer(req: TransferRequest): Promise<{ from: BalanceSnapshot; to: BalanceSnapshot }>;

  /** Games escrow lifecycle: lock funds, then commit (award) or release (refund). */
  reserve(req: DebitRequest): Promise<ReservationResult>;
  commitReservation(
    reservationId: ReservationId,
    payout: Money,
    idempotencyKey: string,
  ): Promise<SettlementResult>;
  releaseReservation(
    reservationId: ReservationId,
    idempotencyKey: string,
  ): Promise<SettlementResult>;

  /** Inventory hooks for game rewards / item drops. */
  grantItem(guildId: string, userId: string, itemKey: string, qty: number): Promise<void>;
  hasItem(guildId: string, userId: string, itemKey: string, qty?: number): Promise<boolean>;
}
```

```typescript
// domain/money.service.ts — pure, no I/O, no `any`
export class MoneyService {
  static readonly ZERO: bigint = 0n;
  // MySQL BIGINT signed max
  static readonly MAX: bigint = 9_223_372_036_854_775_807n;

  static assertValidAmount(amount: bigint): void {
    if (amount <= 0n) throw new InvalidAmountError(amount, 'must be positive');
    if (amount > MoneyService.MAX) throw new InvalidAmountError(amount, 'exceeds max');
  }

  static add(a: bigint, b: bigint): bigint {
    const r = a + b;
    if (r > MoneyService.MAX) throw new InvalidAmountError(r, 'overflow');
    return r;
  }

  static subtract(a: bigint, b: bigint): bigint {
    return a - b; // callers check sign explicitly
  }

  static percentage(amount: bigint, basisPoints: number): bigint {
    // basisPoints: 250 = 2.50%. Integer math only, floor.
    return (amount * BigInt(basisPoints)) / 10_000n;
  }

  /** Format for display only, at the i18n edge. */
  static format(amount: bigint, symbol: string): string {
    return `${amount.toString()} ${symbol}`;
  }
}
```

```typescript
// infrastructure/repositories/account.repository.ts (interface)
export interface IAccountRepository {
  findOrCreate(tx: PrismaTx, guildId: string, userId: string): Promise<AccountRow>;
  /** Atomic conditional debit; returns false if it would overdraw. */
  tryDebitWallet(tx: PrismaTx, accountId: string, amount: bigint): Promise<boolean>;
  creditWallet(tx: PrismaTx, accountId: string, amount: bigint): Promise<AccountRow>;
  moveWalletToBank(tx: PrismaTx, accountId: string, amount: bigint): Promise<boolean>;
  moveBankToWallet(tx: PrismaTx, accountId: string, amount: bigint): Promise<boolean>;
  topByTotal(guildId: string, limit: number, cursor?: string): Promise<AccountRow[]>;
}
```

## 6. Events

All events are published on the central Event Bus with the namespace `economy.*`. Payloads are strict types from the contract. Other modules consume these instead of polling.

**Emitted:**

```typescript
export interface EconomyEventMap {
  'economy.balance.changed': {
    guildId: string; userId: string;
    delta: bigint; scope: AccountScope;
    reason: TransactionType; balance: BalanceSnapshot;
    ledgerId: string;
  };
  'economy.transaction.recorded': {
    ledgerId: string; guildId: string; userId: string;
    type: TransactionType; amount: bigint; sourceModule: string;
  };
  'economy.reservation.created': { reservationId: string; guildId: string; userId: string; amount: bigint };
  'economy.reservation.settled': { reservationId: string; outcome: 'COMMIT' | 'RELEASE'; payout: bigint };
  'economy.item.granted': { guildId: string; userId: string; itemKey: string; qty: number };
  'economy.item.consumed': { guildId: string; userId: string; itemKey: string; qty: number };
  'economy.shop.purchased': { guildId: string; userId: string; itemKey: string; qty: number; cost: bigint };
  'economy.trade.completed': { guildId: string; tradeId: string; partyA: string; partyB: string };
}
```

**Consumed:**

- `member.left` (from a guild-member module) -> optionally freeze/soft-delete the account (config-gated, default keep).
- `guild.created` -> seed default economy config and base shop items.
- `games.payout.requested` (from Games module) -> handled via the public API `credit`/`commitReservation`, not a direct event listener where possible; the event path exists as a fallback for fire-and-forget rewards.

## 7. Dependencies

Relies **only** on CORE systems — never on another module's internals:

| Core system | Usage |
|-------------|-------|
| **Database** (Prisma/MySQL) | Accounts, ledger, items, inventory, shop, trades, reservations. Repository layer only. |
| **Cache** (memory + Redis) | Balance snapshots (`economy:bal:{guild}:{user}`, short TTL), leaderboard projections, item registry, idempotency keys. Goes through the Cache layer — never touches Redis directly. |
| **Event Bus** | Emits `economy.*`; consumes lifecycle events. Sole cross-module channel besides the public API. |
| **Permissions** | Wildcard claim checks (`economy.*`) for admin/mod commands and dashboard. |
| **Queue** (BullMQ) | `economy:interest` (recurring), `economy:reservation-expiry` (delayed), `economy:cooldown-reset`. Retries + DLQ. |
| **Config** | Zod-validated guild + global settings, `ENV -> DB -> Defaults`. |
| **i18n** | Command output, shop descriptions, error messages (PT/EN + namespaces). |
| **Logger** (Pino) | Structured logs + audit category. |

## 8. Configuration

Guild-scoped unless marked **(global)**. Validated with Zod; resolved `ENV -> Database -> Defaults`.

```typescript
// config/economy.config.ts
import { z } from 'zod';

export const economyConfigSchema = z.object({
  currencyName: z.string().min(1).max(32).default('Coins'),
  currencySymbol: z.string().min(1).max(8).default('🪙'),

  daily: z.object({
    amount: z.coerce.bigint().positive().default(500n),
    streakBonus: z.coerce.bigint().nonnegative().default(50n), // per consecutive day
    streakCap: z.number().int().positive().default(7),
    cooldownHours: z.number().int().positive().default(24),
  }).default({}),

  work: z.object({
    min: z.coerce.bigint().positive().default(100n),
    max: z.coerce.bigint().positive().default(400n),
    cooldownMinutes: z.number().int().positive().default(60),
  }).default({}),

  crime: z.object({
    min: z.coerce.bigint().positive().default(200n),
    max: z.coerce.bigint().positive().default(800n),
    successRate: z.number().min(0).max(1).default(0.55),
    fineMin: z.coerce.bigint().nonnegative().default(100n),
    fineMax: z.coerce.bigint().nonnegative().default(500n),
    cooldownMinutes: z.number().int().positive().default(120),
  }).default({}),

  rob: z.object({
    successRate: z.number().min(0).max(1).default(0.4),
    maxStealBasisPoints: z.number().int().min(0).max(10_000).default(2_000), // 20% of victim wallet
    minVictimWallet: z.coerce.bigint().nonnegative().default(500n),
    failPenalty: z.coerce.bigint().nonnegative().default(300n),
    cooldownMinutes: z.number().int().positive().default(180),
  }).default({}),

  bank: z.object({
    interestBasisPoints: z.number().int().min(0).max(10_000).default(50), // 0.5% per accrual
    interestIntervalHours: z.number().int().positive().default(24),
    maxBalance: z.coerce.bigint().positive().default(MoneyService.MAX),
  }).default({}),

  trade: z.object({
    enabled: z.boolean().default(true),
    expirySeconds: z.number().int().positive().default(300),
    taxBasisPoints: z.number().int().min(0).max(10_000).default(0),
  }).default({}),

  reservationTtlSeconds: z.number().int().positive().default(120),
  wipeAccountOnLeave: z.boolean().default(false),

  // (global) hard ceiling enforced regardless of guild settings
  globalMaxTransaction: z.coerce.bigint().positive().default(1_000_000_000n),
});

export type EconomyConfig = z.infer<typeof economyConfigSchema>;
```

## 9. Database

Prisma models added to the root schema. Money fields are `BigInt`. Soft-delete via `deletedAt` where shown. All tables carry `guildId` for multi-guild scoping and are indexed accordingly.

```prisma
model EconomyAccount {
  id        String   @id @default(cuid())
  guildId   String
  userId    String
  wallet    BigInt   @default(0)
  bank      BigInt   @default(0)
  frozen    Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  ledger      EconomyLedger[]
  inventory   InventoryItem[]
  reservations EconomyReservation[]

  @@unique([guildId, userId])
  @@index([guildId, wallet])
  @@index([guildId, bank])
  @@index([guildId, deletedAt])
}

enum TransactionType {
  DAILY
  WORK
  CRIME
  ROB
  PAY_OUT
  PAY_IN
  DEPOSIT
  WITHDRAW
  INTEREST
  SHOP_PURCHASE
  SHOP_SALE
  TRADE
  GAME_WAGER
  GAME_PAYOUT
  GAME_REFUND
  ADMIN_ADJUST
  RESERVATION_HOLD
  RESERVATION_RELEASE
}

model EconomyLedger {
  id            String          @id @default(cuid())
  guildId       String
  accountId     String
  account       EconomyAccount  @relation(fields: [accountId], references: [id])
  type          TransactionType
  scope         String          // 'WALLET' | 'BANK'
  amount        BigInt          // signed delta applied to scope
  balanceAfter  BigInt          // scope balance after this entry (reconciliation)
  sourceModule  String          @default("economy")
  idempotencyKey String         @unique
  counterpartyId String?        // other user for transfers/trades
  metadata      Json?
  createdAt     DateTime        @default(now())

  @@index([guildId, accountId, createdAt])
  @@index([guildId, type, createdAt])
  @@index([sourceModule, createdAt])
}

model EconomyReservation {
  id           String          @id @default(cuid())
  guildId      String
  accountId    String
  account      EconomyAccount  @relation(fields: [accountId], references: [id])
  amount       BigInt
  state        ReservationState @default(HELD)
  sourceModule String
  idempotencyKey String        @unique
  expiresAt    DateTime
  createdAt    DateTime        @default(now())
  settledAt    DateTime?

  @@index([guildId, state, expiresAt])
}

enum ReservationState {
  HELD
  COMMITTED
  RELEASED
  EXPIRED
}

model EconomyItem {
  id          String   @id @default(cuid())
  guildId     String
  key         String   // unique per guild, stable identifier
  name        String
  description String?
  emoji       String?
  type        String   // 'CONSUMABLE' | 'COLLECTIBLE' | 'ROLE_GRANT' | 'TOOL'
  price       BigInt?  // null = not directly purchasable
  sellPrice   BigInt?  // null = not sellable
  stock       Int?     // null = unlimited
  tradable    Boolean  @default(true)
  usable      Boolean  @default(false)
  roleId      String?  // for ROLE_GRANT
  metadata    Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  inventory   InventoryItem[]

  @@unique([guildId, key])
  @@index([guildId, type])
  @@index([guildId, deletedAt])
}

model InventoryItem {
  id        String         @id @default(cuid())
  guildId   String
  accountId String
  account   EconomyAccount @relation(fields: [accountId], references: [id])
  itemId    String
  item      EconomyItem    @relation(fields: [itemId], references: [id])
  quantity  Int            @default(0)
  acquiredAt DateTime      @default(now())
  updatedAt DateTime       @updatedAt

  @@unique([accountId, itemId])
  @@index([guildId, accountId])
}

model EconomyTrade {
  id        String   @id @default(cuid())
  guildId   String
  partyAId  String
  partyBId  String
  state     String   @default("PENDING") // PENDING | ACCEPTED | CANCELLED | EXPIRED | COMPLETED
  offerA    Json     // { money: string, items: {itemKey, qty}[] }
  offerB    Json
  expiresAt DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([guildId, state])
  @@index([guildId, partyAId])
  @@index([guildId, partyBId])
}

model EconomyCooldown {
  id        String   @id @default(cuid())
  guildId   String
  userId    String
  action    String   // 'daily' | 'work' | 'crime' | 'rob'
  expiresAt DateTime
  streak    Int      @default(0) // for daily streaks

  @@unique([guildId, userId, action])
  @@index([guildId, action, expiresAt])
}
```

**Soft-delete notes:** `EconomyAccount` and `EconomyItem` use `deletedAt`. The **ledger is append-only and never soft-deleted** — it is the audit trail. Account "wipe" sets `deletedAt` + zeroes balances via an `ADMIN_ADJUST` ledger entry, never a hard delete.

**Reconciliation invariant:** for each account scope, `SUM(ledger.amount WHERE scope) == account.<scope>`. A nightly job verifies this and alerts on drift.

## 10. API

REST under `/api/v1/guilds/:guildId/economy`. All endpoints require auth + permission claims. DTOs are Zod-derived and Swagger-documented. Money is serialized as a **string** in JSON (never a JS `number`) to avoid precision loss.

```typescript
// presentation/api/dto/transfer.dto.ts
export class TransferDto {
  @ApiProperty() fromUserId!: string;
  @ApiProperty() toUserId!: string;
  @ApiProperty({ type: String, description: 'Integer amount as string' })
  amount!: string; // parsed to bigint, validated > 0
  @ApiProperty() idempotencyKey!: string;
}

export class BalanceResponseDto {
  @ApiProperty() userId!: string;
  @ApiProperty({ type: String }) wallet!: string;
  @ApiProperty({ type: String }) bank!: string;
  @ApiProperty({ type: String }) total!: string;
  @ApiProperty() updatedAt!: string;
}
```

| Method | Path | Body / Query | Permission | Notes |
|--------|------|--------------|------------|-------|
| GET | `/balance/:userId` | — | `economy.balance.read` | Returns `BalanceResponseDto` (cached). |
| GET | `/ledger` | `?userId&type&cursor&limit` | `economy.ledger.read` | Paginated, cursor-based. |
| POST | `/transfer` | `TransferDto` | `economy.transfer` | Admin/dashboard transfer. |
| POST | `/adjust` | `{ userId, amount, reason }` | `economy.admin.adjust` | Signed delta, `ADMIN_ADJUST` ledger. |
| GET | `/leaderboard` | `?scope=total\|wallet\|bank&limit` | `economy.leaderboard.read` | Cached projection. |
| GET | `/shop` | `?type&cursor&limit` | `economy.shop.read` | Item list. |
| POST | `/shop/items` | `ShopItemDto` | `economy.shop.manage` | Create/update item. |
| DELETE | `/shop/items/:key` | — | `economy.shop.manage` | Soft-delete item. |
| GET | `/inventory/:userId` | `?cursor&limit` | `economy.inventory.read` | Paginated holdings. |
| GET | `/config` | — | `economy.config.read` | Resolved config. |
| PATCH | `/config` | partial `EconomyConfig` | `economy.config.manage` | Zod-validated. |

WS: the dashboard subscribes to `economy.balance.changed` and `economy.shop.purchased` over the existing realtime gateway for live updates (no new socket server).

## 11. Permissions

Wildcard-capable claims defined by this module (consumed by the core Permissions system):

```
economy.*                  # full economy admin
economy.balance.read
economy.balance.read.self  # implicit for members
economy.ledger.read
economy.transfer
economy.admin.adjust       # mint/burn, sensitive
economy.shop.read
economy.shop.manage
economy.shop.buy
economy.inventory.read
economy.inventory.manage
economy.trade.use
economy.leaderboard.read
economy.config.read
economy.config.manage
```

Member-facing commands (`/daily`, `/work`, `/balance`, `/shop buy`) require only the implicit self/use claims; destructive or cross-user ones (`/economy adjust`, shop management, config) require the explicit admin claims. Claims support groups, inheritance, and Discord-role mapping per the contract.

## 12. Logging

- **Categories:** `economy.tx` (every ledger write), `economy.audit` (admin adjust, config change, item create/delete, account wipe), `economy.cmd` (slash invocations), `economy.job` (interest/expiry processors), `economy.security` (overdraft attempts, rob/crime abuse, idempotency replays).
- Every money mutation logs: `guildId`, `userId`, `type`, `amount` (string), `balanceAfter`, `sourceModule`, `idempotencyKey`, `ledgerId`, `traceId`.
- **Audit hooks:** `economy.admin.adjust`, `economy.config.manage`, `economy.shop.manage`, account freeze/wipe emit a structured audit record consumed by the central audit log module via the Event Bus.
- **OpenTelemetry:** spans `economy.credit`, `economy.debit`, `economy.transfer`, `economy.reservation.commit` with attributes for amount/type; **never log raw user PII**; amounts are not secrets but balances are logged at `debug`/audit only.
- **Metrics (Prometheus):** `economy_transactions_total{type}`, `economy_balance_changed_total`, `economy_overdraft_rejected_total`, `economy_reservation_expired_total`, `economy_interest_paid_total`, histogram `economy_tx_duration_seconds`.

## 13. Testing

- **Unit (Vitest):**
  - `MoneyService`: add/subtract/percentage/overflow/format, negative & boundary (`MAX`) cases.
  - `AccountService`: deposit/withdraw edge cases, overdraft rejection, frozen account.
  - `LedgerService`: ledger row always written, `balanceAfter` correct, idempotency replay returns original.
  - `ReservationService`: reserve -> commit, reserve -> release, double-settle rejected, expiry.
  - Cooldown logic for daily streaks, work, crime, rob; success/fail probability paths (seeded RNG).
- **Integration:** repositories against a real MySQL (testcontainers/docker), transaction atomicity (debit + ledger commit/rollback together), concurrency test that two parallel debits cannot overdraw.
- **Reconciliation test:** after a randomized sequence of ops, `SUM(ledger) == balance` for every account.
- **e2e (Playwright + bot harness):** `/daily`, `/work`, `/pay`, `/shop buy`, `/trade` full flows; REST `transfer`/`adjust` with auth + permissions; dashboard balance live update.
- **Contract test:** a fake "games" module exercises only `EconomyPublicApi` (reserve/commit/release) to prove no internal coupling.
- Coverage target: >=90% on `domain/` and `application/`, 100% on `MoneyService`.

## 14. Dashboard Integration

- **Economy overview:** total currency in circulation, top holders, transaction volume chart (from `economy.tx` metrics).
- **Member detail:** balance (wallet/bank), inventory, paginated ledger with type filter, admin **adjust** action (gated by `economy.admin.adjust`).
- **Shop manager:** CRUD for items (`economy.shop.manage`), stock, prices, role-grant config.
- **Config editor:** form bound to `EconomyConfig` Zod schema; live validation; per-guild.
- **Leaderboard widget:** cached, scope toggle (total/wallet/bank).
- **Live updates:** subscribes to `economy.balance.changed` / `economy.shop.purchased` over the realtime gateway.

## 15. Future Extensions

- Multi-currency per guild (e.g. event tokens) reusing the same ledger with a `currencyId` column.
- Cross-guild global economy (opt-in) behind the existing global flag.
- Marketplace / auction house building on `EconomyTrade`.
- Loans & overdraft accounts with interest (lending sub-ledger).
- Crafting system on top of items + consumables.
- Webhook outbox for external (e.g. FiveM in-game) balance sync.
- Anti-fraud ML scoring on ledger patterns.

## 16. Tasks for Claude

**Phase 1 — Schema & migrations.** Add the Prisma models in §9 to the root schema; create the migration; generate the client. Add `TransactionType`/`ReservationState` enums.

**Phase 2 — Domain.** Implement `MoneyService` (pure, fully unit-tested), `Money` VO, entities, error classes.

**Phase 3 — Repositories.** Implement all repositories with the `IAccountRepository` etc. interfaces. `tryDebitWallet` MUST use an atomic conditional update (`WHERE wallet >= amount`).

**Phase 4 — Application services.** `LedgerService` (sole ledger writer), `AccountService`, `ReservationService`, `InventoryService`, `ItemRegistryService`, `ShopService`, `TradeService`, `LeaderboardService`. Every mutation goes through a single Prisma `$transaction` with the ledger write. Wire idempotency via the Cache layer + unique `idempotencyKey`.

**Phase 5 — Events.** Emit the `economy.*` events; subscribe to `guild.created` / `member.left`.

**Phase 6 — Commands.** Implement all slash commands (§ below). i18n PT/EN. Permission checks.

**Phase 7 — Dashboard.** Expose overview, member detail, shop manager, config editor, leaderboard; realtime subscriptions.

**Phase 8 — API.** Controllers + DTOs + Swagger; money serialized as strings.

**Phase 9 — Jobs.** `InterestProcessor` (recurring), reservation-expiry (delayed), cooldown-reset; BullMQ retries + DLQ.

**Phase 10 — Tests.** Unit, integration, reconciliation, e2e, contract test.

**Phase 11 — Docs.** Update module README, public-contract docs, and changelog.

Slash commands to implement:

```
/balance [user]
/daily
/work
/crime
/rob <user>
/bank deposit <amount>
/bank withdraw <amount>
/pay <user> <amount>
/shop list [type]
/shop buy <item> [qty]
/shop sell <item> [qty]
/inventory [user]
/use <item>
/trade <user>
/leaderboard [scope]
/economy adjust <user> <amount> [reason]   (admin)
```

## 17. Acceptance Criteria

- [ ] All money is `bigint`/`BigInt`; no `number` or float touches a balance anywhere; lint rule forbids `any`.
- [ ] Every balance change has exactly one ledger row in the SAME transaction; rollback leaves both untouched.
- [ ] `SUM(ledger.amount per scope) == account scope balance` holds after randomized op sequences.
- [ ] External `debit` can never produce a negative wallet; concurrent debits cannot overdraw.
- [ ] `idempotencyKey` replays return the original result and create no duplicate ledger row.
- [ ] `reserve -> commit` and `reserve -> release` settle exactly once; expired reservations auto-release via the queue.
- [ ] Other modules use ONLY `EconomyPublicApi`; no import of internal economy services anywhere in the repo.
- [ ] `/daily` enforces cooldown + streaks; `/work`/`/crime`/`/rob` respect cooldowns and success rates.
- [ ] Shop buy/sell, inventory, and trade flows work end-to-end with correct ledger + item moves.
- [ ] Config is per-guild, Zod-validated, `ENV -> DB -> Defaults`; currency name/symbol reflected in output.
- [ ] All commands localized PT + EN; money serialized as strings over REST.
- [ ] Permission claims enforced on every privileged command/endpoint.

## 18. Definition of Done

- [ ] All Vitest unit/integration tests pass; coverage targets met (100% `MoneyService`, >=90% domain/application).
- [ ] Playwright e2e + contract test green in CI.
- [ ] Prisma migration created, reviewed, and applied cleanly; client regenerated.
- [ ] ESLint/Prettier clean; Commitlint-compliant Conventional Commits; Husky hooks pass.
- [ ] Swagger/OpenAPI updated; public contract documented.
- [ ] i18n PT + EN namespaces complete.
- [ ] Metrics + OTel spans + audit hooks emitting and visible in Grafana.
- [ ] Docs (this file + README + changelog) updated.
- [ ] PR opened against `develop` from `feature/economy`; no direct commits to `main`; reviewed and approved.
