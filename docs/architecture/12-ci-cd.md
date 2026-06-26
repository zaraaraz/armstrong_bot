# CI/CD

> ## Claude Instructions
> - Never modify another module or change architecture decisions from `00-project.md`. CI/CD is cross-cutting infrastructure — it orchestrates the build/test/deploy of the whole monorepo but owns no business logic.
> - Keep backwards compatibility. Pipelines must never break `develop`/`main`. Every workflow change is additive or gated behind a feature flag in the workflow itself.
> - Create Prisma migrations through the pipeline only — `prisma migrate deploy` runs on deploy, never `migrate dev` in CI. Generate tests and docs for any tooling scripts you add under `scripts/`.
> - No `any`. Keep tooling scripts in strict TypeScript, methods small (<50 lines where reasonable). Follow existing naming.
> - All config is Zod-validated. Secrets come from GitHub Encrypted Secrets / OIDC — never hardcode. Use the Repository Pattern and Cache layer if any script touches the DB or Redis (it should not, except migrations).
> - Required checks must be green before merge. Conventional Commits enforced by Commitlint. semantic-release owns versioning — never bump versions by hand.

---

## 1. Purpose

Define the **continuous integration and continuous deployment** system for Ghost Bot: a fully automated, GitHub Actions–driven pipeline that takes every push and pull request through `lint -> typecheck -> test -> build -> docker -> deploy`, enforces branch protections and Conventional Commits, versions releases with semantic-release, builds reproducible multi-stage Docker images, and deploys to **staging** and **production** with database migrations, health-gated rollout, and automatic rollback.

This document is the single source of truth for:
- The shape and ordering of all GitHub Actions workflows.
- Required status checks and branch-protection rules.
- The Docker multi-stage build and Docker Compose local environment.
- The deploy strategy, migration execution, rollback, and observability hooks.

## 2. Goals

- **Fast feedback**: lint + typecheck + unit tests complete in under 5 minutes on PRs via caching and parallel jobs.
- **Deterministic builds**: pinned Node LTS, locked dependencies (`npm ci`), reproducible Docker layers.
- **No broken trunk**: `develop` and `main` are protected; merges require green required checks and a passing review.
- **Automated versioning & changelog**: semantic-release derives the version from Conventional Commits, tags, and publishes the changelog + GitHub Release.
- **Zero-downtime deploys**: rolling/health-gated deploy to staging on `develop`, to production on `main` (release tag), with migrations applied safely and rollback on failed health checks.
- **Observability built in**: every deploy emits OpenTelemetry deploy markers and Prometheus annotations; failures notify the team via the Event Bus → notifications path.
- **Security**: SBOM + image scan (Trivy), dependency audit, OIDC-based cloud auth (no long-lived secrets).

## 3. Architecture

The pipeline is **event-driven on Git events** and mirrors the runtime layering philosophy (strict, one-directional flow) at the ops level:

```
Git push / PR
   │
   ▼
[ci.yml]  validate ──► lint ──► typecheck ──► test (unit+integration) ──► build
   │                                                          │
   │                                                          ▼
   │                                              [docker.yml] build & scan image
   │                                                          │
   ▼                                                          ▼
[release.yml] semantic-release (main only) ──► tag + changelog + GH Release
                                                              │
                                                              ▼
                          [deploy.yml] migrate ──► deploy ──► health-gate ──► (rollback?)
                                                              │
                                                              ▼
                                          OTel deploy marker + notification event
```

Key principles:
- **One pipeline, composable jobs.** Reusable workflows (`workflow_call`) keep `ci.yml`, `docker.yml`, `deploy.yml` DRY.
- **Trigger matrix**: `feature/*` & `bugfix/*` → CI only. `develop` → CI + deploy to **staging**. `main` → CI + release + deploy to **production**.
- **Migrations are deploy-time, not CI-time.** CI validates schema (`prisma validate` + drift check); only `deploy.yml` runs `prisma migrate deploy`.
- **Single deploy entrypoint** (`scripts/deploy/*.ts`) so logic is testable in strict TS rather than buried in YAML.

## 4. Folder Structure

A real tree of the CI/CD-owned paths (workflows live at repo root per GitHub requirement; logic lives in `scripts/`).

```
.
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                 # lint -> typecheck -> test -> build (PRs + pushes)
│   │   ├── docker.yml             # reusable: multi-stage build + Trivy scan + push
│   │   ├── release.yml            # semantic-release on main
│   │   ├── deploy.yml             # reusable: migrate -> deploy -> health-gate -> rollback
│   │   ├── deploy-staging.yml     # trigger deploy.yml for develop
│   │   ├── deploy-prod.yml        # trigger deploy.yml for release tags
│   │   └── codeql.yml             # scheduled security analysis
│   ├── actions/
│   │   └── setup-node-cache/      # composite action: checkout + node + npm cache
│   │       └── action.yml
│   ├── CODEOWNERS
│   └── pull_request_template.md
├── scripts/
│   └── ci/
│       ├── deploy.ts              # strict-TS deploy orchestrator (calls migrate, health)
│       ├── health-check.ts        # polls /health + /ready, returns typed result
│       ├── rollback.ts            # reverts to previous image tag
│       ├── ci-config.ts           # Zod-validated CI env schema
│       └── notify.ts              # emits deploy events via the Event Bus client
├── docker/
│   ├── Dockerfile                 # multi-stage: deps -> build -> runtime
│   ├── docker-compose.yml         # local: app + mysql + redis + otel-collector
│   ├── docker-compose.ci.yml      # ephemeral services for integration tests
│   └── .dockerignore
├── .releaserc.json                # semantic-release config
├── commitlint.config.cjs          # Conventional Commits rules
└── .husky/
    ├── pre-commit                 # lint-staged
    ├── commit-msg                 # commitlint
    └── pre-push                   # typecheck + affected unit tests
```

## 5. Public Interfaces

CI/CD exposes no Discord-facing API. Its "public interface" is the strict-TS contract for the deploy tooling under `scripts/ci/`, consumed only by the workflows.

```typescript
/** Deployment target environments. */
export type DeployEnvironment = 'staging' | 'production';

/** Result of a single deploy stage, never throws upward — always typed. */
export interface StageResult {
  readonly stage: 'migrate' | 'deploy' | 'health' | 'rollback';
  readonly success: boolean;
  readonly durationMs: number;
  readonly message: string;
}

/** Immutable context passed to every deploy stage. */
export interface DeployContext {
  readonly environment: DeployEnvironment;
  readonly imageTag: string;
  readonly previousImageTag: string | null;
  readonly gitSha: string;
  readonly releaseVersion: string;
  readonly traceId: string;
}

/** Health probe outcome. */
export interface HealthReport {
  readonly healthy: boolean;
  readonly checkedAt: string;       // ISO-8601
  readonly attempts: number;
  readonly failedProbes: ReadonlyArray<string>;
}

/** Orchestrates an ordered deploy; rolls back on failure. */
export abstract class DeployOrchestrator {
  abstract migrate(ctx: DeployContext): Promise<StageResult>;
  abstract deploy(ctx: DeployContext): Promise<StageResult>;
  abstract verifyHealth(ctx: DeployContext): Promise<HealthReport>;
  abstract rollback(ctx: DeployContext): Promise<StageResult>;
  /** Runs the full sequence and returns the ordered stage results. */
  abstract run(ctx: DeployContext): Promise<ReadonlyArray<StageResult>>;
}

/** Health checker abstraction (DI-friendly, no global fetch coupling). */
export interface HealthChecker {
  probe(baseUrl: string, maxAttempts: number, intervalMs: number): Promise<HealthReport>;
}
```

## 6. Events

CI/CD does not participate in the runtime domain Event Bus directly during a build, but `scripts/ci/notify.ts` publishes **deploy lifecycle events** onto the platform's notification topic (via an authenticated webhook to the running bot's internal events ingress) so the bot can announce releases and ops can correlate incidents.

**Emitted** (published by the pipeline):

```typescript
export interface DeployStartedEvent {
  readonly type: 'ci.deploy.started';
  readonly environment: DeployEnvironment;
  readonly version: string;
  readonly gitSha: string;
  readonly traceId: string;
  readonly at: string;              // ISO-8601
}

export interface DeploySucceededEvent {
  readonly type: 'ci.deploy.succeeded';
  readonly environment: DeployEnvironment;
  readonly version: string;
  readonly durationMs: number;
  readonly traceId: string;
}

export interface DeployFailedEvent {
  readonly type: 'ci.deploy.failed';
  readonly environment: DeployEnvironment;
  readonly version: string;
  readonly failedStage: StageResult['stage'];
  readonly rolledBack: boolean;
  readonly traceId: string;
}
```

**Consumed**: none at build time. The runtime `notifications` module consumes the above via its public contract to post to a Discord ops channel — CI/CD never imports that module, it only emits over the published ingress contract.

## 7. Dependencies

CI/CD relies on **infrastructure and CORE systems**, never on feature modules:

| Core system | Usage in CI/CD |
|-------------|----------------|
| **Database** | `prisma migrate deploy` at deploy-time; `prisma validate` + drift detection at CI-time. Never reads/writes domain data. |
| **Queue (BullMQ)** | Not used directly. Deploy verifies workers boot via health probe. |
| **Cache** | Not used. Health probe confirms Redis reachability through `/ready`. |
| **Events** | Emits deploy lifecycle events through the published notification ingress contract only. |
| **Permissions** | N/A at pipeline level; GitHub `environments` provide deploy gating/approvals instead. |
| **Config** | `scripts/ci/ci-config.ts` reads ENV (GitHub secrets), validates with Zod. Same ENV → Database → Defaults precedence applies at runtime, but CI only supplies ENV. |

External services: GitHub Actions runners, GitHub Container Registry (GHCR), the target deploy platform (e.g. SSH host / Kubernetes / Fly), Trivy, Codecov (optional).

## 8. Configuration

All CI environment input is validated with Zod at the start of every deploy script. Secrets are injected by GitHub; defaults apply only where safe.

```typescript
import { z } from 'zod';

/** Validated CI/deploy environment. Fails fast on missing required secrets. */
export const ciConfigSchema = z.object({
  NODE_ENV: z.enum(['test', 'staging', 'production']).default('test'),
  DEPLOY_ENVIRONMENT: z.enum(['staging', 'production']),
  IMAGE_REGISTRY: z.string().default('ghcr.io/ghost-bot'),
  IMAGE_TAG: z.string().min(1),
  PREVIOUS_IMAGE_TAG: z.string().min(1).nullable().default(null),
  DATABASE_URL: z.string().url(),
  DEPLOY_HOST: z.string().min(1),
  HEALTH_URL: z.string().url(),
  HEALTH_MAX_ATTEMPTS: z.coerce.number().int().positive().default(30),
  HEALTH_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  NOTIFY_INGRESS_URL: z.string().url(),
  NOTIFY_INGRESS_TOKEN: z.string().min(1),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});

export type CiConfig = z.infer<typeof ciConfigSchema>;

export function loadCiConfig(env: NodeJS.ProcessEnv): CiConfig {
  return ciConfigSchema.parse(env);
}
```

**Global settings** (repo-level): registry namespace, default Node version (matrix), required-checks list, protected branches, semantic-release branches.

**Per-environment settings** (GitHub Environments `staging` / `production`): `DATABASE_URL`, `DEPLOY_HOST`, `HEALTH_URL`, approval reviewers (production requires manual approval), wait timer.

There are no **guild-scoped** settings — CI/CD is global infrastructure (N/A by design; the bot it deploys is guild-aware at runtime).

## 9. Database

CI/CD defines **no Prisma models**. Its only DB interaction is migration execution. To make deploy auditable, a single lightweight model records deployment history (owned here because it is purely an ops concern, surfaced read-only on the dashboard).

```prisma
model DeploymentRecord {
  id            String            @id @default(cuid())
  environment   DeploymentEnv
  version       String
  gitSha        String            @db.VarChar(40)
  imageTag      String
  status        DeploymentStatus
  durationMs    Int
  rolledBack    Boolean           @default(false)
  traceId       String
  startedAt     DateTime
  finishedAt    DateTime?
  createdAt     DateTime          @default(now())

  @@index([environment, createdAt])
  @@index([version])
  @@index([gitSha])
  @@map("deployment_records")
}

enum DeploymentEnv {
  STAGING
  PRODUCTION
}

enum DeploymentStatus {
  STARTED
  SUCCEEDED
  FAILED
  ROLLED_BACK
}
```

- **Indexes**: `(environment, createdAt)` for the dashboard timeline; `version` and `gitSha` for lookups.
- **Soft-delete**: not applicable — deployment records are immutable audit history and never deleted.
- **Migrations**: applied via `prisma migrate deploy` in `deploy.yml`; CI verifies no drift with `prisma migrate diff --exit-code`.

## 10. API

CI/CD exposes a small **read-only** REST surface (served by the runtime `api` layer, controller → application service → repository) so the dashboard can show deploy history. The pipeline itself only *writes* via the notification ingress.

| Method | Path | DTO | Notes |
|--------|------|-----|-------|
| `GET` | `/api/v1/ops/deployments` | `DeploymentListQueryDto` → `Paginated<DeploymentRecordDto>` | Paginated, filter by `environment`, `status`. Cached (namespaced, 30s TTL). |
| `GET` | `/api/v1/ops/deployments/:id` | `DeploymentRecordDto` | Single record. |
| `POST` | `/internal/ingress/deploy-events` | `DeployEventDto` | Internal-only, token-auth. Receives the events from §6. Not in public Swagger. |

```typescript
export class DeploymentListQueryDto {
  readonly environment?: 'staging' | 'production';
  readonly status?: 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'ROLLED_BACK';
  readonly page: number = 1;
  readonly pageSize: number = 20;
}

export class DeploymentRecordDto {
  readonly id!: string;
  readonly environment!: 'staging' | 'production';
  readonly version!: string;
  readonly gitSha!: string;
  readonly status!: 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'ROLLED_BACK';
  readonly durationMs!: number;
  readonly rolledBack!: boolean;
  readonly startedAt!: string;
  readonly finishedAt!: string | null;
}
```

Swagger: the public endpoints are tagged `Ops / Deployments`. The ingress endpoint is excluded from the public OpenAPI doc and protected by a bearer token (`NOTIFY_INGRESS_TOKEN`).

## 11. Permissions

CI/CD defines the following wildcard permission claims for the **dashboard/API** read surface (the pipeline itself is gated by GitHub, not by the bot's permission system):

- `ops.deployments.read` — view deployment history and details.
- `ops.deployments.*` — full ops-deployment access (currently read-only, reserved for future re-deploy/rollback triggers).

These follow the platform's wildcard/group/inheritance model. Pipeline execution authorization is handled by **GitHub Environments protection rules** (required reviewers for `production`) — not by Ghost Bot permissions.

## 12. Logging

- **Pipeline logs**: GitHub Actions step logs, structured where scripts emit JSON. `scripts/ci/*.ts` use Pino with category `ci.deploy` and include `traceId`, `environment`, `version`, `stage`.
- **Log categories**: `ci.build`, `ci.test`, `ci.docker`, `ci.deploy`, `ci.rollback`.
- **Audit hooks**: every deploy writes a `DeploymentRecord` (audit trail) and emits `ci.deploy.*` events (§6). Production approvals are recorded by GitHub's environment audit log.
- **Never leak internals**: deploy failure notifications use a user-friendly summary; full stack/logs stay in Actions, referenced by run URL only.
- **Trace propagation**: a `traceId` is generated per pipeline run and threaded into the OTel deploy marker and the runtime via the deployed image's env so post-deploy traces correlate to the release.

## 13. Testing

- **Tooling unit tests (Vitest)**: `scripts/ci/*` are covered — `loadCiConfig` (valid/invalid env), `health-check` retry/backoff logic, `rollback` selecting the correct previous tag, `DeployOrchestrator.run` ordering and rollback-on-failure. No `any`, fully typed mocks for `HealthChecker`.
- **Workflow integration**: a `ci-dry-run` job uses [`act`](https://github.com/nektos/act) (or a smoke matrix) to validate workflow YAML parses and required jobs exist.
- **Integration tests in CI**: spin up `docker-compose.ci.yml` (MySQL + Redis), run Prisma migrations against the ephemeral DB, execute the integration suite.
- **E2E (Playwright)**: runs against the **staging** deploy after `deploy-staging.yml` succeeds; smoke test of the dashboard login + a bot health command.
- **Coverage gate**: required check fails if coverage drops below the configured threshold (e.g. 80% lines on changed files).
- **Must be covered**: every `scripts/ci` exported function; the migration step must be tested for idempotency (re-running deploy with no new migrations is a no-op).

## 14. Dashboard Integration

- **Deployments page** (`Ops → Deployments`): paginated, filterable table backed by `GET /api/v1/ops/deployments`. Columns: environment, version, status badge, git SHA (linked to GitHub commit), duration, rolled-back flag, started/finished timestamps.
- **Release banner**: shows the current production version + last deploy time, refreshed via the cached endpoint.
- **Status indicators**: live build status badge (sourced from GitHub status API) and the latest staging vs production version diff.
- **Permission-gated** behind `ops.deployments.read`. All strings localized (PT primary, EN secondary) via i18n namespace `ops.deployments`.

## 15. Future Extensions

- **Canary / blue-green** deploys with traffic shifting and automated promotion on SLO compliance.
- **Dashboard-triggered re-deploy & rollback** (guarded by `ops.deployments.*` + production approval), via a `RemoteTrigger`/`workflow_dispatch`.
- **Per-guild feature-flag rollout** integrated into the deploy gate.
- **Preview environments** per pull request (ephemeral namespace + seeded DB).
- **Dependency auto-merge** for patch updates once CI is green (Renovate/Dependabot).
- **Cost/perf budgets** enforced in CI (bundle size, image size, cold-start time).

## 16. Tasks for Claude

Execute in order; one PR per phase, each on a `feature/ci-cd/<phase>` branch.

1. **Phase 1 — Schema**: add `DeploymentRecord` + enums to Prisma, create migration (`prisma migrate dev` locally → committed SQL), regenerate client.
2. **Phase 2 — Config & scripts**: implement `scripts/ci/ci-config.ts` (Zod), `health-check.ts`, `rollback.ts`, `deploy.ts` (`DeployOrchestrator`), `notify.ts`. Strict types, DI for `HealthChecker`.
3. **Phase 3 — Events**: define the `ci.deploy.*` event types and the internal ingress controller → application service → repository that persists `DeploymentRecord`.
4. **Phase 4 — Docker**: write the multi-stage `Dockerfile`, `.dockerignore`, `docker-compose.yml`, and `docker-compose.ci.yml`.
5. **Phase 5 — Workflows**: author `ci.yml`, reusable `docker.yml` & `deploy.yml`, `deploy-staging.yml`, `deploy-prod.yml`, `release.yml`, `codeql.yml`, and the `setup-node-cache` composite action.
6. **Phase 6 — Git hooks & versioning**: configure Husky (`pre-commit`, `commit-msg`, `pre-push`), `commitlint.config.cjs`, `.releaserc.json`.
7. **Phase 7 — Dashboard & API**: implement the read-only deployments endpoints, DTOs, Swagger tags, caching, and the dashboard page (i18n + permission gate).
8. **Phase 8 — Tests**: Vitest for `scripts/ci`, integration via compose, Playwright staging smoke, coverage gate.
9. **Phase 9 — Branch protection & docs**: configure required checks + environment approvals; finalize this doc and the runbook.

## 17. Acceptance Criteria

- [ ] Pushing to `feature/*` runs `lint -> typecheck -> test -> build`; all jobs visible as required checks on the PR.
- [ ] A PR cannot merge to `develop`/`main` unless required checks are green and the branch is up to date.
- [ ] Non-Conventional-Commit messages are rejected locally (Husky) and in CI (commitlint job).
- [ ] Merging to `develop` builds & scans the Docker image and deploys to **staging**; Playwright smoke passes.
- [ ] Merging to `main` runs semantic-release (version bump, changelog, tag, GH Release) and deploys to **production** after manual approval.
- [ ] `prisma migrate deploy` runs on deploy; re-running with no new migrations is a no-op.
- [ ] A failed post-deploy health check triggers automatic rollback to `PREVIOUS_IMAGE_TAG` and emits `ci.deploy.failed` with `rolledBack: true`.
- [ ] Each deploy writes a `DeploymentRecord` and is visible on the dashboard Ops → Deployments page.
- [ ] OTel deploy marker is emitted with the run `traceId`.
- [ ] Trivy scan blocks the pipeline on HIGH/CRITICAL image vulnerabilities.

## 18. Definition of Done

- [ ] All required status checks pass on the PR; lint clean (ESLint + Prettier), `tsc --noEmit` clean, no `any`.
- [ ] Vitest unit tests for `scripts/ci/*` and integration tests pass; coverage threshold met.
- [ ] Prisma migration created, committed, and applied cleanly in staging.
- [ ] Multi-stage Docker image builds reproducibly and runs; image size and scan within budget.
- [ ] All workflows validated (parse + dry-run) and documented; branch protection + environment approvals configured.
- [ ] semantic-release produces a correct version, changelog, and GitHub Release on `main`.
- [ ] This document committed under `docs/architecture/12-ci-cd.md`; PR opened against `develop` with Conventional Commit title. No other module modified.

---

## Appendix A — Sample `ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [develop, main]
  push:
    branches: [develop, main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  validate-commits:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: wagoid/commitlint-github-action@v6

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-node-cache
      - run: npm run lint
      - run: npm run format:check

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-node-cache
      - run: npx prisma generate
      - run: npm run typecheck   # tsc --noEmit, strict, no any

  test:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8
        env: { MYSQL_ROOT_PASSWORD: root, MYSQL_DATABASE: ghost_test }
        ports: ['3306:3306']
        options: >-
          --health-cmd="mysqladmin ping -uroot -proot"
          --health-interval=5s --health-timeout=3s --health-retries=10
      redis:
        image: redis:7
        ports: ['6379:6379']
    env:
      DATABASE_URL: mysql://root:root@127.0.0.1:3306/ghost_test
      REDIS_URL: redis://127.0.0.1:6379
    steps:
      - uses: ./.github/actions/setup-node-cache
      - run: npx prisma migrate deploy
      - run: npm run test:cov
      - uses: codecov/codecov-action@v4
        with: { token: ${{ secrets.CODECOV_TOKEN }} }

  build:
    runs-on: ubuntu-latest
    needs: [lint, typecheck, test]
    steps:
      - uses: ./.github/actions/setup-node-cache
      - run: npm run build
      - run: npx prisma migrate diff \
              --from-schema-datamodel prisma/schema.prisma \
              --to-migrations prisma/migrations --exit-code   # drift guard
```

## Appendix B — Reusable `deploy.yml`

```yaml
name: Deploy (reusable)

on:
  workflow_call:
    inputs:
      environment: { required: true, type: string }   # staging | production
      image-tag:   { required: true, type: string }
    secrets:
      DATABASE_URL:        { required: true }
      DEPLOY_HOST:         { required: true }
      NOTIFY_INGRESS_TOKEN:{ required: true }

permissions:
  contents: read
  packages: read
  id-token: write   # OIDC, no long-lived cloud creds

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}   # production requires approval
    env:
      DEPLOY_ENVIRONMENT: ${{ inputs.environment }}
      IMAGE_TAG: ${{ inputs.image-tag }}
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
      HEALTH_URL: https://${{ secrets.DEPLOY_HOST }}/health
      NOTIFY_INGRESS_URL: https://${{ secrets.DEPLOY_HOST }}/internal/ingress/deploy-events
      NOTIFY_INGRESS_TOKEN: ${{ secrets.NOTIFY_INGRESS_TOKEN }}
    steps:
      - uses: ./.github/actions/setup-node-cache
      # deploy.ts: migrate -> deploy -> health-gate -> rollback on failure
      - run: npx tsx scripts/ci/deploy.ts
```

## Appendix C — Multi-stage `Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1.7
# ---- deps ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json prisma ./
RUN npm ci --ignore-scripts && npx prisma generate

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --uid 10001 --create-home ghost
COPY --from=build --chown=ghost:ghost /app/node_modules ./node_modules
COPY --from=build --chown=ghost:ghost /app/dist ./dist
COPY --from=build --chown=ghost:ghost /app/prisma ./prisma
USER ghost
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node dist/healthcheck.js || exit 1
CMD ["node", "dist/main.js"]
```

## Appendix D — `.releaserc.json` (semantic-release)

```json
{
  "branches": ["main", { "name": "develop", "prerelease": "rc" }],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/changelog", { "changelogFile": "CHANGELOG.md" }],
    "@semantic-release/github",
    ["@semantic-release/git", {
      "assets": ["CHANGELOG.md", "package.json"],
      "message": "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
    }]
  ]
}
```
