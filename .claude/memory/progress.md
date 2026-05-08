---
name: progress
description: What has actually shipped on this template, in reverse chronological order. Read alongside project_overview.md — the overview is the design, this is the status.
type: project
---

# Progress

Reverse chronological log of consequential changes. One section per milestone (a meaningful PR or feature), not per commit. Renovate bumps, lint fixes, typo corrections, and trivial dependency tweaks do **not** get entries.

Each entry: date, ref(s), what landed, what's now possible, what's deferred.

---

## 2026-05-07 — `building-feature` skill: self-review step

- **Commits**: `c3f4cdf`
- **What landed**: Added a "Review (before committing — be your own code reviewer)" section to `.claude/skills/building-feature/SKILL.md`. Lists specific things to audit (overlooked logic, cross-file consistency, CI coverage, version compatibility, hardcoded values, failure modes, reverse-direction effects, footguns, skill drift).
- **What's now possible**: feature work has an explicit self-review gate before commit, reducing "next commit is a follow-up fix" patterns.
- **Deferred**: nothing.

## 2026-05-07 — CDK skeleton + staging CI/CD pipeline

- **Commits**: `be1436a`, `69e08b1`, `0cb8e2c`, `42be839` (PR #6, PR #7)
- **What landed**:
  - `infra/cdk/` workspace (`@template/cdk`) with `aws-cdk-lib` 2.253.0 and `aws-cdk` CLI 2.1121.0 pinned.
  - Three empty stack classes: `NetworkStack`, `DataStack`, `AppStack` in `infra/cdk/lib/`.
  - `bin/app.ts` instantiates all three for both `staging` and `production` envs (`template-{env}-{stack}`), tagged with `Product`/`Environment`/`ManagedBy=cdk` via `tagsFor()`.
  - Region locked to `eu-west-1` in `infra/cdk/lib/config.ts`.
  - `.github/workflows/ci.yml`: `ci` (lint+typecheck+test), `cdk` (synth), `commitlint` (PR-only), `deploy-staging` (push-to-main, gated on `[ci, cdk]` passing, OIDC role assumption, `cdk deploy "template-staging-*"`).
  - `pnpm-workspace.yaml` `onlyBuiltDependencies: [esbuild, lefthook]` to allow postinstall scripts CI needs.
  - Runbooks: `docs/runbooks/cdk-bootstrap.md`, `docs/runbooks/github-oidc-setup.md`.
- **What's now possible**: pushes to `main` automatically run lint/typecheck/test/synth and (if green) call `cdk deploy` against the staging account. Right now this is a no-op because the stacks are empty, but the wiring is end-to-end.
- **Deferred**:
  - All actual infra resources (VPC, NAT, ECR, ECS, ALB, RDS, Redis, S3) — stacks are empty.
  - `deploy-production.yml` workflow (tag-triggered, requires reviewer approval).
  - Tightening the OIDC role from `AdministratorAccess` to scoped permissions (runbook has the plan).
  - Promote-by-image flow (build once, retag for prod).

## 2026-05-06 — Monorepo bootstrap

- **Commits**: `15f9fb4`
- **What landed**:
  - `package.json` at root (`type: module`, Node ≥24.15.0, pnpm 10.33.4 via `packageManager`).
  - `pnpm-workspace.yaml` covering `apps/*`, `packages/*`, `infra/*`.
  - Turborepo 2.9.10 with `build`, `typecheck`, `test`, `lint`, `format`, `dev` tasks (build/typecheck/test depend on `^build`).
  - Biome 2.4.14 for lint + format.
  - TypeScript 6.0.3 with strict `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `isolatedModules`, NodeNext modules).
  - Lefthook 2.1.6 for git hooks.
  - Commitlint 20.5.3 with conventional config — non-conforming commit messages rejected at commit time.
- **What's now possible**: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all wired up across the workspace. Conventional Commits enforced.
- **Deferred**: any actual app, package, or infra code — all directories are empty.

---

## Convention

- **One section per milestone**, not per commit. Group related commits (the same feature, follow-up fixes, hotfixes) under one entry.
- **Skip**: renovate bumps, lint/format fixes, typo corrections, version bumps that don't change behaviour, internal-only refactors that don't shift capability.
- **Reverse chronological** — newest at the top, just under the "Progress" heading.
- **Date format**: `YYYY-MM-DD` from the merge date.
- **Every entry must include "Deferred"** — even "nothing" — so the next session knows the explicit follow-up surface, not just what's done.
