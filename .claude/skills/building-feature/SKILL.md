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
- If the feature ships or modifies a Dockerfile, run `docker build` and `docker run` against it locally. The standard `pnpm` checks don't exercise the image — Dockerfile bugs only surface in `docker build` output.
- Prefer the proper config over a workaround flag or lint suppression. If you reach for `--legacy`, `--ignore-scripts`, `// eslint-disable`, `biome-ignore`, or any flag named "legacy" / "force" / "skip", first check whether the tool has a canonical opt-in for the underlying behaviour. Workarounds accumulate as silent debt; proper config is auditable and self-documenting.

**Test**
- Unit tests for service-layer logic. Integration tests through tRPC for every endpoint, covering the happy path and each error class. E2E for golden paths only.
- Use factories in `packages/test-factories`. Per-test transaction rollback, no fixture cleanup. Stripe and SES stubbed in CI; real test mode in staging E2E.

**Accessibility**
- Aim for WCAG AA on customer-facing surfaces. Use shadcn primitives (already accessible) — don't reinvent. Test keyboard navigation and screen-reader labels for new flows.

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
- **Skill / overview drift**: if this changed how something works, is the relevant skill or `.claude/memory/project_overview.md` still accurate? (The Documentation step below catches this — don't skip it.)

Ask: "If a thorough reviewer poked at this PR for 5 minutes, what would they find?" Find it yourself first.

If anything turns up, fix it before committing — don't commit knowing the next commit will be a follow-up fix.

**Documentation — hard checkpoint, not a "we'll get to it"**

These updates ship **inside the same PR** as the feature, not as a separate doc PR after the fact. Skipping them or saying "we can do docs later" creates drift that compounds across PRs. If a doc genuinely cannot land in this PR (e.g. you discover a bigger rewrite needed mid-flight), open a tracking ticket in `docs/tickets/` *immediately* and reference it in the PR description so it doesn't fall on the floor.

Walk through every item explicitly before reporting the feature done:

- [ ] **`.claude/memory/project_overview.md`** — updated if the feature changes architecture, schema, deploy topology, identifier conventions, table shapes, or any cross-cutting decision documented there. Grep the overview for terms touched by this PR (`grep -in '<keyword>' .claude/memory/project_overview.md`) to find drift.
- [ ] **`docs/system-design.md`** — updated if the feature adds, removes, or changes a deployed resource OR a connection between services. Use Mermaid diagrams; fall back to bullet lists where a diagram would be noise. Skip pure app-code changes that don't touch infra or service topology.
- [ ] **`docs/endpoints.md`** — updated if the feature adds, removes, or changes an HTTP route. Document request/response shape, sequence diagrams where the request flow has multiple hops or branching, and any status-code deviations from typical REST conventions.
- [ ] **`.claude/memory/progress.md`** — new entry at the top for any consequential PR. One section per milestone (a meaningful PR or feature group), not per commit. Each entry: date, branch / PR refs, what landed, what's now possible, what's deferred (always include "Deferred" — even "nothing" — so the next session knows the explicit follow-up surface). Trivial PRs (renovate bumps, lint fixes, single-typo fixes) are skipped per `progress.md`'s own convention.
- [ ] **`docs/runbooks/`** — added or updated if the feature introduces any procedure that needs to be performed manually or out-of-band: initial bootstrap, secret population, IAM setup, recovery from failure, periodic rotation, data backfills, or anything a human will need step-by-step guidance for later. Write the runbook now, while the steps are fresh — not when someone hits the situation cold.
- [ ] **Relevant `.claude/skills/<name>/SKILL.md`** — updated if the feature establishes a new convention (a column shape, a wiring pattern, a failure mode that should never recur). The skill is the durable artifact future agents will read.

Don't write READMEs / docs for trivial features. Trivial = renovate bumps, dependency tweaks that don't change behaviour, internal-only refactors that don't shift capability.

If the user explicitly defers a documentation item ("we can sort out docs as a separate piece of work"), acknowledge it but **immediately** open a tracking entry in `docs/tickets/` and surface it at the start of the next PR — don't let "deferred" become "forgotten."

**Commit**
- Use the `/commit` skill. Conventional Commits is enforced via commitlint — non-conforming messages are rejected at commit time.

**Iterate**
- After the feature is merged, ask whether anything learned should update:
  - **Skills** at `.claude/skills/<name>/SKILL.md` — new patterns, common pitfalls, process improvements.
  - **Code style** at `.claude/skills/code-style/SKILL.md` — new rules to add.
  - **Project overview** at `.claude/memory/project_overview.md` — architectural decisions, new modules, schema changes.
- If yes, propose the change and update the file.
