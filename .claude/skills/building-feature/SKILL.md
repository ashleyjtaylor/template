---
name: building-feature
description: When building and on completion of a feature, ensure it follows and has completed this Definition of Done. The feature isn't complete until all of the below is ticked off.
---

**Pre-feature**
- Ensure the `/pre-feature` skill has been fulfilled.

**Build**
- Build the cleanest code possible. Stick to the feature only — note prerequisites and verify with the user before sprawling.
- Implement both local and production paths in the same change (e.g. local file upload AND pre-signed S3 upload). Don't ship a feature that only works locally.
- Update GitHub Actions workflows if the feature touches CI/CD or environment variables.
- Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` after every meaningful change.

**Test**
- Unit tests for service-layer logic. Integration tests through tRPC for every endpoint, covering the happy path and each error class. E2E for golden paths only.
- Use factories in `packages/test-factories`. Per-test transaction rollback, no fixture cleanup. Stripe and SES stubbed in CI; real test mode in staging E2E.

**Accessibility**
- Aim for WCAG AA on customer-facing surfaces. Use shadcn primitives (already accessible) — don't reinvent. Test keyboard navigation and screen-reader labels for new flows.

**Documentation**
- Update `.claude/memory/project_overview.md` if the feature changes architecture, schema, deploy topology, or any cross-cutting concern.
- Add or update a runbook in `docs/runbooks/` if the feature introduces ops procedures (restore, rotation, backfill).
- Don't write README/docs for trivial features.

**Commit**
- Use the `/commit` skill. Conventional Commits is enforced via commitlint — non-conforming messages are rejected at commit time.

**Iterate**
- After the feature is merged, ask whether anything learned should update:
  - **Skills** at `.claude/skills/<name>/SKILL.md` — new patterns, common pitfalls, process improvements.
  - **Code style** at `.claude/skills/code-style/SKILL.md` — new rules to add.
  - **Project overview** at `.claude/memory/project_overview.md` — architectural decisions, new modules, schema changes.
- If yes, propose the change and update the file.
