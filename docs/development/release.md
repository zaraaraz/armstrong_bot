# Release Process

> ## Claude Instructions
> - Releases go from `develop` → `release/<version>` → `main`. Never release directly from a feature branch.
> - Every release is versioned (SemVer), changelogged, tagged, image-published and migration-safe.
> - Always provide a rollback path before deploying.

---

## 1. Purpose

Define a repeatable, low-risk release process: how a set of merged features on `develop` becomes a
versioned, deployed production release with a changelog, Docker image, applied migrations and a
rollback plan.

---

## 2. Goals

- Predictable, automated releases driven by Conventional Commits.
- No surprise breaking changes — every release documented.
- Safe migrations with a rollback path.
- Staged rollout (staging → production) with post-release verification.

---

## 3. Versioning (SemVer)

`MAJOR.MINOR.PATCH`:

- **MAJOR** — breaking changes (API/contract/DB requiring manual action).
- **MINOR** — backwards-compatible features (new module, new command).
- **PATCH** — backwards-compatible fixes.

Version is derived from Conventional Commits since the last tag:
`feat:` → minor, `fix:`/`perf:` → patch, `feat!:`/`BREAKING CHANGE:` → major.

---

## 4. Changelog

- Auto-generated from Conventional Commits (e.g. `semantic-release` / `changesets`).
- Grouped by Features / Fixes / Performance / Breaking Changes.
- Committed as `CHANGELOG.md` and attached to the GitHub Release.
- Breaking changes include a migration note for operators.

---

## 5. Release Flow

```
develop ──► release/<version> ──► (stabilise) ──► main (tag v<version>)
                  │                                   │
                  └──────────── merge back into develop ◄
```

1. Cut `release/<version>` from `develop` once the scope is feature-complete.
2. Only stabilisation commits go onto the release branch (bugfixes, docs, version bump). **No new features.**
3. When green and verified on staging, PR `release/<version>` → `main`.
4. Tag `main` with `v<version>`; publish the GitHub Release + changelog.
5. Merge `main` back into `develop` so the tag/version bump is not lost.

---

## 6. Pre-Release Checklist

- [ ] All targeted PRs merged into `develop`.
- [ ] CI green on `develop`.
- [ ] Changelog drafted and reviewed.
- [ ] Migrations reviewed for reversibility and lock impact.
- [ ] Breaking changes documented with operator instructions.
- [ ] Staging deploy verified (smoke tests + key flows).

---

## 7. Build & Publish

- CI builds a multi-stage Docker image on the release tag (see `12-ci-cd.md`).
- Image tagged with both `v<version>` and `latest` (prod) / `staging`.
- Images pushed to the registry; SBOM + image scan run before publish.

---

## 8. Migration Rollout

- Migrations run as a dedicated, gated deploy step (`prisma migrate deploy`), **before** the new app
  version serves traffic.
- Migrations must be **expand/contract** safe for zero-downtime:
  1. *Expand* — add columns/tables (nullable/defaulted), deploy code that writes both old+new.
  2. *Migrate data* — backfill jobs (BullMQ) if needed.
  3. *Contract* — remove old columns in a **later** release once nothing reads them.
- Never drop/rename a column in the same release that stops using it.

---

## 9. Deploy Strategy

- **Staging first**: deploy the image, run smoke + e2e, watch metrics for a soak period.
- **Production**: rolling deploy; health checks (`/health`, `/ready`) gate traffic.
- Feature flags hide incomplete features so a release can ship safely.

---

## 10. Rollback

- **App rollback**: redeploy the previous image tag (instant — images are immutable).
- **DB rollback**: because migrations are expand/contract, the previous app version still runs
  against the new schema. Avoid destructive migrations; if one is unavoidable, ship a tested
  down-migration and a backup snapshot (Backup module) taken immediately before deploy.
- Document the exact rollback command in the release notes.

---

## 11. Post-Release Verification

- Smoke test critical paths (login, a command, an API call).
- Watch dashboards (Prometheus/Grafana): error rate, latency, gateway, queue depth.
- Confirm no spike in `security.*` / error logs.
- Announce the release; close the milestone.

---

## 12. Hotfix Releases

- Branch `hotfix/<issue>` from `main`, fix + test, PR → `main`, tag a PATCH, merge back to `develop`.
- Same build/migration/rollback discipline, expedited.

---

## 13. Runbook (step-by-step)

```bash
# 1. Cut the release branch
git checkout develop && git pull
git checkout -b release/1.3.0

# 2. Bump version + changelog (automated)
npm run release:prepare        # writes version, CHANGELOG.md

# 3. Push and verify on staging via CI
git push -u origin release/1.3.0

# 4. After staging verification, open PR release/1.3.0 -> main, merge

# 5. Tag + publish (CI on main does build + image + migrate deploy)
git tag v1.3.0 && git push origin v1.3.0

# 6. Merge main back into develop
git checkout develop && git merge --ff-only main && git push
```

---

## 14. Future Extensions

- Canary deploys with automated rollback on metric regression.
- Blue/green environments.
- Automated changelog → Discord announcement via the Notifications module.

---

## 15. Tasks for Claude

1. Configure `semantic-release` (or changesets) for versioning + changelog.
2. Add release CI workflow (build → scan → publish → migrate deploy).
3. Add `release:prepare` script.
4. Document expand/contract migration rules in the DB doc cross-reference.

---

## 16. Acceptance Criteria

- [ ] A release produces a SemVer tag, changelog entry and published image.
- [ ] Migrations apply before traffic and are expand/contract safe.
- [ ] A documented one-command rollback exists.
- [ ] Staging is verified before production.

---

## 17. Definition of Done

- [ ] Release automation configured and tested on a dry-run.
- [ ] Runbook validated end-to-end on staging.
- [ ] Linked from the contributing guide and `12-ci-cd.md`.
- [ ] PR opened into `develop`.
