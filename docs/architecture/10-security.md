# Security

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields. Support pagination, caching, translations, dashboard.
> - Security code is cross-cutting: expose it as `@shared/security` guards, interceptors and
>   services. Modules consume it — they never re-implement rate limiting, encryption or validation.

---

## 1. Purpose

Define the cross-cutting security layer for Ghost Bot: every command, REST request, WebSocket
message, webhook and job must pass through a consistent set of protections. Security is **not** a
module that owns a domain — it is a set of guards, interceptors, services and conventions that the
core and every module rely on.

The guiding rule from `00-project.md`: **never trust user input**, and **never leak internals**.

---

## 2. Goals

- Rate limiting and per-action cooldowns for commands and API.
- Centralised secret management (ENV + pluggable vault) — secrets never logged.
- Encryption at rest for sensitive fields (RCON passwords, API keys, tokens, OAuth refresh tokens).
- Input validation and sanitisation everywhere (Zod + class-validator).
- A tamper-evident audit trail (delegated to the Audit module via the Event Bus).
- Anti-abuse: brute force, credential stuffing, command flooding.
- Hardened dashboard: CSRF, secure sessions, strict CORS.
- Dependency and image scanning in CI.
- A documented threat model with concrete mitigations.

---

## 3. Architecture

Security is layered as guards/interceptors (request edge) + services (reusable logic):

```
Request (command / REST / WS / webhook)
        │
        ▼
[ RateLimitGuard ] ── Redis sliding window
        │
        ▼
[ AuthGuard ] ── session / API key / JWT
        │
        ▼
[ PermissionGuard ] ── claim check (see 05-permissions)
        │
        ▼
[ ValidationPipe ] ── Zod / class-validator on DTOs
        │
        ▼
[ SanitizationInterceptor ] ── strip / escape dangerous content
        │
        ▼
   Application Service
        │
        ▼
[ AuditInterceptor ] ── publishes audit.* events
```

Encryption and secrets are accessed only through `EncryptionService` and `SecretService`.
No service reads `process.env` directly for secrets — it goes through `SecretService`.

---

## 4. Folder Structure

```
src/shared/security/
├── security.module.ts
├── guards/
│   ├── rate-limit.guard.ts
│   ├── auth.guard.ts
│   ├── api-key.guard.ts
│   └── permission.guard.ts        # re-exported from permissions
├── interceptors/
│   ├── sanitization.interceptor.ts
│   └── audit.interceptor.ts
├── services/
│   ├── rate-limit.service.ts
│   ├── cooldown.service.ts
│   ├── encryption.service.ts
│   ├── secret.service.ts
│   └── sanitizer.service.ts
├── decorators/
│   ├── rate-limit.decorator.ts    # @RateLimit({ points, duration })
│   ├── cooldown.decorator.ts      # @Cooldown(5)
│   └── encrypted.decorator.ts     # field-level Prisma extension marker
├── vault/
│   ├── secret-provider.interface.ts
│   ├── env-secret.provider.ts
│   └── vault-secret.provider.ts   # HashiCorp Vault / AWS SM (future)
└── interfaces/
    └── security.interfaces.ts
```

---

## 5. Public Interfaces

```ts
export interface RateLimitOptions {
  /** Allowed actions within the window. */
  points: number;
  /** Window length in seconds. */
  duration: number;
  /** Key derivation strategy. */
  by: 'user' | 'guild' | 'ip' | 'api-key' | 'global';
  /** Optional block duration after exhaustion (seconds). */
  blockFor?: number;
}

export interface RateLimitService {
  consume(key: string, options: RateLimitOptions): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface CooldownService {
  check(scope: string, userId: string, seconds: number): Promise<number>; // 0 = ready, else ms left
  start(scope: string, userId: string, seconds: number): Promise<void>;
}

export interface EncryptionService {
  /** AES-256-GCM. Returns base64 `iv:tag:ciphertext`. */
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
  /** Argon2id for passwords / API key hashing. */
  hash(secret: string): Promise<string>;
  verify(secret: string, hash: string): Promise<boolean>;
}

export interface SecretProvider {
  get(name: string): Promise<string | undefined>;
  require(name: string): Promise<string>;
}

export interface Sanitizer {
  stripMentions(input: string): string;
  escapeMarkdown(input: string): string;
  sanitizeHtml(input: string): string;
  sanitizeFilename(input: string): string;
}
```

---

## 6. Events

Emitted (consumed by the Audit + Logs modules):

| Event | Payload | When |
|---|---|---|
| `security.rate_limit.exceeded` | `{ key, by, route, guildId? }` | A subject hits a limit |
| `security.auth.failed` | `{ method, reason, ip?, userId? }` | Bad credentials / session |
| `security.permission.denied` | `{ userId, guildId, claim, route }` | Claim check fails |
| `security.secret.accessed` | `{ name, actor }` | Sensitive secret read (debug/audit) |
| `security.encryption.key_rotated` | `{ keyId, at }` | Master key rotation |

Consumed: none directly — security sits at the request edge.

---

## 7. Dependencies

- **Cache** — Redis sliding-window counters for rate limiting and cooldowns.
- **Events** — publishes `security.*` for Audit/Logs; never imports them.
- **Permissions** — `PermissionGuard` delegates to `PermissionService.can()`.
- **Database** — only via repositories, for stored API keys / encrypted fields.
- **Config** — reads validated config; secrets through `SecretService`.

Never depends on a feature module.

---

## 8. Configuration

Global + guild-scoped, Zod-validated:

```ts
export const SecurityConfigSchema = z.object({
  rateLimit: z.object({
    commands: z.object({ points: z.number().default(20), duration: z.number().default(60) }),
    api:      z.object({ points: z.number().default(120), duration: z.number().default(60) }),
  }),
  encryption: z.object({
    masterKeyEnv: z.string().default('GHOST_MASTER_KEY'), // 32-byte base64
    rotationDays: z.number().default(90),
  }),
  session: z.object({
    secureCookies: z.boolean().default(true),
    sameSite: z.enum(['strict', 'lax']).default('lax'),
    maxAgeHours: z.number().default(168),
  }),
  cors: z.object({ origins: z.array(z.string().url()).default([]) }),
});
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
```

Priority follows the contract: **ENV → Database → Defaults**.

---

## 9. Database

```prisma
model ApiKey {
  id          String    @id @default(cuid())
  guildId     String?
  name        String
  hashedKey   String    @unique          // argon2id hash, never the raw key
  prefix      String                      // first 8 chars for display
  scopes      String                      // CSV of claims granted
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())

  @@index([guildId])
  @@index([prefix])
}

model EncryptionKey {
  id        String   @id @default(cuid())
  keyId     String   @unique
  state     KeyState @default(ACTIVE)     // ACTIVE | RETIRING | RETIRED
  createdAt DateTime @default(now())
}

enum KeyState { ACTIVE RETIRING RETIRED }
```

Encrypted fields across the app (e.g. `FiveMServer.rconPassword`) store the
`EncryptionService.encrypt()` output. Soft-deletes via `revokedAt` for keys.

---

## 10. API

| Method | Path | Claim | Description |
|---|---|---|---|
| `GET` | `/api/v1/guilds/:id/api-keys` | `security.apikeys.read` | List keys (prefixes only) |
| `POST` | `/api/v1/guilds/:id/api-keys` | `security.apikeys.create` | Create key (raw shown once) |
| `DELETE` | `/api/v1/guilds/:id/api-keys/:keyId` | `security.apikeys.revoke` | Revoke key |
| `GET` | `/api/v1/guilds/:id/security/config` | `security.config.read` | Read settings |
| `PATCH` | `/api/v1/guilds/:id/security/config` | `security.config.write` | Update settings |

```ts
export class CreateApiKeyDto {
  @IsString() @MaxLength(64) name!: string;
  @IsArray() @ArrayMaxSize(50) scopes!: string[];
  @IsOptional() @IsISO8601() expiresAt?: string;
}
```

All endpoints documented in Swagger. Rate-limited via `@RateLimit`.

---

## 11. Permissions

```
security.*
security.config.read
security.config.write
security.apikeys.read
security.apikeys.create
security.apikeys.revoke
```

---

## 12. Logging

- Auth failures, permission denials and rate-limit hits logged at `warn` with correlation IDs.
- Secrets and raw API keys are **never** logged — a redaction serializer scrubs known keys
  (`password`, `token`, `rconPassword`, `authorization`, `apiKey`).
- Every state-changing action passes through `AuditInterceptor` → `audit.*` events.

---

## 13. Testing

- **Unit**: rate-limit sliding window math, encryption round-trip, sanitizer edge cases,
  redaction serializer.
- **Integration**: guards reject unauthenticated/over-limit requests; API key lifecycle.
- **e2e**: dashboard CSRF + session hardening (Playwright); CORS rejection.
- Negative tests are mandatory — prove that bad input is rejected, not only that good input passes.

---

## 14. Dashboard Integration

- API key management page (create/list/revoke; raw key shown once).
- Security settings editor (rate limits, session, CORS).
- Read-only feed of recent `security.*` events (sourced from Audit).

---

## 15. Future Extensions

- HashiCorp Vault / AWS Secrets Manager provider.
- Hardware-backed key storage (KMS) and automated key rotation jobs.
- Anomaly detection on command patterns.
- WebAuthn / 2FA for dashboard admins.

---

## 16. Tasks for Claude

1. **Phase 1 — Schema**: `ApiKey`, `EncryptionKey` models + migration.
2. **Phase 2 — Services**: `EncryptionService`, `SecretService` (+ providers), `RateLimitService`,
   `CooldownService`, `Sanitizer`.
3. **Phase 3 — Guards/Interceptors**: rate-limit, auth, api-key, sanitization, audit.
4. **Phase 4 — Decorators**: `@RateLimit`, `@Cooldown`, `@Encrypted`.
5. **Phase 5 — API**: API key + security config controllers + DTOs + Swagger.
6. **Phase 6 — Dashboard**: pages described above.
7. **Phase 7 — Tests**: unit + integration + e2e (incl. negative cases).
8. **Phase 8 — Docs**: redaction list, threat model appendix, rotation runbook.

---

## 17. Acceptance Criteria

- [ ] Over-limit requests receive `429` with `Retry-After`.
- [ ] Encrypted fields are unreadable in the DB and round-trip correctly.
- [ ] No secret ever appears in logs (verified by a redaction test).
- [ ] API keys are stored only as Argon2id hashes; raw key shown once.
- [ ] All DTOs validated; invalid input rejected with a safe error envelope.
- [ ] CSRF + secure session enforced on the dashboard.

---

## 18. Definition of Done

- [ ] Migrations created and applied.
- [ ] Unit + integration + e2e tests pass; negative tests included.
- [ ] Lint/type-check clean, no `any`.
- [ ] Swagger updated.
- [ ] Threat model documented.
- [ ] PR opened into `develop` with the checklist completed.
