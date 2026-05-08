# Template

A bootstrap template for shipping new SaaS products. Forked per product.

## Quickstart

```bash
nvm use                              # picks up Node 24.15.0 from .nvmrc
npm install -g pnpm@11.0.8           # if pnpm is not already installed
pnpm install
```

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

## Pinned versions

| Tool | Version |
| --- | --- |
| Node.js | 24.15.0 (LTS Krypton) |
| pnpm | 11.0.8 |
| TypeScript | 6.0.3 |
| Biome | 2.4.14 |
| Turbo | 2.9.9 |

## Design

Stack, architecture, and load-bearing decisions live in [`.claude/memory/project_overview.md`](.claude/memory/project_overview.md).

Process skills live in [`.claude/skills/`](.claude/skills) — invoke them via `/<skill>` in Claude Code.

## Conventions

- Conventional Commits enforced via commitlint (commit-msg hook).
- Biome auto-fixes formatting on `git commit` via lefthook (pre-commit hook).
- Trunk-based: feature branches merge into `main`. Production deploys are tags on `main`.
