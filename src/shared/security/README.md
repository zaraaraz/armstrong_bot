# `@shared/security`

Cross-cutting security layer for Ghost Bot. Modules **consume** these guards,
interceptors and services — they never re-implement rate limiting, encryption
or input validation. Spec: [`docs/architecture/10-security.md`](../../../docs/architecture/10-security.md).

## What's here

| Area | Files |
|---|---|
| **Encryption** | `services/encryption.service.ts` — AES-256-GCM (`iv:tag:ciphertext` base64) + secret hashing/verify |
| **Secrets** | `services/secret.service.ts` + `vault/env-secret.provider.ts` (pluggable `SECRET_PROVIDER`) |
| **Rate limiting** | `services/rate-limit.service.ts` (Redis sliding window) + `guards/rate-limit.guard.ts` + `@RateLimit` |
| **Cooldowns** | `services/cooldown.service.ts` + `@Cooldown` |
| **Sanitisation** | `services/sanitizer.service.ts` + `interceptors/sanitization.interceptor.ts` |
| **API keys** | `services/api-key.service.ts`, `repositories/api-key.*`, `guards/api-key.guard.ts`, `api/api-key.controller.ts` |
| **Config** | `schemas/security-config.schema.ts`, `services/security-config.service.ts`, `api/security-config.controller.ts` |
| **Audit/redaction** | `interceptors/audit.interceptor.ts`, `services/redaction.serializer.ts` |
| **Events** | publishes `security.*` via the Event Bus (see `security.events.ts`) |

## Decisions / divergences from the spec

- **Hashing uses Node `scrypt`, not Argon2id.** `argon2` is a native dependency
  not present in this repo; `scrypt` is built into Node and gives strong
  password/API-key hashing. The `hash`/`verify` contract is identical, so the
  implementation can be swapped (`EncryptionService`) without touching callers.
- **Validation uses Zod, not class-validator.** Matches the rest of the codebase
  (DTOs are Zod schemas parsed in the handler).
- **Master key**: a base64 32-byte key in `GHOST_MASTER_KEY` (env name
  overridable via `GHOST_MASTER_KEY_ENV`). With no key configured the service
  boots with an ephemeral key and logs a loud warning — encrypted data will not
  survive a restart. Set the key in any real environment.
- **Redaction list** (`REDACTED_KEYS`): `password`, `token`, `rconPassword`,
  `authorization`, `apiKey`, `hashedKey`, `secret` (case-insensitive).

## Deferred (Phase 3 — API & Dashboard)

- Dashboard pages (API-key management, settings editor, `security.*` feed).
- Playwright e2e (CSRF, secure session, CORS rejection).
- `AuditInterceptor` currently logs a redacted trail; it will publish `audit.*`
  events once the Audit module (Phase 4) registers them in `GhostEventMap`.

## Usage

```ts
// Rate-limit a route: 5 requests / 60s per IP, 5-minute block on abuse.
@RateLimit({ points: 5, duration: 60, by: 'ip', blockFor: 300 })
@UseGuards(RateLimitGuard)
@Post('login')
login() { /* ... */ }

// Encrypt a field at rest.
const stored = encryptionService.encrypt(rconPassword);
const plain = encryptionService.decrypt(stored);
```
