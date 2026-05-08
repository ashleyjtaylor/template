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
- Update `docs/system-design.md` if the feature adds, removes, or changes a deployed resource, or a connection between services. Use Mermaid diagrams; fall back to bullet lists where a diagram would be noise. Skip pure app-code changes that don't touch infra or service topology.
- Add a new entry at the top of `.claude/memory/progress.md` when a consequential feature merges. One section per milestone, not per commit. Each entry: date, commit/PR refs, what landed, what's now possible, what's deferred. Skip renovate bumps, lint fixes, and other trivial changes.
- Add or update a runbook in `docs/runbooks/` if the feature introduces any procedure that needs to be performed manually or out-of-band — initial bootstrap, secret population, IAM setup, recovery from failure, periodic rotation, data backfills, or anything a human will need step-by-step guidance for later. Write the runbook now, while the steps are fresh — not when someone hits the situation cold.
- Don't write README/docs for trivial features.

**Review (before committing — be your own code reviewer)**

Read the diff back end-to-end and audit for things that look fine in isolation but jar against the rest of the codebase. Don't trust "it works on my machine" — many issues only surface in CI, on a fork, or in production.

Specifically check:

- **Overlooked logic**: edge cases, error paths, race conditions, empty/null/undefined inputs, what happens on retry.
- **Cross-file consistency**: values that travel together (region, ports, version pins, env var names, role ARNs) — if you changed one, did you change the others? `grep` for the value across the repo.
- **CI actually validates the change**: if you added a new package, does CI lint/typecheck/test it? If you added a new workflow, does it run against the right targets and have the required secrets/permissions? If you broke a config, would CI catch it before deploy?
- **Version compatibility**: when adding multiple deps, verify they're compatible with each other (not just "latest of each independently"). Especially relevant for tightly-coupled families: aws-cdk + aws-cdk-lib, prisma + @prisma/client, react + @types/react, etc. Group them in Renovate so they update together.
- **Hardcoded values that should be centralised**: a value duplicated in 2+ places will eventually drift. Either centralise it or add a comment in each place pointing at the others.
- **Failure modes**: how does this fail if the network is slow / the secret is missing / the dependency is down / the user passes garbage / two requests arrive simultaneously? Are the error messages useful?
- **Reverse-direction effects**: did a renamed/removed export break consumers? Did a new required arg break callers?
- **Footguns introduced**: silent failures, confusing error messages, defaults that work locally but explode in prod.
- **Skill / overview drift**: if this changed how something works, is the relevant skill or `.claude/memory/project_overview.md` still accurate?

Ask: "If a thorough reviewer poked at this PR for 5 minutes, what would they find?" Find it yourself first.

If anything turns up, fix it before committing — don't commit knowing the next commit will be a follow-up fix.

**Commit**
- Use the `/commit` skill. Conventional Commits is enforced via commitlint — non-conforming messages are rejected at commit time.

**Iterate**
- After the feature is merged, ask whether anything learned should update:
  - **Skills** at `.claude/skills/<name>/SKILL.md` — new patterns, common pitfalls, process improvements.
  - **Code style** at `.claude/skills/code-style/SKILL.md` — new rules to add.
  - **Project overview** at `.claude/memory/project_overview.md` — architectural decisions, new modules, schema changes.
- If yes, propose the change and update the file.
