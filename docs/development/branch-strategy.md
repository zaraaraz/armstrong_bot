# Branch Strategy

> ## Claude Instructions
> - Follow this branching model for all work. One module per feature branch.
> - Never commit directly to `main` or `develop`. Open a Pull Request.
> - Match the `docs/` structure: implement one documented unit at a time.

---

## 1. Purpose

Define the Git branching model so development stays disciplined: one module at a time, always
through review, mirroring the order and structure of the `docs/` specifications. This prevents the
codebase from turning into a museum of half-merged, contradictory decisions.

---

## 2. Goals

- Stable `main` always deployable.
- Integration happening on `develop`, never on `main`.
- One feature branch per documented module/architecture unit.
- Clear, predictable promotion path: feature → develop → release → main.
- Every merge gated by CI + review + Definition of Done.

---

## 3. Architecture (branch model)

```
main ───────────────●───────────────────●───────────►   (production, tagged releases)
                    ▲                    ▲
            release/1.0.0         release/1.1.0
                    ▲                    ▲
develop ──●───●───●─┴───●───●───●───●───┴──►   (integration)
          ▲   ▲       ▲   ▲   ▲
   feature/core  feature/database  feature/moderation ...
                                  ▲
                          bugfix/123-xp-overflow

main ──────────────●────────►
                   ▲
            hotfix/critical-rce
```

---

## 4. Branch Types

| Branch | Source | Merges into | Purpose |
|---|---|---|---|
| `main` | — | — | Production. Protected. Tagged releases only. |
| `develop` | `main` | — | Integration of completed features. Protected. |
| `feature/<module>` | `develop` | `develop` | One module or architecture unit. |
| `bugfix/<issue>` | `develop` | `develop` | Fix found during development. |
| `release/<version>` | `develop` | `main` (+ back to `develop`) | Stabilise + version a release. |
| `hotfix/<issue>` | `main` | `main` (+ back to `develop`) | Urgent production fix. |

Examples: `feature/core`, `feature/fivem`, `feature/tickets`, `bugfix/412-ticket-transcript`,
`hotfix/cve-rcon-leak`, `release/1.2.0`.

---

## 5. The "one module at a time" discipline

Development order follows `docs/roadmap.md` and the docs structure:

```
feature/core      → PR → develop
feature/database  → PR → develop
feature/cache     → PR → develop
feature/permissions → PR → develop
...
feature/moderation → PR → develop
feature/fivem      → PR → develop
```

- **Never two feature branches for overlapping modules open at once.** Finish, review, merge, then start the next.
- Each feature branch references its spec doc (e.g. `feature/tickets` ↔ `docs/modules/tickets.md`)
  and is not considered complete until that doc's **Acceptance Criteria** and **Definition of Done** are met.

---

## 6. Workflow Steps

1. `git checkout develop && git pull`
2. `git checkout -b feature/<module>`
3. Implement following the module's doc, phase by phase (schema → services → … → tests → docs).
4. Keep the branch rebased on `develop` (`git rebase develop`) to avoid drift.
5. Open a PR into `develop` (see `pull-request.md`).
6. Pass CI + review → squash-merge.
7. Delete the feature branch.

---

## 7. Protection Rules

- `main` and `develop`: no direct pushes; PR required; linear history; required status checks
  (lint, type-check, test, build); ≥1 approving review; up-to-date with base before merge.
- `main`: additionally requires the PR to come from a `release/*` or `hotfix/*` branch.
- Force-push disabled on protected branches.

---

## 8. Commit Convention

Conventional Commits (see `00-project.md`). The branch's commits are squashed on merge into a
single conventional commit summarising the module, e.g. `feat(tickets): add ticket lifecycle module`.

---

## 9. Versioning

- Semantic Versioning. `develop` carries the next pre-release; `release/*` finalises the number.
- Tags applied on `main` at release (`v1.2.0`). See `release.md`.

---

## 10. Hotfix Flow

```
main → hotfix/<issue> → fix + test → PR → main (tag patch) → merge back into develop
```

Hotfixes are minimal and targeted; larger fixes go through the normal feature/bugfix flow.

---

## 11. Conflicts & Rebasing

- Prefer rebase over merge for feature branches to keep history linear.
- Resolve conflicts locally; never merge a branch with unresolved markers.
- If a feature branch grows stale, rebase onto `develop` before review.

---

## 12. Anti-patterns (forbidden)

- Long-lived branches that diverge for weeks.
- Mixing multiple modules in one feature branch.
- Committing generated artifacts, `.env`, or secrets.
- Merging without green CI or without the spec's DoD satisfied.

---

## 13. Future Extensions

- Trunk-based development with feature flags once the platform stabilises.
- Automated branch creation from doc files via a CLI.

---

## 14. Tasks for Claude

1. Configure branch protection on `main` and `develop`.
2. Add a `CODEOWNERS` file.
3. Document required status checks (mirrors `12-ci-cd.md`).
4. Add a git hook reminder linking branches to their spec doc.

---

## 15. Acceptance Criteria

- [ ] Direct pushes to `main`/`develop` are rejected.
- [ ] PRs require green CI + review.
- [ ] Branch naming matches the table above.

---

## 16. Definition of Done

- [ ] Protection rules applied.
- [ ] Documented and linked from the contributing guide.
- [ ] PR opened into `develop`.
