# Roadmap

> Development order for Ghost Bot. Each phase uses a single `feature/<branch>` — implement all items in sequence, then PR → `develop`. See `development/branch-strategy.md`.

---

## Phase 1 — Infrastructure
**Branch: `feature/core`**

| Order | Item | Spec |
|---|---|---|
| 1 | Core | [architecture/01-core.md](architecture/01-core.md) |
| 2 | Database | [architecture/02-database.md](architecture/02-database.md) |
| 3 | Cache | [architecture/03-cache.md](architecture/03-cache.md) |
| 4 | CI/CD | [architecture/12-ci-cd.md](architecture/12-ci-cd.md) |

## Phase 2 — Core Platform
**Branch: `feature/core-platform`**

| Order | Item | Spec |
|---|---|---|
| 5 | Translations (i18n) | [architecture/04-translations.md](architecture/04-translations.md) |
| 6 | Permissions | [architecture/05-permissions.md](architecture/05-permissions.md) |
| 7 | Events | [architecture/06-events.md](architecture/06-events.md) |
| 8 | Security | [architecture/10-security.md](architecture/10-security.md) |
| 9 | Plugin System | [architecture/07-plugin-system.md](architecture/07-plugin-system.md) |
| 10 | Testing | [architecture/11-testing.md](architecture/11-testing.md) |

## Phase 3 — API & Dashboard
**Branch: `feature/api-dashboard`**

| Order | Item | Spec | Status |
|---|---|---|---|
| 11 | API | [architecture/08-api.md](architecture/08-api.md) | ✅ done (reuses `@shared/security`; see §17b) |
| 12 | Dashboard | [architecture/09-dashboard.md](architecture/09-dashboard.md) | ✅ backend + frontend scaffold (pages/e2e deferred; see §17b) |

## Phase 4 — Foundational Modules
**Branch: `feature/core-modules`**

| Order | Item | Spec |
|---|---|---|
| 13 | Scheduler | [modules/scheduler.md](modules/scheduler.md) |
| 14 | Storage | [modules/storage.md](modules/storage.md) |
| 15 | Audit | [modules/audit.md](modules/audit.md) |
| 16 | Metrics | [modules/metrics.md](modules/metrics.md) |
| 17 | Notifications | [modules/notifications.md](modules/notifications.md) |
| 18 | Webhooks | [modules/webhooks.md](modules/webhooks.md) |

## Phase 5 — Feature Modules
**Branch: `feature/modules`**

| Order | Item | Spec |
|---|---|---|
| 19 | Logs | [modules/logs.md](modules/logs.md) |
| 20 | Admin | [modules/admin.md](modules/admin.md) |
| 21 | Moderation | [modules/moderation.md](modules/moderation.md) |
| 22 | Levels | [modules/levels.md](modules/levels.md) |
| 23 | Economy | [modules/economy.md](modules/economy.md) |
| 24 | Tickets | [modules/tickets.md](modules/tickets.md) |
| 25 | Giveaways | [modules/giveaways.md](modules/giveaways.md) |
| 26 | Games | [modules/games.md](modules/games.md) |
| 27 | Utilities | [modules/utilities.md](modules/utilities.md) |
| 28 | Analytics | [modules/analytics.md](modules/analytics.md) |
| 29 | Backup | [modules/backup.md](modules/backup.md) |
| 30 | AI | [modules/ai.md](modules/ai.md) |
| 31 | FiveM | [modules/fivem.md](modules/fivem.md) |

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
