# Template

A bootstrap template for shipping new SaaS products. Forked per product.

## Getting started

For local dev setup (prereqs, Postgres, env vars, dev server, tests, migrations) see [`docs/runbooks/local-dev.md`](docs/runbooks/local-dev.md).

## Common scripts

| Command | What |
| --- | --- |
| `pnpm dev` | Start every app in dev mode |
| `pnpm build` | Production build |
| `pnpm lint` | Biome check (lint + format) |
| `pnpm lint:fix` | Biome check + auto-fix |
| `pnpm format` | Biome format |
| `pnpm typecheck` | TypeScript across all workspaces |
| `pnpm test` | Run all tests |

## Where things live

- [`.claude/memory/project_overview.md`](.claude/memory/project_overview.md) — stack, architecture, and load-bearing design decisions
- [`.claude/memory/progress.md`](.claude/memory/progress.md) — what has actually shipped, in reverse chronological order
- [`docs/system-design.md`](docs/system-design.md) — current deployed topology (AWS infra, security groups, deploy flow)
- [`docs/endpoints.md`](docs/endpoints.md) — per-route API documentation
- [`docs/runbooks/`](docs/runbooks/) — operational procedures (local dev, CDK bootstrap, OIDC setup, staging teardown)
- [`docs/tickets/`](docs/tickets/) — durable plans agreed via `/pre-feature` before implementation
- [`.claude/skills/`](.claude/skills/) — process skills, invoked via `/<skill>` in Claude Code

## Conventions

- Conventional Commits enforced via commitlint (commit-msg hook).
- Biome auto-fixes formatting on `git commit` via lefthook (pre-commit hook).
- Trunk-based: feature branches merge into `main`. Production deploys are tags on `main`.
- Node + pnpm versions pinned in `package.json` (`engines`, `packageManager`); managed via [Volta](https://volta.sh).
