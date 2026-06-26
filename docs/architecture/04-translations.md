# Translations (i18n)

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations for every schema change. Generate tests and docs.
> - Generate DTOs for all API I/O. Use the Repository Pattern (only repositories touch Prisma). Use the Event Bus for cross-module signals. Use Dependency Injection everywhere.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Create indexes for searchable fields (key, locale, namespace, guildId). Support pagination, caching, translations, and dashboard editing.
> - The i18n engine is a CORE system: no module loads translation files or hits the DB for strings directly — everything goes through `TranslationService`.
> - Never touch Redis directly — go through the Cache layer. Never read raw locale files outside the loader.

---

## 1. Purpose

The Translations (i18n) system is a **core** subsystem of Ghost Bot that provides a single, guild-aware, type-safe way to render localized strings across every surface: Discord slash-command responses, embeds, error messages, dashboard UI labels, emails, and audit log entries.

It must:

- Resolve a locale per request using a deterministic fallback chain.
- Load translation bundles from **files** (shipped defaults) **and the database** (per-guild overrides + dashboard-authored strings), merged with clear precedence.
- Support **namespaces** (`module:namespace.key`), **variable interpolation**, and **ICU plural/select** rules.
- Detect, log, and report **missing keys** without crashing the caller.
- Allow non-developers to edit translations from the dashboard with hot reload (no redeploy).

Primary language is **Portuguese (`pt`)**, secondary is **English (`en`)**, with support for unlimited additional languages.

## 2. Goals

- **Deterministic resolution**: every translation request resolves to a concrete string or an explicit, logged fallback — never a thrown exception in the hot path.
- **Performance**: hot-path lookups are O(1) from an in-memory/cached compiled bundle. Cold loads hydrate the Cache layer (memory + Redis) with namespaced keys and TTL.
- **Authoring without deploys**: guild admins edit strings via the dashboard; changes invalidate cache and propagate over the Event Bus.
- **Safety**: strict typing of key format and parameters; no `any`; interpolation cannot inject markup into Discord/HTML unintentionally.
- **Observability**: missing-key metrics, per-locale coverage reporting, structured logs.
- **Extensibility**: add a new language by uploading a bundle; add a namespace by registration — no engine changes.

## 3. Architecture

The i18n engine lives in `src/core/i18n`. It follows the strict layer flow and exposes only `TranslationService` (token) plus DTOs/contracts.

```
Caller (Controller / Command / Service / Dashboard)
        │  t('tickets:ui.created', { id }, { guildId, userId })
        ▼
TranslationService (facade, DI singleton)
        │  resolveLocale() ──────────────► LocaleResolver (user → guild → pt → en)
        │  getBundle(locale, namespace) ─► Cache layer (memory + Redis)
        │                                      │ miss
        │                                      ▼
        │                               TranslationLoader
        │                                 ├─ FileBundleSource (defaults, /locales)
        │                                 └─ DbBundleSource ──► TranslationRepository ──► Prisma/MySQL
        │  compile + interpolate ────────► IcuFormatter (ICU MessageFormat)
        │  on miss ──────────────────────► MissingKeyReporter (logs + metrics + event)
        ▼
Rendered string
```

Key design points:

- **`TranslationService`** is the only public surface. It is registered globally (`@Global()` NestJS module) so any module can inject it without importing the i18n module's internals.
- **Bundle precedence** (highest wins): DB guild override → DB global override → File default. Merge happens at compile time and the compiled bundle is cached.
- **`LocaleResolver`** is pure and stateless; it takes a `TranslationContext` and returns an ordered fallback list.
- **`IcuFormatter`** wraps a single ICU MessageFormat implementation; plural/select/number/date formatting are handled here, not by callers.
- **Cache invalidation** is event-driven: a DB write emits `i18n.translation.updated`, which busts the relevant namespaced cache keys across instances via Redis pub/sub (through the Cache layer).

## 4. Folder Structure

```
src/core/i18n/
├── i18n.module.ts                 # @Global() NestJS module, exports TranslationService
├── translation.service.ts         # public facade (implements TranslationService)
├── tokens.ts                      # injection tokens (TRANSLATION_SERVICE, etc.)
├── contracts/
│   ├── translation-service.contract.ts   # abstract class TranslationService
│   ├── translation-context.ts            # TranslationContext, ResolvedLocale
│   └── translation-key.ts                # TranslationKey branded type + parser
├── resolver/
│   └── locale-resolver.ts         # LocaleResolver (fallback chain)
├── loader/
│   ├── translation-loader.ts      # orchestrates file + db sources, merges
│   ├── file-bundle.source.ts      # reads /locales/<locale>/<namespace>.json
│   └── db-bundle.source.ts        # reads DB overrides via repository
├── formatter/
│   └── icu-formatter.ts           # ICU MessageFormat wrapper + interpolation
├── repository/
│   ├── translation.repository.ts          # abstract repository contract
│   └── prisma-translation.repository.ts    # Prisma implementation
├── missing/
│   └── missing-key.reporter.ts    # logging + metrics + event emission
├── dto/
│   ├── upsert-translation.dto.ts
│   ├── translation-query.dto.ts
│   ├── translation.response.dto.ts
│   └── locale.response.dto.ts
├── api/
│   └── translations.controller.ts # REST endpoints (dashboard authoring)
└── events/
    └── i18n.events.ts             # event name constants + payload types

locales/                           # shipped file defaults (not under src/)
├── pt/
│   ├── core.json
│   ├── tickets.json
│   └── moderation.json
└── en/
    ├── core.json
    ├── tickets.json
    └── moderation.json
```

## 5. Public Interfaces

```typescript
// contracts/translation-key.ts
/** Branded string enforcing the `module:namespace.key` shape at the type level. */
export type TranslationKey = string & { readonly __brand: 'TranslationKey' };

export interface ParsedKey {
  readonly module: string;     // e.g. "tickets"
  readonly namespace: string;  // e.g. "ui"
  readonly path: string;       // e.g. "created" or "errors.notFound"
}

export function parseKey(key: TranslationKey): ParsedKey;
export function isTranslationKey(value: string): value is TranslationKey;
```

```typescript
// contracts/translation-context.ts
export type Locale = string; // BCP-47-ish, e.g. "pt", "en", "pt-BR"

export interface TranslationContext {
  readonly guildId?: string;   // multi-guild aware
  readonly userId?: string;    // per-user locale preference
  readonly localeOverride?: Locale; // explicit caller override (highest priority)
}

export interface ResolvedLocale {
  readonly primary: Locale;          // the chosen locale
  readonly chain: readonly Locale[]; // full fallback order actually used
  readonly source: 'override' | 'user' | 'guild' | 'default';
}

/** Interpolation variables. Values are constrained — no `any`. */
export type InterpolationValues = Readonly<
  Record<string, string | number | boolean | Date>
>;
```

```typescript
// contracts/translation-service.contract.ts
export abstract class TranslationService {
  /** Translate a single key. Never throws on missing key — returns fallback. */
  abstract t(
    key: TranslationKey,
    values?: InterpolationValues,
    context?: TranslationContext,
  ): Promise<string>;

  /** Synchronous variant for pre-warmed bundles (throws if bundle not cached). */
  abstract tSync(
    key: TranslationKey,
    values: InterpolationValues | undefined,
    locale: Locale,
  ): string;

  /** Resolve the effective locale + fallback chain for a context. */
  abstract resolveLocale(context: TranslationContext): Promise<ResolvedLocale>;

  /** List supported locales (file defaults ∪ DB-authored). */
  abstract listLocales(): Promise<readonly Locale[]>;

  /** Check whether a key exists in a given locale (no fallback). */
  abstract has(key: TranslationKey, locale: Locale): Promise<boolean>;

  /** Force reload of a namespace bundle (busts cache). */
  abstract invalidate(namespace: string, locale?: Locale): Promise<void>;
}
```

```typescript
// repository/translation.repository.ts
export interface TranslationRecord {
  readonly id: string;
  readonly guildId: string | null; // null = global override
  readonly locale: Locale;
  readonly module: string;
  readonly namespace: string;
  readonly key: string;            // path within namespace
  readonly value: string;          // ICU message string
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
}

export abstract class TranslationRepository {
  abstract findBundle(
    locale: Locale,
    namespace: string,
    guildId: string | null,
  ): Promise<readonly TranslationRecord[]>;

  abstract upsert(record: Omit<TranslationRecord, 'id' | 'updatedAt'>): Promise<TranslationRecord>;

  abstract softDelete(id: string, deletedBy: string): Promise<void>;

  abstract listLocales(): Promise<readonly Locale[]>;

  abstract search(query: {
    guildId: string | null;
    locale?: Locale;
    namespace?: string;
    contains?: string;
    skip: number;
    take: number;
  }): Promise<{ items: readonly TranslationRecord[]; total: number }>;
}
```

## 6. Events

All events are emitted on the core Event Bus. Namespaced as `i18n.*`.

**Emitted:**

```typescript
// events/i18n.events.ts
export const I18N_EVENTS = {
  TranslationUpdated: 'i18n.translation.updated',
  TranslationDeleted: 'i18n.translation.deleted',
  MissingKeyDetected: 'i18n.missingKey.detected',
  LocaleAdded: 'i18n.locale.added',
} as const;

export interface TranslationUpdatedPayload {
  guildId: string | null;
  locale: Locale;
  module: string;
  namespace: string;
  key: string;
  updatedBy: string;
}

export interface MissingKeyPayload {
  key: string;                 // full `module:namespace.key`
  locale: Locale;
  chainTried: readonly Locale[];
  guildId: string | null;
  occurredAt: string;          // ISO timestamp
}

export interface LocaleAddedPayload {
  locale: Locale;
  addedBy: string;
}
```

**Consumed:**

- `i18n.translation.updated` / `i18n.translation.deleted` → internal handler calls `Cache.invalidate(namespacedKey)` for the affected `(guildId, locale, namespace)` so all instances drop stale bundles.
- `guild.deleted` (from core guild lifecycle) → soft-deletes all guild-scoped translation overrides for that guild.

## 7. Dependencies

Relies on **core systems only** — never on other modules directly.

| Core system | Usage |
|-------------|-------|
| **Cache layer** | Compiled bundle storage (memory + Redis), TTL, namespaced keys. Invalidation via cache busting. Never touches Redis directly. |
| **Event Bus** | Emits update/missing-key events; consumes update/delete/guild-deleted to invalidate cache. |
| **Database** | Via `TranslationRepository` (Prisma) only. Stores DB overrides + dashboard-authored strings. |
| **Permissions** | Guards REST authoring endpoints with claims (`i18n.*`). |
| **Config** | Reads `DEFAULT_LOCALE`, `FALLBACK_LOCALE`, cache TTL, missing-key policy (ENV → DB → defaults, Zod-validated). |
| **Logging (Pino)** | Missing-key + audit logs. |
| **Queue (BullMQ)** | Background coverage-report job + bulk import/export jobs. |

No module imports `src/core/i18n/*` internals; they inject `TranslationService` only.

## 8. Configuration

Settings follow the **ENV → Database → Defaults** priority and are validated with Zod.

```typescript
// config schema (registered with core config)
import { z } from 'zod';

export const I18nConfigSchema = z.object({
  defaultLocale: z.string().min(2).default('pt'),
  fallbackLocale: z.string().min(2).default('en'),
  cacheTtlSeconds: z.number().int().positive().default(3600),
  missingKeyPolicy: z.enum(['return-key', 'return-fallback', 'return-empty']).default('return-key'),
  reportMissingKeys: z.boolean().default(true),
  // Per-guild overridable subset:
  enabledLocales: z.array(z.string().min(2)).default(['pt', 'en']),
});

export type I18nConfig = z.infer<typeof I18nConfigSchema>;
```

**Scope:**

- **Global (ENV)**: `DEFAULT_LOCALE`, `FALLBACK_LOCALE`, `I18N_CACHE_TTL`, `I18N_MISSING_KEY_POLICY`.
- **Per-guild (DB)**: `enabledLocales`, `defaultLocale` (guild default may differ from global), `missingKeyPolicy`.
- **Defaults**: `pt` primary, `en` fallback, TTL 3600s, `return-key` on miss.

Guild settings are read through the core Config service (cached); they never bypass it.

## 9. Database

Prisma models. Soft-delete via `deletedAt`. All searchable columns indexed.

```prisma
model Translation {
  id         String    @id @default(cuid())
  guildId    String?   // null = global override
  locale     String    // "pt", "en", "pt-BR", ...
  module     String    // "tickets"
  namespace  String    // "ui"
  key        String    // path within namespace, e.g. "errors.notFound"
  value      String    @db.Text  // ICU message string
  updatedBy  String?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  deletedAt  DateTime?

  guild      Guild?    @relation(fields: [guildId], references: [id], onDelete: Cascade)

  @@unique([guildId, locale, module, namespace, key], name: "uq_translation_scope")
  @@index([locale, module, namespace])
  @@index([guildId, locale])
  @@index([deletedAt])
  @@map("translations")
}

model Locale {
  id          String    @id @default(cuid())
  code        String    @unique  // "pt", "en"
  displayName String    // "Português", "English"
  enabled     Boolean   @default(true)
  isDefault   Boolean   @default(false)
  createdAt   DateTime  @default(now())
  deletedAt   DateTime?

  @@index([enabled])
  @@map("locales")
}

model UserLocalePreference {
  id        String   @id @default(cuid())
  userId    String
  guildId   String?  // optional per-guild preference; null = global preference
  locale    String
  updatedAt DateTime @updatedAt

  @@unique([userId, guildId], name: "uq_user_guild_locale")
  @@index([userId])
  @@map("user_locale_preferences")
}
```

Notes:

- Soft-delete: queries filter `deletedAt: null`. Repository never hard-deletes user content.
- The composite unique key guarantees one value per `(guild, locale, module, namespace, key)`.
- File defaults are **not** stored in DB; only overrides/authored strings are.

## 10. API

REST endpoints for dashboard authoring. Prefix `/api/i18n`. Documented via Swagger/OpenAPI. All guarded by Permissions.

| Method | Path | Description | Claim |
|--------|------|-------------|-------|
| `GET` | `/api/i18n/locales` | List supported/enabled locales | `i18n.read` |
| `GET` | `/api/i18n/translations` | Paginated/searchable list (filter by locale, namespace, contains, guildId) | `i18n.read` |
| `GET` | `/api/i18n/translations/:id` | Fetch one record | `i18n.read` |
| `PUT` | `/api/i18n/translations` | Upsert a translation override | `i18n.edit` |
| `DELETE` | `/api/i18n/translations/:id` | Soft-delete an override | `i18n.edit` |
| `POST` | `/api/i18n/import` | Bulk import a bundle (queued job) | `i18n.manage` |
| `GET` | `/api/i18n/export` | Export bundle as JSON | `i18n.read` |
| `GET` | `/api/i18n/coverage` | Per-locale coverage + missing-key report | `i18n.read` |

```typescript
// dto/upsert-translation.dto.ts
import { z } from 'zod';

export const UpsertTranslationSchema = z.object({
  guildId: z.string().nullable(),
  locale: z.string().min(2),
  module: z.string().min(1),
  namespace: z.string().min(1),
  key: z.string().min(1),
  value: z.string().min(1), // validated as compilable ICU before persist
});
export type UpsertTranslationDto = z.infer<typeof UpsertTranslationSchema>;
```

```typescript
// dto/translation-query.dto.ts
export const TranslationQuerySchema = z.object({
  guildId: z.string().nullable().optional(),
  locale: z.string().min(2).optional(),
  namespace: z.string().optional(),
  contains: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type TranslationQueryDto = z.infer<typeof TranslationQuerySchema>;
```

```typescript
// dto/translation.response.dto.ts
export interface TranslationResponseDto {
  id: string;
  guildId: string | null;
  locale: string;
  module: string;
  namespace: string;
  key: string;
  value: string;
  updatedBy: string | null;
  updatedAt: string; // ISO
}

export interface PaginatedTranslationsDto {
  items: TranslationResponseDto[];
  total: number;
  page: number;
  pageSize: number;
}
```

The `PUT` endpoint validates `value` compiles as ICU (rejects malformed plural/select syntax) before persisting, then emits `i18n.translation.updated`.

## 11. Permissions

Claims defined by this unit (wildcard `i18n.*` groups them):

| Claim | Grants |
|-------|--------|
| `i18n.read` | View locales, translations, coverage, export |
| `i18n.edit` | Upsert and soft-delete translation overrides |
| `i18n.manage` | Bulk import, enable/disable locales, set guild default locale |
| `i18n.*` | All of the above |

Permission checks are guild-aware: editing a guild-scoped override requires the claim **in that guild**. Editing global overrides (`guildId = null`) requires a platform-level grant.

## 12. Logging

Structured Pino logs, categorized:

- **`i18n.missing`** (warn): every missing key — `{ key, locale, chainTried, guildId }`. Deduplicated within a short window to avoid log floods; also incremented as a Prometheus counter `i18n_missing_keys_total{locale,namespace}`.
- **`i18n.icu.error`** (error): ICU compile/format failure at render time — falls back to raw key, never throws to caller.
- **`i18n.audit`** (info): every upsert/delete/import via the dashboard — `{ actor, guildId, locale, key, before?, after }`. Hooks into the core audit log.
- **`i18n.cache`** (debug): bundle load source (file/db/cache), hit/miss, invalidation events.

Audit hooks: `i18n.edit` and `i18n.manage` operations produce an immutable audit entry consumed by the core audit subsystem.

## 13. Testing

**Unit (Vitest):**

- `parseKey` / `isTranslationKey`: valid and malformed key shapes.
- `LocaleResolver`: every fallback path — override → user → guild → `pt` → `en`; missing user pref; disabled guild locale.
- `IcuFormatter`: variable interpolation, plural categories (`one`/`other` for EN, `one`/`many`/`other` for PT), select, nested args, date/number formatting, malformed message handling.
- `TranslationLoader`: file+DB merge precedence (guild override beats global beats file).
- `MissingKeyReporter`: dedup window, metric increment, event emission, policy outcomes (`return-key`/`return-fallback`/`return-empty`).

**Integration:**

- Repository upsert/soft-delete/search against a test MySQL (Prisma) with the composite unique constraint.
- Cache invalidation: update → event → cache bust → next read reflects new value.

**E2E (Playwright):**

- Dashboard: edit a string, save, see it reflected in a bot response without redeploy.
- Coverage page renders missing-key report.

Coverage target: 100% of `LocaleResolver`, `IcuFormatter`, and `MissingKeyReporter` branches.

## 14. Dashboard Integration

The dashboard exposes a **Translations** section:

- **Locale switcher + matrix**: rows = keys, columns = enabled locales; inline-editable cells with live ICU preview.
- **Search & filter**: by namespace, key, or value substring (server-side paginated via `GET /api/i18n/translations`).
- **Missing-key panel**: surfaces `i18n.missingKey.detected` reports and `/coverage` data; one-click "create translation" from a missing key.
- **Import/Export**: upload/download JSON bundles (queued via BullMQ for large files).
- **Guild scope toggle**: edit global vs guild-specific overrides (respecting `i18n.manage` for globals).
- **Validation**: client + server reject malformed ICU before save.

All dashboard writes flow through the REST API and the Permissions guard; no direct DB or cache access.

## 15. Future Extensions

- **Machine-translation assist**: suggest translations for missing keys via a pluggable provider (behind a port interface).
- **Translation memory / glossary**: enforce consistent terminology across keys.
- **Per-channel locale overrides** (beyond user/guild).
- **CLDR-driven locale metadata** (RTL flags, number/date patterns) auto-loaded.
- **In-Discord locale picker** command for end users.
- **Version history / rollback** for edited strings.
- **Pluralization linting** at CI: flag keys missing required plural categories per locale.

## 16. Tasks for Claude

Execute in order; each phase is a separate Conventional-Commit branch under `feature/i18n/`.

1. **Phase 1 — Schema**: add `Translation`, `Locale`, `UserLocalePreference` Prisma models; create migration; seed `pt`/`en` locale rows.
2. **Phase 2 — Contracts & types**: `TranslationKey` brand + parser, `TranslationContext`, `ResolvedLocale`, `TranslationService` abstract class, repository contract.
3. **Phase 3 — Repository**: `PrismaTranslationRepository` (findBundle, upsert, softDelete, search, listLocales) with soft-delete filtering.
4. **Phase 4 — Loader & formatter**: `FileBundleSource`, `DbBundleSource`, `TranslationLoader` merge logic, `IcuFormatter`.
5. **Phase 5 — Resolver & service**: `LocaleResolver` fallback chain, `TranslationService` facade with Cache integration and `tSync`.
6. **Phase 6 — Events**: emit/consume update/delete; cache invalidation handler; `MissingKeyReporter` (logs + metrics + event).
7. **Phase 7 — Config**: register `I18nConfigSchema` with core config (ENV → DB → defaults).
8. **Phase 8 — Commands**: optional `/locale set <language>` user preference command (writes `UserLocalePreference`).
9. **Phase 9 — Dashboard + API**: DTOs, `TranslationsController`, Permissions guards, import/export jobs.
10. **Phase 10 — Tests**: unit + integration + e2e per section 13.
11. **Phase 11 — Docs**: update module READMEs and Swagger; document key conventions.

## 17. Acceptance Criteria

- [ ] `t('core:ui.greeting', { name }, { guildId, userId })` returns the correct localized string per the fallback chain.
- [ ] Missing key returns per `missingKeyPolicy`, never throws, and is logged + metered + evented.
- [ ] ICU plurals render correctly for both `pt` and `en` (distinct categories).
- [ ] Guild override beats global override beats file default for the same key.
- [ ] Editing a string in the dashboard reflects in bot output within one cache TTL window (or immediately after invalidation event).
- [ ] User locale preference overrides guild default; guild default overrides global default.
- [ ] Adding a new locale (file or DB) requires no engine code change.
- [ ] All authoring endpoints enforce `i18n.read` / `i18n.edit` / `i18n.manage` claims, guild-aware.
- [ ] No module imports i18n internals; all use injected `TranslationService`.
- [ ] No `any` in the codebase; ESLint/Prettier clean.

## 18. Definition of Done

- [ ] All Vitest unit + integration tests pass; Playwright e2e for dashboard editing passes; coverage targets met.
- [ ] Prisma migration created, reviewed, and runs cleanly on a fresh DB.
- [ ] Zod config schema registered and validated at boot.
- [ ] Swagger/OpenAPI documents all `/api/i18n/*` endpoints with DTOs.
- [ ] Prometheus metric `i18n_missing_keys_total` exported; logs categorized.
- [ ] Documentation written (this file + module READMEs) and key-format convention published.
- [ ] ESLint/Prettier/Commitlint/Husky pass; no `any`; methods within size guidance.
- [ ] PR opened against `develop` (no direct commits to `main`), Conventional Commits, green CI.
- [ ] Cache invalidation verified across multiple instances via Redis pub/sub.
