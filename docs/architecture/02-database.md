# Database

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - This document defines the **persistence layer contract** for the entire platform. Treat the base classes, naming rules, and soft-delete strategy here as binding for every module.
> - Keep backwards compatibility. Always create Prisma migrations (`prisma migrate dev --name <conventional-name>`). Never hand-edit applied migration SQL.
> - Only Repositories touch Prisma. Controllers and Application Services NEVER import `PrismaService` or `PrismaClient`.
> - No `any`. Use generics on `BaseRepository<TModel, TDelegate>`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Every guild-scoped table MUST carry `guildId` and index it. Every searchable field MUST be indexed. Support pagination, caching, translations, dashboard.
> - Soft-delete by default via `deletedAt`. Hard delete only behind an explicit `force` flag and an audit log entry.
> - Use the Repository Pattern, the Event Bus, and Dependency Injection. Generate DTOs and tests for every repository.

---

## 1. Purpose

This document specifies the **shared database layer** of Ghost Bot: the single `PrismaService`, the generic `BaseRepository<TModel, TDelegate>`, transaction helpers, the soft-delete strategy, multi-guild scoping rules, naming/indexing conventions, the migration workflow, and seeders.

It is the foundation every feature module builds on. Modules never talk to MySQL or `PrismaClient` directly — they declare a module-local repository that extends `BaseRepository`, which in turn depends only on the shared `PrismaService`. This keeps the strict layer flow intact:

```
Controller -> Application Service -> Domain Service (opt) -> Repository -> PrismaService -> MySQL
```

The deliverable of this doc is the `database` core system under `src/database` plus the base Prisma schema (`Guild`, `GuildConfig`, `User`, `GuildMember`) that all other models relate to.

## 2. Goals

- **One Prisma client** for the whole process, lifecycle-managed by NestJS (`onModuleInit` / `onModuleDestroy`).
- **Generic, type-safe repositories** — no `any`, no raw `PrismaClient` leakage above the repository boundary.
- **Soft-delete everywhere** by convention (`deletedAt: DateTime?`), with helpers that transparently exclude soft-deleted rows.
- **Guild isolation** — every guild-scoped query is scoped by `guildId`; cross-guild leakage is impossible by default.
- **Interactive transactions** with a clean injectable `tx` handle so multiple repositories can participate in one atomic unit.
- **Deterministic migrations** committed to git, reproducible across dev/CI/prod.
- **Idempotent seeders** for local dev and integration tests.
- **Consistent naming**: PascalCase models, `snake_case` tables/columns via `@@map`/`@map`, `camelCase` in TypeScript.

## 3. Architecture

The database layer is a **core system** (`src/database`), not a feature module. It exposes:

- `PrismaService` — extends `PrismaClient`, NestJS-managed singleton, registered `@Global()`.
- `BaseRepository<TModel, TDelegate>` — abstract generic base with CRUD, soft-delete, pagination.
- `PrismaTransactionManager` — wraps `prisma.$transaction(async (tx) => …)` with a typed context.
- `SoftDeleteExtension` — a Prisma Client Extension that injects `deletedAt IS NULL` filters and rewrites `delete`/`deleteMany` into `update … SET deletedAt = now()`.

```
                ┌─────────────────────────────────────────┐
                │            Feature Module                 │
                │  TicketRepository extends BaseRepository  │
                └──────────────────┬────────────────────────┘
                                   │ injects (DI)
                ┌──────────────────▼────────────────────────┐
                │   DatabaseModule (@Global)                 │
                │   - PrismaService (singleton)              │
                │   - PrismaTransactionManager               │
                │   - SoftDeleteExtension                    │
                └──────────────────┬────────────────────────┘
                                   │
                            ┌──────▼───────┐
                            │    MySQL     │
                            └──────────────┘
```

Key rule: repositories are owned by the module they serve, but they all extend the shared base and depend only on `PrismaService`. The base class is **transaction-aware** — when handed a `tx` client it uses it; otherwise it uses the root client.

## 4. Folder Structure

```text
src/database/
├── database.module.ts            # @Global() module, exports PrismaService + tx manager
├── prisma.service.ts             # PrismaService extends PrismaClient (lifecycle hooks)
├── prisma.extensions.ts          # soft-delete + query-log client extensions
├── repositories/
│   ├── base.repository.ts        # abstract BaseRepository<TModel, TDelegate>
│   ├── base.types.ts             # PaginatedResult, PageQuery, RepositoryContext, etc.
│   └── index.ts
├── transactions/
│   ├── transaction.manager.ts    # PrismaTransactionManager
│   └── transaction.context.ts    # TransactionalContext type
├── seed/
│   ├── seed.ts                   # entrypoint (prisma db seed)
│   ├── seeders/
│   │   ├── guild.seeder.ts
│   │   ├── permission.seeder.ts
│   │   └── locale.seeder.ts
│   └── seeder.interface.ts       # Seeder contract
└── index.ts                      # public API barrel

prisma/
├── schema.prisma                 # single schema (datasource + generator + models)
├── migrations/
│   ├── 20260101120000_init/
│   │   └── migration.sql
│   └── migration_lock.toml
└── .env.example
```

## 5. Public Interfaces

Real strict TypeScript. These are the abstractions every module consumes.

```typescript
// src/database/repositories/base.types.ts

/** Cursor/offset pagination input. Page is 1-based. */
export interface PageQuery {
  readonly page?: number;        // default 1
  readonly pageSize?: number;    // default 20, max 100
  readonly orderBy?: string;     // model field name
  readonly direction?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

/** Options accepted by every read method. */
export interface FindOptions {
  /** Include soft-deleted rows. Default false. */
  readonly withDeleted?: boolean;
}
```

```typescript
// src/database/transactions/transaction.context.ts
import type { Prisma } from '@prisma/client';

/** The transactional Prisma client handed to repositories inside $transaction. */
export type TransactionalClient = Prisma.TransactionClient;

/** Optional context threaded through repository calls to enlist in a tx. */
export interface RepositoryContext {
  readonly tx?: TransactionalClient;
}
```

```typescript
// src/database/repositories/base.repository.ts
import type { PrismaService } from '../prisma.service';
import type {
  FindOptions,
  PageQuery,
  PaginatedResult,
} from './base.types';
import type { RepositoryContext } from '../transactions/transaction.context';

/**
 * Generic base repository.
 * TModel    = the entity type (e.g. Ticket).
 * TDelegate = the Prisma delegate type (e.g. Prisma.TicketDelegate<...>).
 * Subclasses implement `delegate(ctx)` to return the right delegate
 * from either the root client or a transaction client.
 */
export abstract class BaseRepository<
  TModel extends { id: string; deletedAt: Date | null },
  TDelegate extends DelegateLike<TModel>,
> {
  protected constructor(protected readonly prisma: PrismaService) {}

  /** Resolve the delegate from the active tx (if any) or the root client. */
  protected abstract delegate(ctx?: RepositoryContext): TDelegate;

  /** Soft-delete-aware where guard. */
  protected notDeleted(withDeleted?: boolean): { deletedAt: null } | object {
    return withDeleted ? {} : { deletedAt: null };
  }

  async findById(
    id: string,
    options?: FindOptions,
    ctx?: RepositoryContext,
  ): Promise<TModel | null> {
    return this.delegate(ctx).findFirst({
      where: { id, ...this.notDeleted(options?.withDeleted) },
    });
  }

  async findByIdOrThrow(
    id: string,
    options?: FindOptions,
    ctx?: RepositoryContext,
  ): Promise<TModel> {
    const found = await this.findById(id, options, ctx);
    if (!found) {
      throw new EntityNotFoundError(this.modelName, id);
    }
    return found;
  }

  async create(
    data: CreateInput<TModel>,
    ctx?: RepositoryContext,
  ): Promise<TModel> {
    return this.delegate(ctx).create({ data });
  }

  async update(
    id: string,
    data: UpdateInput<TModel>,
    ctx?: RepositoryContext,
  ): Promise<TModel> {
    return this.delegate(ctx).update({ where: { id }, data });
  }

  /** Soft delete: sets deletedAt = now(). */
  async softDelete(id: string, ctx?: RepositoryContext): Promise<TModel> {
    return this.delegate(ctx).update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Restore a soft-deleted row. */
  async restore(id: string, ctx?: RepositoryContext): Promise<TModel> {
    return this.delegate(ctx).update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  /** Hard delete — guarded; callers must pass force + log an audit entry. */
  async hardDelete(
    id: string,
    force: true,
    ctx?: RepositoryContext,
  ): Promise<TModel> {
    void force;
    return this.delegate(ctx).delete({ where: { id } });
  }

  async paginate(
    query: PageQuery,
    where: WhereInput<TModel> = {},
    options?: FindOptions,
    ctx?: RepositoryContext,
  ): Promise<PaginatedResult<TModel>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const fullWhere = { ...where, ...this.notDeleted(options?.withDeleted) };
    const delegate = this.delegate(ctx);

    const [items, total] = await Promise.all([
      delegate.findMany({
        where: fullWhere,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: query.orderBy
          ? { [query.orderBy]: query.direction ?? 'desc' }
          : undefined,
      }),
      delegate.count({ where: fullWhere }),
    ]);

    const totalPages = Math.ceil(total / pageSize) || 1;
    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  protected abstract get modelName(): string;
}

/** Minimal structural delegate contract — enough for the base methods, no `any`. */
export interface DelegateLike<TModel> {
  findFirst(args: { where: object }): Promise<TModel | null>;
  findMany(args: {
    where?: object;
    skip?: number;
    take?: number;
    orderBy?: object;
  }): Promise<TModel[]>;
  count(args: { where?: object }): Promise<number>;
  create(args: { data: object }): Promise<TModel>;
  update(args: { where: object; data: object }): Promise<TModel>;
  delete(args: { where: object }): Promise<TModel>;
}

export type CreateInput<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
export type UpdateInput<T> = Partial<CreateInput<T>>;
export type WhereInput<T> = Partial<Record<keyof T, unknown>>;
```

```typescript
// src/database/prisma.service.ts
import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
```

```typescript
// src/database/transactions/transaction.manager.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { TransactionalClient } from './transaction.context';

@Injectable()
export class PrismaTransactionManager {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run `work` inside an interactive transaction.
   * Pass `{ tx }` into every participating repository call so they all
   * enlist in the same atomic unit.
   */
  async run<T>(
    work: (tx: TransactionalClient) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T> {
    return this.prisma.$transaction(work, {
      timeout: options?.timeout ?? 10_000,
      maxWait: options?.maxWait ?? 5_000,
    });
  }
}
```

## 6. Events

The database layer is infrastructure; it emits a small set of low-level lifecycle events on the Event Bus for observability. It does **not** emit domain events — those belong to feature modules.

**Emitted:**

```typescript
export interface DatabaseConnectedEvent {
  readonly type: 'database.connected';
  readonly at: Date;
}

export interface SlowQueryEvent {
  readonly type: 'database.query.slow';
  readonly model: string;
  readonly action: string;
  readonly durationMs: number;
  readonly at: Date;
}

export interface MigrationAppliedEvent {
  readonly type: 'database.migration.applied';
  readonly migration: string;
  readonly at: Date;
}
```

**Consumed:** none. The database layer is a leaf dependency and reacts to no domain events.

> Modules should emit their own domain events (e.g. `ticket.created`) from their Application Service **after** the repository commit succeeds, never from inside the repository.

## 7. Dependencies

| Core system | Used? | How |
|-------------|-------|-----|
| **Events**  | Yes   | Emits `database.connected`, `database.query.slow`, `database.migration.applied`. |
| **Logging** | Yes   | Pino logger via Nest `Logger`; Prisma `$on('query')` piped to logger when `DEBUG_SQL=true`. |
| **Cache**   | No (direct) | Repositories do **not** read/write Redis. Caching is layered above by Application Services through the Cache layer. |
| **Permissions** | No | The DB layer stores permission data (claims/groups) but enforces nothing. |
| **Queue**   | No    | No direct BullMQ usage; long migrations run via CI, not jobs. |
| **Modules** | **Never** | The base repo is consumed by modules; it never imports a module. |

## 8. Configuration

Config priority is **ENV -> Database -> Defaults**, validated with Zod at boot.

```typescript
// src/config/database.config.ts
import { z } from 'zod';

export const databaseConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_POOL_TIMEOUT: z.coerce.number().int().min(0).default(10),
  DATABASE_QUERY_LOG: z.coerce.boolean().default(false),
  DATABASE_SLOW_QUERY_MS: z.coerce.number().int().min(1).default(500),
  DATABASE_SOFT_DELETE: z.coerce.boolean().default(true),
});

export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;
```

| Setting | Scope | Default | Notes |
|---------|-------|---------|-------|
| `DATABASE_URL` | global (ENV) | — | `mysql://user:pass@host:3306/ghostbot` |
| `DATABASE_CONNECTION_LIMIT` | global | `10` | appended to connection string pool params |
| `DATABASE_SLOW_QUERY_MS` | global | `500` | threshold for `database.query.slow` event |
| `DATABASE_SOFT_DELETE` | global | `true` | toggles soft-delete extension |
| `DATABASE_QUERY_LOG` | global | `false` | logs SQL via Pino at debug level |

There are no guild-scoped settings for the DB layer itself; guild-scoped configuration lives in `GuildConfig` (defined below) and is owned by feature modules.

## 9. Database

The base schema. **Conventions** (binding for all models):

- Model names: **PascalCase singular** (`GuildMember`). Tables: **snake_case plural** via `@@map("guild_members")`.
- Columns: `camelCase` in Prisma, mapped to `snake_case` via `@map`.
- Primary keys: `id String @id @default(cuid())`. (CUIDs sort roughly chronologically and avoid hot PK contention.)
- Timestamps on every model: `createdAt`, `updatedAt`, nullable `deletedAt` (soft delete).
- Multi-guild: every guild-scoped model carries `guildId String` + relation to `Guild`, and **`@@index([guildId])`**.
- Discord snowflakes are stored as `String` (`@db.VarChar(20)`), never numeric, to avoid 53-bit float loss.
- Foreign keys use `onDelete: Cascade` for owned children, `Restrict` for shared references.
- Soft-delete is enforced by the `SoftDeleteExtension`; raw `findMany` is never called above the repo layer.

```prisma
// prisma/schema.prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["metrics"]
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

/// A Discord guild (server). Root of all guild-scoped data.
model Guild {
  id          String   @id @default(cuid())
  discordId   String   @unique @map("discord_id") @db.VarChar(20)
  name        String   @db.VarChar(100)
  iconHash    String?  @map("icon_hash") @db.VarChar(64)
  ownerId     String   @map("owner_id") @db.VarChar(20)
  locale      String   @default("pt") @db.VarChar(10)
  active      Boolean  @default(true)

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  deletedAt   DateTime? @map("deleted_at")

  config      GuildConfig?
  members     GuildMember[]

  @@index([active])
  @@index([deletedAt])
  @@map("guilds")
}

/// Per-guild configuration blob (validated by Zod at the module layer).
model GuildConfig {
  id            String   @id @default(cuid())
  guildId       String   @unique @map("guild_id")
  prefix        String   @default("!") @db.VarChar(10)
  locale        String   @default("pt") @db.VarChar(10)
  timezone      String   @default("Europe/Lisbon") @db.VarChar(64)
  /// Arbitrary module settings; each module owns its own namespace key.
  settings      Json     @default("{}")

  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  deletedAt     DateTime? @map("deleted_at")

  guild         Guild    @relation(fields: [guildId], references: [id], onDelete: Cascade)

  @@index([guildId])
  @@map("guild_configs")
}

/// A Discord user — global, not guild-scoped (the same user spans guilds).
model User {
  id          String   @id @default(cuid())
  discordId   String   @unique @map("discord_id") @db.VarChar(20)
  username    String   @db.VarChar(32)
  globalName  String?  @map("global_name") @db.VarChar(32)
  avatarHash  String?  @map("avatar_hash") @db.VarChar(64)
  bot         Boolean  @default(false)
  locale      String?  @db.VarChar(10)

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  deletedAt   DateTime? @map("deleted_at")

  memberships GuildMember[]

  @@index([username])
  @@index([deletedAt])
  @@map("users")
}

/// Join entity: a User's membership in a Guild. Guild-scoped.
model GuildMember {
  id          String   @id @default(cuid())
  guildId     String   @map("guild_id")
  userId      String   @map("user_id")
  nickname    String?  @db.VarChar(32)
  /// Discord role snowflakes cached for fast permission resolution.
  roleIds     Json     @default("[]") @map("role_ids")
  joinedAt    DateTime @map("joined_at")

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  deletedAt   DateTime? @map("deleted_at")

  guild       Guild    @relation(fields: [guildId], references: [id], onDelete: Cascade)
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([guildId, userId])
  @@index([guildId])
  @@index([userId])
  @@index([deletedAt])
  @@map("guild_members")
}
```

**Indexing rules:**

1. `guildId` is always indexed on guild-scoped tables.
2. `deletedAt` is indexed wherever soft-delete filtering is hot.
3. Natural keys get `@@unique` (`Guild.discordId`, `User.discordId`, `GuildMember(guildId,userId)`).
4. Any field used in a `where` filter or `orderBy` in a repository must be indexed.

## 10. API

The database layer exposes **no public REST endpoints** of its own. It powers all module APIs underneath.

For operational visibility, one read-only admin endpoint is exposed under the `api` core (guarded by `system.admin`):

| Method | Path | DTO | Notes |
|--------|------|-----|-------|
| `GET` | `/api/system/db/health` | `DbHealthDto` | returns connection state + latency ping |

```typescript
export class DbHealthDto {
  readonly connected!: boolean;
  readonly latencyMs!: number;
  readonly pendingMigrations!: number;
}
```

Swagger: tag `system`, `@ApiBearerAuth()`, `@ApiOkResponse({ type: DbHealthDto })`. No WebSocket surface.

## 11. Permissions

The database layer defines no domain claims. It references two operational claims owned by the `system` namespace:

| Claim | Meaning |
|-------|---------|
| `system.db.health` | view `/api/system/db/health` |
| `system.db.admin`  | run dangerous ops (hard delete, manual migration trigger) |

Wildcard `system.*` grants both. Feature modules define their own claims (e.g. `tickets.*`); the DB layer never enforces them.

## 12. Logging

| Category | What | Level |
|----------|------|-------|
| `db.lifecycle` | connect / disconnect | info |
| `db.query` | SQL text + params (only when `DATABASE_QUERY_LOG=true`) | debug |
| `db.slow` | queries over `DATABASE_SLOW_QUERY_MS` | warn |
| `db.migration` | applied migration name | info |
| `db.error` | Prisma errors (mapped, never raw) | error |

Audit hooks: `hardDelete` and `restore` MUST be accompanied by an audit-log entry written by the calling Application Service. Prisma errors are caught and rewritten through the unified error layer (`PrismaError -> DomainError`) so internals never leak to users. Slow queries are emitted to the Event Bus and exported as a Prometheus histogram (`ghostbot_db_query_duration_ms`).

## 13. Testing

- **Unit** (Vitest): `BaseRepository` against a mocked delegate — verify `notDeleted` filter injection, pagination math (`totalPages`, `hasNext/hasPrev`), `softDelete` sets `deletedAt`, `restore` clears it, `findByIdOrThrow` throws `EntityNotFoundError`.
- **Integration**: spin up MySQL via Docker Compose (test profile), run real migrations, exercise `PrismaTransactionManager.run` to confirm rollback on throw and commit on success; confirm soft-deleted rows are excluded unless `withDeleted: true`.
- **Multi-guild isolation test**: seed two guilds, assert a guild-scoped query never returns the other guild's rows.
- **Seeder test**: run seeders twice, assert idempotency (no duplicate rows).
- Coverage target: 90%+ on `src/database`. Transaction rollback and soft-delete exclusion are **mandatory** covered paths.

## 14. Dashboard Integration

The dashboard does not edit the DB layer directly. It surfaces:

- A **System Health** panel showing `GET /api/system/db/health` (connection, latency, pending migrations).
- A **Slow Queries** widget fed by the Prometheus histogram / `database.query.slow` events.
- Read-only display of soft-deleted entity counts per guild (for admins with `system.db.admin`), with a guarded "restore" action that calls the owning module's API (never Prisma directly).

## 15. Future Extensions

- **Read replicas**: route `findMany`/`count` to a replica via a second datasource and a delegate switch in `BaseRepository`.
- **Partitioning** large guild-scoped tables (e.g. audit logs) by `guildId` hash or by month.
- **Outbox pattern**: transactional outbox table so domain events are published atomically with the commit.
- **Row-level multi-tenancy** enforcement via a Prisma extension that auto-injects `guildId` from request context.
- **Optimistic locking** with a `version Int` column and `update … where version = n`.

## 16. Tasks for Claude

**Phase 1 — Schema**
1. Create `prisma/schema.prisma` with `Guild`, `GuildConfig`, `User`, `GuildMember` exactly per Section 9.
2. Run `prisma migrate dev --name init_base_schema`; commit the generated migration.

**Phase 2 — Services**
3. Implement `PrismaService` (lifecycle hooks, query logging gated by config).
4. Implement `SoftDeleteExtension` and wire it in `prisma.extensions.ts`.
5. Implement `BaseRepository<TModel, TDelegate>` and `base.types.ts` per Section 5.
6. Implement `PrismaTransactionManager`.
7. Create `DatabaseModule` (`@Global()`) exporting `PrismaService` + `PrismaTransactionManager`.

**Phase 3 — Events**
8. Emit `database.connected`, `database.query.slow`, `database.migration.applied` via the Event Bus.

**Phase 4 — Commands**
9. N/A — the DB layer exposes no Discord commands.

**Phase 5 — Dashboard**
10. Expose data for the System Health + Slow Queries panels (read-only).

**Phase 6 — API**
11. Add `GET /api/system/db/health` with `DbHealthDto`, guarded by `system.db.health`.

**Phase 7 — Tests**
12. Unit-test `BaseRepository`; integration-test transactions + soft-delete + guild isolation; seeder idempotency.

**Phase 8 — Docs**
13. Document the repository pattern usage for module authors; link from `00-project.md`.
14. Implement idempotent seeders (`guild`, `permission`, `locale`) using upserts.

## 17. Acceptance Criteria

- [ ] `prisma migrate dev` produces a clean migration for the four base models; `prisma migrate deploy` runs in CI.
- [ ] `PrismaService` connects on boot and disconnects on shutdown; `database.connected` is emitted.
- [ ] A module repository extends `BaseRepository`, depends only on `PrismaService`, and contains no `PrismaClient` import above the repo boundary.
- [ ] `findById`/`paginate` exclude soft-deleted rows by default and include them with `withDeleted: true`.
- [ ] `softDelete` sets `deletedAt`; `restore` clears it; `hardDelete` requires `force` and an audit entry.
- [ ] `PrismaTransactionManager.run` commits on success and rolls back on throw, with multiple repos enlisting via `{ tx }`.
- [ ] Guild-scoped queries never return another guild's rows (isolation test green).
- [ ] Seeders are idempotent (run twice -> no duplicates).
- [ ] No `any` in `src/database`; ESLint + `tsc --strict` clean.

## 18. Definition of Done

- [ ] All Phase 1–8 tasks complete.
- [ ] Migrations created, committed, and applied in CI.
- [ ] Vitest unit + integration suites pass; coverage ≥ 90% on `src/database`.
- [ ] ESLint / Prettier / `tsc` strict all clean; Husky + Commitlint pass.
- [ ] No raw `PrismaClient` usage outside `src/database`; no `any`.
- [ ] This document reviewed and linked from `00-project.md`.
- [ ] Conventional-commit PR opened against `develop` (not `main`), reviewed, and approved.
