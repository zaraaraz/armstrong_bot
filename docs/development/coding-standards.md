# Coding Standards

> ## Claude Instructions
> - Follow these standards in every file you generate. Do not change architecture from `00-project.md`.
> - No `any`. Keep methods small (<50 lines where reasonable). Generate tests and docs.
> - Use the Repository Pattern, the Event Bus and Dependency Injection. Never bypass layers.

---

## 1. Purpose

Define the concrete coding rules every contributor (human or AI) follows so the codebase stays
consistent, readable and maintainable for years. These rules operationalise the principles in
`00-project.md`.

---

## 2. Goals

- One obvious way to write things.
- Strict typing with zero `any`.
- Enforced layering (Controller → Service → Repository → DB).
- Self-documenting code with minimal but meaningful comments.
- Lint/format fully automated so reviews focus on logic, not style.

---

## 3. Architecture (enforcement)

The layer rule from the contract is enforced both by convention and by lint:

```
Controller / Necord command  →  Application Service  →  Domain Service (optional)  →  Repository  →  Prisma
```

- Controllers/commands contain **no business logic** — they validate input, call a service, format output.
- Only repositories import `PrismaService`. An ESLint `no-restricted-imports` rule blocks `@prisma`
  or `PrismaService` outside `*.repository.ts`.
- Modules never import another module's internal files. Allowed cross-module surface: published
  public contracts under `<module>/public/` and the Event Bus.

---

## 4. Folder Structure (conventions)

```
src/modules/<module>/
├── <module>.module.ts
├── commands/            # Necord slash commands (thin)
├── controllers/         # REST (thin)
├── services/            # application + domain services
├── repositories/        # ONLY layer touching Prisma
├── dto/                 # request/response DTOs
├── entities/            # domain entities / value objects
├── events/              # event definitions + handlers
├── interfaces/          # public + internal contracts
├── public/              # the ONLY surface other modules may import
├── validators/          # Zod schemas
└── <module>.spec.ts     # colocated tests (+ __tests__ for integration)
```

---

## 5. Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Files | kebab-case | `ticket-transcript.service.ts` |
| Classes | PascalCase | `TicketService` |
| Interfaces | PascalCase, no `I` prefix | `TicketRepository` |
| Variables / functions | camelCase | `closeTicket()` |
| Constants / enums values | UPPER_SNAKE | `MAX_OPEN_TICKETS` |
| Prisma models | PascalCase singular | `Ticket` |
| Permission claims | dot.case | `tickets.close` |
| Events | `module.entity.action` | `tickets.ticket.closed` |
| Boolean names | `is/has/can/should` prefix | `isClosed`, `canClaim` |

---

## 6. TypeScript Rules

- `strict: true`. **No `any`** — use `unknown` + narrowing, or generics.
- Prefer `interface` for object/contract shapes; `type` for unions/utilities.
- No non-null assertions (`!`) except in tests and proven-safe boundaries with a comment.
- Use discriminated unions for result/error states instead of throwing for control flow.
- Public methods are explicitly typed (params + return). No implicit `any` returns.
- `readonly` for fields that never change; `as const` for literal config.

```ts
// Good — explicit, narrow, no any
async function getMember(guildId: string, userId: string): Promise<GuildMember | null> { ... }

// Bad
async function getMember(g, u): Promise<any> { ... }
```

---

## 7. Error Handling

- Use the unified error system: domain errors extend `DomainError` (categorised, i18n key, safe message).
- Never `throw new Error('string')` in domain code — throw a typed error with a category.
- Controllers/commands map domain errors to a safe user-facing message via the global filter.
- Never leak stack traces, SQL, or internals to users. Log the detail; show the friendly message.

```ts
export class TicketNotFoundError extends DomainError {
  constructor(id: string) {
    super({ code: 'tickets.not_found', category: 'NOT_FOUND', meta: { id } });
  }
}
```

---

## 8. Validation & DTOs

- Every external input is validated. REST DTOs use class-validator; service inputs use Zod schemas.
- DTOs are dumb data carriers — no logic.
- Never pass raw Discord/HTTP payloads into services; map to a DTO/command object first.

---

## 9. Comments & Documentation

- Code should be self-documenting; comment the **why**, not the **what**.
- Public methods of services/repositories get a one-line TSDoc when intent isn't obvious.
- No commented-out code. No `TODO` unless explicitly requested (per contract).

---

## 10. Methods, Classes & Complexity

- Methods ideally <50 lines; extract helpers when longer.
- One class = one responsibility. If a service grows past ~5–7 public methods, split it.
- Prefer composition over inheritance. Avoid deep inheritance trees.
- Avoid duplicated logic — extract to `shared/` or a domain helper.

---

## 11. Imports & Module Boundaries

- Import order: node builtins → external → `@core`/`@shared` → relative.
- Use path aliases (`@core/*`, `@shared/*`, `@modules/*`) — no `../../../..` chains.
- Cross-module imports allowed only from `<module>/public/`.

---

## 12. Async, Concurrency & Performance

- Always `await` promises or explicitly handle them; no floating promises (lint-enforced).
- Use `Promise.all` for independent async work; avoid sequential awaits in loops when parallel is safe.
- Cache hot reads via the Cache layer; never read Redis directly.
- Paginate any list endpoint/query that can grow; never `findMany()` unbounded.

---

## 13. Tooling Config (summary)

- **ESLint**: `@typescript-eslint` strict + import-order + no-restricted-imports (Prisma rule) +
  no-floating-promises.
- **Prettier**: 2-space indent, single quotes, trailing commas, 100-col print width.
- **Husky**: pre-commit → lint-staged (eslint --fix + prettier); commit-msg → Commitlint.
- **Commitlint**: Conventional Commits enforced.

---

## 14. Do / Don't Examples

```ts
// ❌ Controller touching Prisma
@Get() list() { return this.prisma.ticket.findMany(); }

// ✅ Controller → Service → Repository
@Get() list(@GuildId() g: string, @Query() q: PageDto) {
  return this.ticketService.list(g, q);
}
```

```ts
// ❌ Cross-module internal import
import { EconomyService } from '@modules/economy/services/economy.service';

// ✅ Public contract or event
import { EconomyApi } from '@modules/economy/public';
```

---

## 15. Future Extensions

- Custom ESLint rule to assert the layer flow automatically.
- Architecture tests (dependency-cruiser) gating module boundaries in CI.

---

## 16. Tasks for Claude

1. Set up ESLint + Prettier + the restricted-import rules.
2. Configure Husky + lint-staged + Commitlint.
3. Add path aliases in `tsconfig.json`.
4. Add `dependency-cruiser` boundary rules.
5. Document the error base classes referenced here.

---

## 17. Acceptance Criteria

- [ ] `eslint .` and `prettier --check .` pass with zero warnings.
- [ ] No `any` in the codebase (lint-enforced).
- [ ] Prisma import rule blocks usage outside repositories.
- [ ] Cross-module internal imports are blocked by boundary rules.

---

## 18. Definition of Done

- [ ] Tooling configured and committed.
- [ ] CI runs lint + type-check and fails on violations.
- [ ] This document linked from the contributing guide.
- [ ] PR opened into `develop`.
