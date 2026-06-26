# Testing

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations for any test-support tables. Generate tests and docs.
> - Generate DTOs. Use Repository Pattern. Use the Event Bus. Use Dependency Injection — tests inject mocks/fakes through the Nest DI container, never instantiate services with hidden `new`.
> - No `any`. Keep helper functions small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields. Support pagination, caching, translations, dashboard.
> - Tests are first-class code: they live beside the unit they cover (or in `src/tests` for cross-cutting suites), are linted, typed strict, and reviewed.
> - **No feature is done without tests.** A PR that adds behaviour but no test fails CI gating by design.
> - Never hit external networks in unit/integration tests. Discord, Redis, MySQL and HTTP must be faked or run via Testcontainers.

---

## 1. Purpose

This document defines the **testing strategy, tooling and conventions** for the entire Ghost Bot platform.
It is an architecture-level document (not a single Discord feature), so it adapts the per-feature sections
sensibly while keeping all 18 numbered headings.

Testing in Ghost Bot exists to guarantee that:

- Every module behaves correctly **in isolation** (unit) and **wired through the DI container** (integration).
- The **public API/contract** of each module never breaks silently (contract tests).
- The strict **layer flow** (Controller → Application Service → Domain Service → Repository → Database) is
  respected and provable — e.g. a controller test proves the controller never touches Prisma.
- The **dashboard** works end-to-end against a real browser (Playwright).
- Regressions are caught **before merge** via CI gating, with enforced coverage thresholds.

The guiding rule, inherited from `00-project.md`: *No feature is considered complete without tests.*

## 2. Goals

- Provide a single, consistent test stack: **Vitest** (unit + integration) and **Playwright** (dashboard e2e).
- Enforce a healthy **test pyramid**: many fast unit tests, fewer integration tests, very few e2e tests.
- Make tests **deterministic and hermetic**: no shared global state, no real network, seeded clocks/IDs.
- Make **Discord and Prisma trivially mockable** with shared, typed fixtures and factories.
- Run integration tests against **real MySQL + Redis via Testcontainers**, not against mocks, so SQL and
  cache semantics are actually exercised.
- Guarantee module isolation through **contract tests** that assert only the published public API is used.
- Gate every PR on lint + typecheck + unit + integration + contract + coverage threshold; gate dashboard
  PRs additionally on Playwright e2e.
- Keep the developer feedback loop fast: unit suite under ~30s locally, watch mode available.

## 3. Architecture

### Test pyramid

```
                 ┌──────────────────────────┐
                 │   E2E (Playwright)        │   ~5%   slow, full stack + browser
                 │   dashboard user journeys │
                 ├──────────────────────────┤
                 │   Integration (Vitest)    │   ~25%  DI container + Testcontainers
                 │   service↔repo↔real DB    │
                 │   + contract tests        │
                 ├──────────────────────────┤
                 │   Unit (Vitest)           │   ~70%  pure, mocked deps, milliseconds
                 │   domain/services/utils   │
                 └──────────────────────────┘
```

### Test categories

| Category        | Runner     | Real deps                         | Scope                                                            |
| --------------- | ---------- | --------------------------------- | ---------------------------------------------------------------- |
| Unit            | Vitest     | none (all mocked)                 | one class/function; domain logic, validators, mappers, guards    |
| Integration     | Vitest     | MySQL + Redis (Testcontainers)    | Application Service → Repository → real DB; cache; queue         |
| Contract        | Vitest     | none                              | a module's published public API + emitted/consumed event shapes  |
| E2E (dashboard) | Playwright | full app (Docker Compose) + browser | login → configure guild → assert effect                        |

### How tests map onto the layers

- **Domain services / value objects / mappers** → unit tests, zero infrastructure.
- **Repositories** → integration tests against a real MySQL schema (migrated), asserting indexes/soft-delete.
- **Application services** → integration tests with real repositories + faked Discord + faked Event Bus,
  OR unit tests with all repositories mocked when only orchestration logic is under test.
- **Controllers (REST + Necord commands)** → integration tests over the Nest testing module; assert they
  delegate to application services and **never import Prisma**.
- **Event Bus interactions** → contract tests asserting payload shape against the published event schema.
- **Dashboard** → Playwright against the running stack.

## 4. Folder Structure

Tests live next to the unit they cover (`*.spec.ts`) plus a top-level `src/tests` for cross-cutting suites,
shared fixtures, factories and harnesses.

```
src/
├─ modules/
│  └─ tickets/
│     ├─ application/
│     │  ├─ ticket.service.ts
│     │  └─ ticket.service.spec.ts          # unit (mocked repo/events)
│     ├─ domain/
│     │  ├─ ticket.entity.ts
│     │  └─ ticket.entity.spec.ts           # pure unit
│     ├─ infrastructure/
│     │  ├─ ticket.repository.ts
│     │  └─ ticket.repository.int-spec.ts   # integration (Testcontainers)
│     └─ contracts/
│        └─ tickets.public-api.contract-spec.ts
├─ tests/
│  ├─ setup/
│  │  ├─ vitest.setup.ts                     # global hooks, matchers, env guard
│  │  ├─ testcontainers.ts                   # MySQL + Redis container lifecycle
│  │  └─ prisma-test.ts                      # migrate + truncate helpers
│  ├─ fixtures/
│  │  ├─ discord/
│  │  │  ├─ mock-discord-client.ts
│  │  │  ├─ interaction.factory.ts
│  │  │  └─ guild.factory.ts
│  │  └─ prisma/
│  │     └─ prisma-mock.ts                   # typed vitest-mock-extended mock
│  ├─ factories/
│  │  ├─ ticket.factory.ts
│  │  └─ user.factory.ts
│  ├─ builders/
│  │  └─ test-module.builder.ts              # Nest TestingModule helpers
│  └─ contract/
│     └─ contract-runner.ts
├─ vitest.config.ts
├─ vitest.integration.config.ts
└─ dashboard/
   └─ e2e/
      ├─ playwright.config.ts
      ├─ fixtures/
      │  └─ auth.fixture.ts
      └─ specs/
         ├─ login.e2e.ts
         └─ guild-config.e2e.ts
```

## 5. Public Interfaces

The testing infrastructure exposes a small, strict set of typed helpers. No `any`.

```ts
// src/tests/builders/test-module.builder.ts
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { ModuleMetadata } from '@nestjs/common/interfaces';

/** Overrides a provider token with a fake/mock for a single test module. */
export interface ProviderOverride<T = unknown> {
  readonly token: string | symbol | (new (...args: never[]) => T);
  readonly useValue: T;
}

export interface TestModuleOptions extends Pick<ModuleMetadata, 'imports' | 'providers' | 'controllers'> {
  readonly overrides?: readonly ProviderOverride[];
}

export interface TestHarness {
  readonly module: TestingModule;
  readonly app: INestApplication;
  get<T>(token: string | symbol | (new (...args: never[]) => T)): T;
  close(): Promise<void>;
}

export declare function createTestHarness(options: TestModuleOptions): Promise<TestHarness>;
```

```ts
// src/tests/factories/factory.ts
/** Deterministic factory: pure builder with overridable fields, no DB writes. */
export interface Factory<T> {
  build(overrides?: Partial<T>): T;
  buildMany(count: number, overrides?: Partial<T>): readonly T[];
}

/** Persisting factory: writes via the repository under test, returns the row. */
export interface PersistFactory<T> extends Factory<T> {
  create(overrides?: Partial<T>): Promise<T>;
  createMany(count: number, overrides?: Partial<T>): Promise<readonly T[]>;
}
```

```ts
// src/tests/setup/testcontainers.ts
export interface TestInfraHandles {
  readonly mysqlUrl: string;
  readonly redisUrl: string;
  stop(): Promise<void>;
}

/** Starts MySQL + Redis containers, applies Prisma migrations, returns connection URLs. */
export declare function startTestInfra(): Promise<TestInfraHandles>;

/** Truncates all tables between tests without dropping the schema (fast reset). */
export declare function truncateAll(databaseUrl: string): Promise<void>;
```

```ts
// src/tests/contract/contract-runner.ts
import type { ZodSchema } from 'zod';

/** Asserts an emitted event payload matches its published Zod contract. */
export interface EventContract<TPayload> {
  readonly name: string;
  readonly schema: ZodSchema<TPayload>;
}

export declare function assertEventContract<T>(contract: EventContract<T>, payload: unknown): asserts payload is T;
```

## 6. Events

Testing does not own business events, but it **verifies** them. Two responsibilities:

**Consumed by the test harness (to assert behaviour):** every domain event a unit under test emits is captured
through a fake Event Bus and asserted against its published Zod contract.

```ts
// Fake Event Bus used in unit/integration tests
export interface RecordedEvent<T = unknown> {
  readonly name: string;
  readonly payload: T;
  readonly emittedAt: Date;
}

export interface FakeEventBus {
  emit<T>(name: string, payload: T): Promise<void>;
  /** Test assertions */
  recorded(name?: string): readonly RecordedEvent[];
  reset(): void;
}
```

**Emitted by the test infrastructure (CI telemetry only, optional):**

| Event                  | Direction | Payload shape                                                        |
| ---------------------- | --------- | -------------------------------------------------------------------- |
| `test.suite.completed` | emitted   | `{ suite: string; passed: number; failed: number; durationMs: number }` |
| `test.coverage.reported` | emitted | `{ lines: number; branches: number; functions: number; statements: number }` |

These are surfaced to CI/observability, never to runtime modules.

## 7. Dependencies

Testing relies on CORE systems through their **fakes or real Testcontainer-backed instances**, never on other
feature modules directly.

| Core system   | Unit tests                          | Integration tests                       |
| ------------- | ----------------------------------- | --------------------------------------- |
| Database (Prisma) | `vitest-mock-extended` typed mock | Real MySQL via Testcontainers + migrate |
| Cache         | In-memory fake implementing `CacheService` | Real Redis via Testcontainers      |
| Event Bus     | `FakeEventBus` recorder             | Real in-process Event Bus               |
| Permissions   | Fake `PermissionService` returning configured claims | Real service over test DB    |
| Queue (BullMQ)| In-memory fake queue                | Real Redis-backed queue, jobs drained synchronously |
| Discord (Necord) | `MockDiscordClient` + interaction factories | Same mock; never a real gateway  |
| i18n          | Real translator with test namespaces (PT/EN fixtures) | same                       |

Tests **must not** import another module's internal services — only its published public API or events,
which is exactly what contract tests enforce.

## 8. Configuration

Test configuration follows the contract priority **ENV → Database → Defaults**, all Zod-validated. A dedicated
schema parses the test environment so a misconfigured CI run fails fast with a clear message.

```ts
// src/tests/setup/test-env.schema.ts
import { z } from 'zod';

export const TestEnvSchema = z.object({
  NODE_ENV: z.literal('test'),
  TEST_DB_REUSE: z.coerce.boolean().default(false),          // reuse running containers locally
  TEST_LOG_LEVEL: z.enum(['silent', 'error', 'info', 'debug']).default('silent'),
  TEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  COVERAGE_LINES: z.coerce.number().min(0).max(100).default(80),
  COVERAGE_BRANCHES: z.coerce.number().min(0).max(100).default(75),
  COVERAGE_FUNCTIONS: z.coerce.number().min(0).max(100).default(80),
  COVERAGE_STATEMENTS: z.coerce.number().min(0).max(100).default(80),
  PLAYWRIGHT_BASE_URL: z.string().url().default('http://localhost:3000'),
});

export type TestEnv = z.infer<typeof TestEnvSchema>;
```

Coverage thresholds are wired into Vitest from the same source of truth:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/tests/setup/vitest.setup.ts'],
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.int-spec.ts', 'src/dashboard/e2e/**'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage/unit',
      thresholds: { lines: 80, branches: 75, functions: 80, statements: 80 },
      exclude: ['**/*.spec.ts', '**/*.int-spec.ts', 'src/tests/**', '**/*.dto.ts'],
    },
  },
});
```

```ts
// vitest.integration.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/tests/setup/vitest.setup.ts', 'src/tests/setup/testcontainers.ts'],
    include: ['src/**/*.int-spec.ts', 'src/**/*.contract-spec.ts'],
    testTimeout: 120_000,        // container startup + migrations
    fileParallelism: false,      // shared DB schema; run files serially
    pool: 'forks',
  },
});
```

## 9. Database

Integration tests use a **real MySQL** instance from Testcontainers, with Prisma migrations applied at suite
start. No production models are owned here. Optionally, a `TestRun` audit table records CI history.

```prisma
// prisma/schema.prisma — optional CI/test telemetry (guild-agnostic, global)
model TestRun {
  id           String   @id @default(cuid())
  commitSha    String   @db.VarChar(40)
  branch       String   @db.VarChar(255)
  suite        TestSuite
  passed       Int
  failed       Int
  skipped      Int      @default(0)
  durationMs   Int
  coverageLines     Decimal? @db.Decimal(5, 2)
  coverageBranches  Decimal? @db.Decimal(5, 2)
  createdAt    DateTime @default(now())
  deletedAt    DateTime?              // soft-delete: keep history, hide pruned rows

  @@index([commitSha])
  @@index([branch, createdAt])
  @@index([suite, createdAt])
  @@map("test_runs")
}

enum TestSuite {
  UNIT
  INTEGRATION
  CONTRACT
  E2E
}
```

**Test DB strategy:**

- Containers are started **once per integration run** (`globalSetup`), migrations applied via
  `prisma migrate deploy` against the container URL.
- Between tests, `truncateAll()` runs `SET FOREIGN_KEY_CHECKS=0; TRUNCATE ...; SET FOREIGN_KEY_CHECKS=1`
  for a fast, deterministic reset — far cheaper than re-migrating.
- Each module's repository integration test seeds **only** its own tables via persisting factories.
- Soft-deleted rows are asserted to be excluded from default queries and included by explicit `withDeleted`.
- Indexes are exercised by tests that paginate and filter on searchable fields.

## 10. API

This document defines no runtime REST feature endpoints. It **mandates how API layers are tested** and
optionally exposes a read-only CI endpoint.

REST controllers are tested through the Nest testing module with `supertest`, asserting status codes, DTO
validation (Zod), pagination envelopes, and permission guards — while proving the controller delegates to an
application service and never imports Prisma.

```ts
// Example controller integration assertion
it('GET /guilds/:id/tickets paginates and never leaks internals', async () => {
  const res = await request(harness.app.getHttpServer())
    .get('/guilds/123/tickets?page=1&pageSize=20')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(res.body).toMatchObject({
    data: expect.any(Array),
    meta: { page: 1, pageSize: 20, total: expect.any(Number) },
  });
});
```

Optional read-only CI API (guarded behind an admin claim):

| Method + Path                    | DTO (response)                                    | Swagger notes                       |
| -------------------------------- | ------------------------------------------------- | ----------------------------------- |
| `GET /admin/test-runs`           | `PaginatedDto<TestRunDto>`                         | Paginated, filter by `branch`,`suite` |
| `GET /admin/test-runs/:id`       | `TestRunDto`                                       | 404 if soft-deleted                 |

```ts
export class TestRunDto {
  readonly id!: string;
  readonly commitSha!: string;
  readonly branch!: string;
  readonly suite!: 'UNIT' | 'INTEGRATION' | 'CONTRACT' | 'E2E';
  readonly passed!: number;
  readonly failed!: number;
  readonly durationMs!: number;
  readonly createdAt!: string;
}
```

## 11. Permissions

Permission claims defined by this unit (read-only, admin/dashboard scope):

| Claim                | Meaning                                             |
| -------------------- | --------------------------------------------------- |
| `testing.runs.read`  | View CI test run history in the dashboard/API       |
| `testing.runs.purge` | Soft-delete old test run records                    |
| `testing.*`          | Wildcard granting all testing claims                |

Permission **guards themselves** must be unit-tested: a fake `PermissionService` is configured to grant/deny a
claim, and the guard is asserted to allow/reject accordingly, including wildcard resolution (`tickets.*` →
`tickets.close`) and inheritance through groups.

## 12. Logging

- During tests the Pino logger runs at `silent` (or `error`) level by default to keep output clean; raise via
  `TEST_LOG_LEVEL`.
- A custom Vitest matcher captures log records so tests can assert that **errors are logged, categorised and
  traceable** without printing them.
- **Audit hook:** integration tests assert that security-relevant actions (e.g. permission denial, config
  change) emit an audit log entry with the correct category.
- CI publishes the JUnit + coverage reports as build artifacts; the optional `TestRun` row is the durable audit
  trail of suite outcomes.
- Tests must never assert on raw internal error messages leaking to users — they assert the **user-friendly**
  message and that internals stay in the log.

## 13. Testing

This is the meta-section: expectations every module's test suite must meet.

**Unit (required for every service, domain object, validator, mapper, guard):**
- Pure, no I/O, all collaborators mocked through DI.
- Cover happy path + each error branch + boundary inputs.
- Validators tested against valid and invalid payloads (Zod `safeParse`).

**Integration (required for every repository and every application service with side effects):**
- Real MySQL + Redis via Testcontainers.
- Assert SQL behaviour: filtering, pagination, soft-delete exclusion, unique constraints, cascade.
- Assert cache read-through/invalidation through the Cache layer (never raw Redis).
- Assert queued jobs are enqueued with correct payloads and drain successfully.

**Contract (required for every module exposing a public API):**
- Assert the published interface signature is honoured.
- Assert every emitted event matches its Zod schema via `assertEventContract`.
- Assert no internal symbol is reachable from the module barrel/public index.

**E2E (required for dashboard-facing features):**
- Playwright journey covering the user-visible effect of the feature.

### Example unit test

```ts
// src/modules/tickets/application/ticket.service.spec.ts
import { mock, type MockProxy } from 'vitest-mock-extended';
import { TicketService } from './ticket.service';
import type { TicketRepository } from '../infrastructure/ticket.repository';
import type { FakeEventBus } from '../../../tests/fixtures/event-bus';
import { makeFakeEventBus } from '../../../tests/fixtures/event-bus';
import { ticketFactory } from '../../../tests/factories/ticket.factory';

describe('TicketService.close', () => {
  let repo: MockProxy<TicketRepository>;
  let events: FakeEventBus;
  let service: TicketService;

  beforeEach(() => {
    repo = mock<TicketRepository>();
    events = makeFakeEventBus();
    service = new TicketService(repo, events);
  });

  it('closes an open ticket and emits tickets.closed', async () => {
    const ticket = ticketFactory.build({ status: 'OPEN' });
    repo.findById.mockResolvedValue(ticket);
    repo.update.mockResolvedValue({ ...ticket, status: 'CLOSED' });

    await service.close({ guildId: ticket.guildId, ticketId: ticket.id, closedBy: 'mod-1' });

    expect(repo.update).toHaveBeenCalledWith(ticket.id, { status: 'CLOSED', closedBy: 'mod-1' });
    expect(events.recorded('tickets.closed')).toHaveLength(1);
  });

  it('rejects closing an already closed ticket', async () => {
    repo.findById.mockResolvedValue(ticketFactory.build({ status: 'CLOSED' }));
    await expect(service.close({ guildId: 'g1', ticketId: 't1', closedBy: 'm1' }))
      .rejects.toMatchObject({ code: 'TICKET_ALREADY_CLOSED' });
  });
});
```

### Example integration test (repository + real DB)

```ts
// src/modules/tickets/infrastructure/ticket.repository.int-spec.ts
import { startTestInfra, truncateAll, type TestInfraHandles } from '../../../tests/setup/testcontainers';
import { TicketRepository } from './ticket.repository';
import { PrismaService } from '../../../database/prisma.service';
import { persistTicket } from '../../../tests/factories/ticket.factory';

describe('TicketRepository (MySQL)', () => {
  let infra: TestInfraHandles;
  let prisma: PrismaService;
  let repo: TicketRepository;

  beforeAll(async () => {
    infra = await startTestInfra();
    prisma = new PrismaService({ url: infra.mysqlUrl });
    await prisma.$connect();
    repo = new TicketRepository(prisma);
  });

  afterEach(() => truncateAll(infra.mysqlUrl));
  afterAll(async () => { await prisma.$disconnect(); await infra.stop(); });

  it('paginates by guild and excludes soft-deleted rows', async () => {
    await persistTicket(prisma, { guildId: 'g1' });
    await persistTicket(prisma, { guildId: 'g1', deletedAt: new Date() });

    const page = await repo.findByGuild('g1', { page: 1, pageSize: 10 });

    expect(page.total).toBe(1);
    expect(page.data).toHaveLength(1);
  });
});
```

### Example Discord interaction mock

```ts
// src/tests/fixtures/discord/interaction.factory.ts
import type { ChatInputCommandInteraction } from 'discord.js';
import { mock } from 'vitest-mock-extended';

export function chatInputInteractionFactory(
  overrides: Partial<ChatInputCommandInteraction> = {},
): ChatInputCommandInteraction {
  const base = mock<ChatInputCommandInteraction>();
  Object.assign(base, { guildId: 'guild-1', commandName: 'ban', ...overrides });
  return base;
}
```

### Example Playwright e2e

```ts
// src/dashboard/e2e/specs/guild-config.e2e.ts
import { test, expect } from '../fixtures/auth.fixture';

test('admin toggles tickets module and the change persists', async ({ authedPage }) => {
  await authedPage.goto('/guilds/123/modules');
  await authedPage.getByRole('switch', { name: 'Tickets' }).click();
  await authedPage.getByRole('button', { name: 'Save' }).click();
  await expect(authedPage.getByText('Settings saved')).toBeVisible();

  await authedPage.reload();
  await expect(authedPage.getByRole('switch', { name: 'Tickets' })).toBeChecked();
});
```

## 14. Dashboard Integration

- A read-only **"Quality"** panel surfaces the latest `TestRun` rows: pass/fail counts, coverage trend, and
  last green commit per branch (gated by `testing.runs.read`).
- Coverage badges (lines/branches) rendered from the latest reported metrics.
- The dashboard itself is the primary subject of Playwright e2e; its critical journeys (login, guild config,
  permission editing, translation editing) each have an e2e spec.
- Playwright fixtures provide an authenticated page so individual specs do not re-implement login.

## 15. Future Extensions

- **Mutation testing** (Stryker) on critical domain modules to validate test effectiveness beyond coverage %.
- **Snapshot/visual regression** for the dashboard via Playwright screenshots.
- **Load/performance tests** (k6) for hot REST endpoints and command throughput, fed into Grafana.
- **Consumer-driven contract tests** (Pact-style) once external plugins consume module events.
- **Flaky-test quarantine**: auto-tag and isolate intermittently failing specs, tracked in `TestRun`.
- **Per-PR ephemeral preview env** running the full Playwright suite against deployed infra.

## 16. Tasks for Claude

Execute in order.

1. **Schema:** add the optional `TestRun` model + `TestSuite` enum; run `prisma migrate dev --name test_runs`.
2. **Config:** implement `TestEnvSchema` and wire thresholds into `vitest.config.ts` / `vitest.integration.config.ts`.
3. **Infra setup:** implement `startTestInfra`, `truncateAll`, `prisma-test.ts` (Testcontainers MySQL + Redis + migrate).
4. **Fixtures/mocks:** implement `MockDiscordClient`, interaction/guild factories, `prisma-mock.ts`, `FakeEventBus`, in-memory cache + queue fakes.
5. **Factories:** implement typed `Factory`/`PersistFactory` and concrete factories (user, ticket, …).
6. **Builders:** implement `createTestHarness` (Nest `TestingModule` + provider overrides).
7. **Contract runner:** implement `assertEventContract` and `contract-runner.ts`.
8. **Reference tests:** add example unit, integration, contract, and Playwright specs as living templates.
9. **Dashboard:** build the read-only Quality panel + coverage badges (behind `testing.runs.read`).
10. **API:** expose `GET /admin/test-runs` (+ `:id`) with `TestRunDto`, pagination, Swagger, guards.
11. **Tests:** unit + integration tests for the testing helpers themselves (factories deterministic, truncate works).
12. **CI:** add GitHub Actions jobs (lint → typecheck → unit+coverage → integration → contract → e2e) with gating.
13. **Docs:** update module READMEs with the "how to test this module" section.

## 17. Acceptance Criteria

- [ ] `npm run test` runs the unit suite green in under ~30s locally.
- [ ] `npm run test:int` spins up MySQL + Redis via Testcontainers, migrates, and passes.
- [ ] `npm run test:e2e` runs Playwright against the Compose stack and passes.
- [ ] Coverage meets thresholds: lines ≥ 80, branches ≥ 75, functions ≥ 80, statements ≥ 80; CI fails below.
- [ ] Every module has at least one contract test asserting its public API + event shapes.
- [ ] A controller test proves the controller does not import Prisma (lint rule + assertion).
- [ ] Discord and Prisma are mocked in unit tests; no real network calls occur.
- [ ] Integration tests reset state via `truncateAll` between tests and are order-independent.
- [ ] Soft-delete exclusion and pagination are covered by repository integration tests.
- [ ] No `any` anywhere in test code; ESLint + `tsc --noEmit` pass on the test tree.

## 18. Definition of Done

- [ ] All unit, integration, contract and e2e suites pass in CI.
- [ ] Coverage thresholds enforced and met; report uploaded as a CI artifact.
- [ ] Prisma migration for `TestRun` created and committed.
- [ ] Lint, Prettier and typecheck clean (`tsc --noEmit`); Husky/Commitlint pass.
- [ ] This document and per-module "how to test" notes written.
- [ ] CI gating configured so a PR without tests for new behaviour fails.
- [ ] Branch follows `feature/<module>`; Conventional Commits; PR opened against `develop`; no direct commit to `main`.
- [ ] PR reviewed and green before merge.
