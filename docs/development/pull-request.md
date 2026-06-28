# Pull Request Process

> ## Claude Instructions
> - Every change goes through a PR into `develop`. No direct commits to protected branches.
> - A PR is not done until its module's Acceptance Criteria and Definition of Done are met.
> - Link the PR to its spec doc. Include tests and documentation in the same PR.

---

## 1. Purpose

Define how changes are proposed, reviewed and merged so that every merge into `develop` is
reviewed, tested, documented and traceable back to its specification.

---

## 2. Goals

- No unreviewed code reaches `develop` or `main`.
- Every PR maps to exactly one documented unit.
- Reviews focus on correctness and architecture, not style (tooling handles style).
- The Definition of Done is a hard gate, not a suggestion.

---

## 3. Scope of a PR

- One feature branch → one module/architecture unit → one PR.
- Keep PRs reviewable: aim for < ~800 changed lines of logic where possible. Split large modules by phase.
- No mixing unrelated changes (e.g. a refactor + a new feature) in one PR.

---

## 4. PR Template (copy-paste into `.github/pull_request_template.md`)

```markdown
## Summary
<!-- What does this PR do, in one or two sentences? -->

## Spec
Implements: docs/<path>.md
Phase(s): <e.g. Phase 1–4 of the module's Tasks for Claude>

## Type
- [ ] feat  - [ ] fix  - [ ] refactor  - [ ] docs  - [ ] test  - [ ] perf  - [ ] ci  - [ ] build

## Changes
<!-- Bullet list of notable changes -->

## Architecture compliance
- [ ] Controllers/commands contain no business logic
- [ ] Only repositories touch Prisma
- [ ] No cross-module internal imports (Event Bus / public contract only)
- [ ] No `any`; strict types throughout

## Database
- [ ] Migration created and reversible
- [ ] Indexes added for searchable fields
- [ ] Multi-guild scoped (guildId) where applicable

## Tests
- [ ] Unit tests
- [ ] Integration tests
- [ ] e2e (if user-facing dashboard/command)
- Coverage: <before> → <after>

## Docs
- [ ] Spec doc updated/satisfied
- [ ] Swagger updated (if API changed)
- [ ] Translations added (i18n keys)

## Definition of Done
- [ ] CI green (lint, type-check, test, build)
- [ ] Acceptance Criteria from the spec doc all checked
- [ ] No breaking changes (or documented + justified)

## Screenshots / demo (optional)
```

---

## 5. Required CI Checks (must be green to merge)

- `lint` (ESLint + Prettier check)
- `type-check` (`tsc --noEmit`)
- `test` (Vitest unit + integration; coverage threshold met)
- `e2e` (Playwright, when dashboard/command UI changed)
- `build` (NestJS build + Docker image build)
- `commitlint` (Conventional Commits)

See `12-ci-cd.md` for the pipeline definition.

---

## 6. Review Checklist (for reviewers)

**Correctness**
- Does it do what the spec says? Are edge cases handled?
- Are errors typed, categorised and user-safe (no leaks)?

**Architecture**
- Layer flow respected (Controller → Service → Repository → DB)?
- Module boundaries respected (no internal cross-module imports)?
- Events used for cross-module communication?

**Data**
- Migration correct, reversible, indexed? Guild-scoped?
- Pagination + caching where lists/hot reads exist?

**Quality**
- Tests meaningful (including negative cases)? Coverage adequate?
- No `any`, no dead code, no leftover `TODO`?
- i18n keys added (no hardcoded user-facing strings)?

**Security**
- Input validated/sanitised? Permission claims enforced? Secrets not logged?

---

## 7. Review Rules

- At least **one approving review** required (the project owner for now; more as the team grows).
- Reviewer ≠ author.
- Address all comments or explicitly resolve with justification before merge.
- "Request changes" blocks merge until resolved.

---

## 8. Merge Policy

- **Squash merge** into `develop` (one clean conventional commit per PR).
- Branch must be up to date with `develop` (rebased) before merge.
- Delete the branch after merge.
- The squash commit message uses the PR title in Conventional Commit form,
  e.g. `feat(fivem): add player lookup and server control`.

---

## 9. Linking to Specs & Acceptance

- The PR **must** reference its spec doc path.
- The PR description copies the spec's Acceptance Criteria checklist; all boxes checked before merge.
- If the implementation revealed a gap in the spec, update the spec doc **in the same PR**.

---

## 10. Anti-patterns (forbidden)

- "Will add tests later" merges.
- Disabling lint rules to pass CI instead of fixing the cause.
- Force-merging past failing checks.
- Giant PRs spanning multiple modules.

---

## 11. Future Extensions

- Auto-assign reviewers via `CODEOWNERS`.
- PR size + coverage bots posting automated review summaries.
- Required architecture-boundary check (dependency-cruiser) as a gate.

---

## 12. Tasks for Claude

1. Add `.github/pull_request_template.md` from section 4.
2. Add `CODEOWNERS`.
3. Wire the required checks in branch protection (mirrors `12-ci-cd.md`).
4. Add a coverage-reporting step to CI.

---

## 13. Acceptance Criteria

- [ ] PR template appears automatically on new PRs.
- [ ] Merge is blocked without green CI + approval.
- [ ] Squash-merge is the only enabled merge method into `develop`.

---

## 14. Definition of Done

- [ ] Template + CODEOWNERS committed.
- [ ] Protection rules require the listed checks.
- [ ] Linked from the contributing guide.
- [ ] PR opened into `develop`.
