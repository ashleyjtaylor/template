# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A bootstrappable monorepo template for shipping new SaaS products. Forked per product. Currently has `apps/api` (Hono on ECS Fargate behind an ALB) wired with better-auth, an `audit_log` table, and a deploy pipeline to staging. Frontends and worker not yet scaffolded.

**Read the project overview first.** [`.claude/memory/project_overview.md`](.claude/memory/project_overview.md) is the source of truth for stack, architecture, schema, deployment, billing model, and every load-bearing decision. This file is a quick-reference; the overview is the design.

[`.claude/memory/progress.md`](.claude/memory/progress.md) is the chronological log of what has actually shipped — read alongside the overview when you need to know whether something is "designed" vs "deployed."

Stack at a glance: TypeScript + pnpm workspaces + Turborepo + Biome. Backend = Hono + tRPC + Prisma + Postgres + BullMQ + Redis on ECS Fargate. Frontends = Vite + TanStack Router + Tailwind + shadcn/ui (separate SPAs for `web`, `internal`, optional `portal`). Auth = self-hosted better-auth. Billing = Stripe Checkout + Customer Portal with per-seat overage. Infra = AWS CDK (3 stacks: network/data/app, 2 envs: staging/prod). CI/CD = GitHub Actions with OIDC, trunk-based with promote-by-image.

The repo is **forked per product**. Each new product is a clean fork into its own GitHub repo, deploying into a shared AWS account with prefixed naming and per-product tags.

## Workflow skills

Invoke the matching skill at each phase rather than ad-hoc:

- `/project-init` — initial scoping interview, run once at project start; outputs `.claude/memory/project_overview.md`
- `/pre-feature` — non-trivial features must go through this interview before any code is written (requirements, data model, API, error cases, tests, infra, CI/CD); produces a ticket in `docs/tickets/`
- `/building-feature` — Definition of Done checklist; a feature is not complete until lint/typecheck/build/tests pass, both local and production paths are implemented, and **all relevant docs are updated in the same PR** (the documentation step is a hard checkpoint, not a "we'll get to it")
- `/commit` — drafts a Conventional Commits message for currently staged changes
- `/debug` — structured debugging (state what's known, narrow the failing layer, verify assumptions, add diagnostic logging before guessing at fixes)
- `/code-style` — cross-language baseline (TS / formatting / naming / errors / whitespace). Frontend specifics live in `/css` and `/react`.
- `/css` — Tailwind 4 + shadcn, design tokens, typography, layout (flex first, grid only for genuine 2D), recurring visual patterns
- `/react` — SPA module structure (`modules/<feature>/`), file-based routing, TanStack Query + the `api` wrapper, error UX, component patterns
- `/database` — schema, prefixed entity IDs, migrations, FK/cascade rules, the `audit_log` table conventions
- `/auth` — better-auth wiring, `staffRole` + `requireStaff`, bootstrap mechanism, session vs JWT, `additionalFields`, CSRF/origin, env vars
- `/infra` — AWS CDK stack design, deploy order, secrets, security groups, SPA hosting (CloudFront + S3 OAC), the `workflow_dispatch` one-shot sibling pattern, common failure patterns
- `/git-workflow` — branching, hooks, PR, destructive-op rules

The skill files are the durable conventions. When you're about to add a new pattern (a column, a route, a CDK resource), read the relevant skill first.

## Other documentation

- [`docs/system-design.md`](docs/system-design.md) — current deployed topology (AWS infra diagram, security groups, deploy flow)
- [`docs/endpoints.md`](docs/endpoints.md) — per-route API documentation
- [`docs/runbooks/`](docs/runbooks/) — operational procedures including [`local-dev.md`](docs/runbooks/local-dev.md)
- [`docs/tickets/`](docs/tickets/) — durable per-feature plans

## Common commands

The settings allow these without prompts: `pnpm …`, `turbo …`, `biome …`, `tsc …`, `npx prisma …`. The `building-feature` skill requires lint + typecheck + build + tests to pass before a feature is considered done.
