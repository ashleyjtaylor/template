# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A bootstrap template — there is no application code yet. The repository ships `.claude/` configuration (skills, permissions, a `discuss` slash command) and a fully designed architecture documented in `.claude/memory/project_overview.md`.

**Read the project overview first.** It is the source of truth for stack, architecture, schema, deployment, billing model, and every load-bearing decision. This file is a quick-reference; the overview is the design.

Stack at a glance: TypeScript + pnpm workspaces + Turborepo + Biome. Backend = Hono + tRPC + Prisma + Postgres + BullMQ + Redis on ECS Fargate. Frontends = Vite + TanStack Router + Tailwind + shadcn/ui (separate SPAs for `web`, `internal`, optional `portal`). Auth = self-hosted better-auth. Billing = Stripe Checkout + Customer Portal with per-seat overage. Infra = AWS CDK (3 stacks: network/data/app, 2 envs: staging/prod). CI/CD = GitHub Actions with OIDC, trunk-based with promote-by-image.

The repo is **forked per product**. Each new product is a clean fork into its own GitHub repo, deploying into a shared AWS account with prefixed naming and per-product tags.

## Workflow skills

These skills encode the user's preferred process — invoke them at the matching phase rather than ad-hoc:

- `/project-init` — initial scoping interview; outputs `.claude/memory/project_overview.md`
- `/pre-feature` — non-trivial features must go through this interview before any code is written (requirements, data model, API, error cases, tests, infra, CI/CD)
- `/building-feature` — Definition of Done checklist; a feature is not complete until lint, typecheck, build, and tests pass and both local and production paths (e.g. local file upload AND pre-signed S3) are implemented
- `/discuss` — stress-test a plan one question at a time; explore the codebase to answer questions when possible instead of asking
- `/debug` — structured debugging (state what's known, narrow the failing layer, verify assumptions, add diagnostic logging before guessing at fixes)
- `/infra` — AWS CDK stack design and review
- `/code-style` — apply the conventions below to a file or module

## Code conventions (from `code-style` skill)

- **Comments**: none by default. Only when the *why* is non-obvious. Never restate what the code does and never add caller/task references (`// used by signup flow`, `// added for #42`).
- **Types**: string union types, not enums or `as const` runtime objects — bundlers strip the runtime value when a name has both `export const` and `export type`. Shared domain types live in `packages/types`. Validation schemas (Zod, etc.) belong in the app that owns the boundary.
- **Errors**: typed error classes (`ConflictError`, `UnauthorizedError`, `NotFoundError`), not plain `Error` or generic HTTP exceptions. Validate at system boundaries only; trust internal contracts.
- **Naming**: verbs for functions (`createUser`), `is`/`has`/`can` for booleans. No abbreviations beyond universal ones (`db`, `id`, `url`).
- **Don't add**: feature flags, backwards-compat shims, defensive checks for impossible cases, helpers used in fewer than three places, `console.log` (use the shared logger).

## Infrastructure conventions (from `infra` skill)

CDK stacks split by **lifecycle**, not resource type:

- **DataStack / NetworkStack** — VPC, RDS, Redis, **ECR**, Secrets (long-lived). ECR lives here because the image must be pushed before ECS can start.
- **AppStack** — ECS, ALB, CloudFront, S3 (deploys frequently).

First deploy is sequential: deploy network + data → populate secrets out-of-band → push image → deploy app. Subsequent deploys just push the image and force an ECS rolling update.

Secrets rules: never use `environment:` for them; create the secret in DataStack and inject via `ecs.Secret.fromSecretsManager(secret, 'FIELD_NAME')`. Validate env vars at server startup so containers fail fast.

Security groups follow strict least-privilege chaining: ALB ← internet, ECS ← ALB SG, RDS/Redis ← ECS SG.

## Common commands (once the stack is scaffolded)

The settings allow these without prompts: `pnpm …`, `turbo …`, `biome …`, `tsc …`, `npx prisma …`. The `building-feature` skill requires lint + typecheck + build + tests to pass before a feature is considered done.
