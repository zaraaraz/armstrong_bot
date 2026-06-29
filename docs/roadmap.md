# Roadmap

> Development order for Ghost Bot. Each entry maps to a spec doc and one `feature/<branch>`.
> One unit at a time: implement → tests → docs → PR → `develop`. See `development/branch-strategy.md`.

---

## Phase 1 — Infrastructure
## Branch: feature/core

| Order | Branch | Spec |
|---|---|---|
| 1 | `feature/core` | [architecture/01-core.md](architecture/01-core.md) |
| 2 | `feature/database` | [architecture/02-database.md](architecture/02-database.md) |
| 3 | `feature/cache` | [architecture/03-cache.md](architecture/03-cache.md) |
| 4 | `feature/ci-cd` | [architecture/12-ci-cd.md](architecture/12-ci-cd.md) |

## Phase 2 — Core Platform
## Branch: feature/core-platform

| Order | Branch | Spec |
|---|---|---|
| 5 | `feature/translations` | [architecture/04-translations.md](architecture/04-translations.md) |
| 6 | `feature/permissions` | [architecture/05-permissions.md](architecture/05-permissions.md) |
| 7 | `feature/events` | [architecture/06-events.md](architecture/06-events.md) |
| 8 | `feature/security` | [architecture/10-security.md](architecture/10-security.md) |
| 9 | `feature/plugin-system` | [architecture/07-plugin-system.md](architecture/07-plugin-system.md) |
| 10 | `feature/testing` | [architecture/11-testing.md](architecture/11-testing.md) |

## Phase 3 — API & Dashboard
## Branch: feature/api-dashboard

| Order | Branch | Spec |
|---|---|---|
| 11 | `feature/api` | [architecture/08-api.md](architecture/08-api.md) |
| 12 | `feature/dashboard` | [architecture/09-dashboard.md](architecture/09-dashboard.md) |

## Phase 4 — Foundational Modules
## Branch: feature/core-modules

| Order | Branch | Spec |
|---|---|---|
| 13 | `feature/scheduler` | [modules/scheduler.md](modules/scheduler.md) |
| 14 | `feature/storage` | [modules/storage.md](modules/storage.md) |
| 15 | `feature/audit` | [modules/audit.md](modules/audit.md) |
| 16 | `feature/metrics` | [modules/metrics.md](modules/metrics.md) |
| 17 | `feature/notifications` | [modules/notifications.md](modules/notifications.md) |
| 18 | `feature/webhooks` | [modules/webhooks.md](modules/webhooks.md) |

## Phase 5 — Feature Modules
## Branch: feature/modules

| Order | Branch | Spec |
|---|---|---|
| 19 | `feature/logs` | [modules/logs.md](modules/logs.md) |
| 20 | `feature/admin` | [modules/admin.md](modules/admin.md) |
| 21 | `feature/moderation` | [modules/moderation.md](modules/moderation.md) |
| 22 | `feature/levels` | [modules/levels.md](modules/levels.md) |
| 23 | `feature/economy` | [modules/economy.md](modules/economy.md) |
| 24 | `feature/tickets` | [modules/tickets.md](modules/tickets.md) |
| 25 | `feature/giveaways` | [modules/giveaways.md](modules/giveaways.md) |
| 26 | `feature/games` | [modules/games.md](modules/games.md) |
| 27 | `feature/utilities` | [modules/utilities.md](modules/utilities.md) |
| 28 | `feature/analytics` | [modules/analytics.md](modules/analytics.md) |
| 29 | `feature/backup` | [modules/backup.md](modules/backup.md) |
| 30 | `feature/ai` | [modules/ai.md](modules/ai.md) |
| 31 | `feature/fivem` | [modules/fivem.md](modules/fivem.md) |

## Phase 6 — Production

- Hardening, load testing, observability dashboards (Grafana).
- Security review, dependency/image scanning.
- Staging soak → first production release. See [development/release.md](development/release.md).

---

## Development Standards

- [development/coding-standards.md](development/coding-standards.md)
- [development/branch-strategy.md](development/branch-strategy.md)
- [development/pull-request.md](development/pull-request.md)
- [development/release.md](development/release.md)

## Foundation

- [00-project.md](00-project.md) — the contract every doc above obeys.
