# 03 — Database setup and check

Plan agreed via `/pre-feature` before implementation begins.
To be shipped via `feat/api-db`.

## Requirements
- Scope **C**: RDS Postgres provisioned, Prisma client wired, `/health/ready` proves connectivity + schema, migration ECS one-off task wired into deploy chain, local Docker Compose Postgres, first migration creates the `_meta` lighthouse table.
- "Done" bar: a clean `cdk destroy` then re-deploy via `workflow_dispatch` produces `200 { status: "ok", checks: { db: "ok" } }` from `GET /health/ready` against the live ALB.

## Data model
- `apps/api/prisma/schema.prisma`: `model Meta` → table `_meta` with `id Int @id @default(autoincrement())` + `createdAt DateTime @default(now()) @map("created_at")`.
- First migration `apps/api/prisma/migrations/0_init/`: `CREATE TABLE _meta (...)`. Generated locally via `pnpm prisma migrate dev`, committed to git, applied in CI via `prisma migrate deploy`.

## API design
- `GET /health/ready` — public, no body.
- `200`: `{ status: "ok", checks: { db: "ok" } }`. `503`: `{ status: "unavailable", checks: { db: "down" } }`.
- Probe: `prisma.meta.findFirst()` wrapped in `Promise.race` with a 2s timeout.
- Excluded from request logger (same as `/health`).

## Error handling
- `/health/ready` only — try/catch the probe, throw → 503, log at `warn`.
- Lazy Prisma connect (default); `await prisma.$disconnect()` in the existing `registerShutdown` callback.
- No new typed error classes. Prisma-error → typed-error mapper deferred to the first real-entity handler.

## Files

### New
- `apps/api/prisma/schema.prisma` + `apps/api/prisma/migrations/0_init/migration.sql`
- `apps/api/src/lib/db.ts` — Prisma client singleton + lazy export
- `apps/api/src/middleware/health-ready.ts` — the route + 2s timeout helper
- `apps/api/src/middleware/health-ready.test.ts` — unit tests (200, 503 via mock)
- `apps/api/src/app.integration.test.ts` — runs `prisma migrate deploy` against service-container Postgres, hits `/health/ready`, asserts 200
- `docker-compose.yml` at repo root — Postgres only for this PR
- `docs/runbooks/local-postgres.md` — first-time setup + creating a migration
- CDK output exports added to NetworkStack, DataStack

### Modified
- `apps/api/src/env.ts` — adds `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`; Zod `.transform` composes `DATABASE_URL`
- `apps/api/src/app.ts` — wires the new route after the existing `/health`
- `apps/api/src/lib/shutdown.ts` — calls `prisma.$disconnect()` before exit
- `apps/api/Dockerfile` — copies `prisma/` schema + migrations, runs `prisma generate` after install
- `apps/api/package.json` — adds `prisma`, `@prisma/client`
- `pnpm-workspace.yaml` — adds `prisma` to `allowBuilds`
- `infra/cdk/lib/network-stack.ts` — adds `rdsSg` (inbound 5432 from `ecsSg`); CFN outputs for `PrivateSubnetIds`, `EcsSecurityGroupId`
- `infra/cdk/lib/data-stack.ts` — adds RDS Postgres (`db.t4g.micro`, 20 GB gp3, single-AZ, 7d backups, `removalPolicy: DESTROY`, `deletionProtection: false`), the auto-generated Secrets Manager secret, the **ECS cluster** (moved here from AppStack), the migrator task def + log group; CFN outputs for `MigratorTaskDefArn`, `ApiClusterName`
- `infra/cdk/lib/app-stack.ts` — imports `cluster` from DataStack instead of creating; injects `DB_*` env vars from RDS secret via `ecs.Secret.fromSecretsManager`
- `infra/cdk/bin/app.ts` — `imageTag` context now also passed to DataStack (for migrator task def)
- `.github/workflows/ci.yml` — `deploy-infra` now passes `-c imageTag=$SHA`; new `migrate-db` job between `build-image` and `deploy-app`; **`ci` job adds Postgres service container** + runs `prisma migrate deploy` before tests
- `.claude/memory/project_overview.md` — small tweak: ECS cluster moves to DataStack section (was AppStack)

## Infrastructure
- **RDS**: `db.t4g.micro`, 20 GB gp3, single-AZ, 7-day backups, encrypted at rest, no Multi-AZ, `removalPolicy: DESTROY`, `deletionProtection: false`. ~$16/mo additional when running.
- **Secrets**: RDS auto-generates a JSON secret with `{ host, port, username, password, dbname }`. ECS task injects 5 separate env vars via `ecs.Secret.fromSecretsManager(secret, '<field>')`. App composes `DATABASE_URL` in `env.ts`.
- **SGs**: `rdsSg` accepts `:5432` from `ecsSg` only (added to NetworkStack alongside the existing pattern).
- **ECS cluster**: relocated from AppStack to DataStack so it exists before `migrate-db` runs.
- **Migrator task def**: lives in DataStack, references API ECR image at `imageTag` from CDK context, default CMD is `npx prisma migrate deploy`. Reuses `ecsSg` and the same secret injection as the API task.

## CI/CD
- New job `migrate-db` (depends on `build-image`, gated on `workflow_dispatch`):
  - Resolves migrator task def + cluster + subnets + SG from CFN outputs.
  - `aws ecs run-task` → `aws ecs wait tasks-stopped` → check exit code.
  - On failure: dump last 5 min of `/ecs/template-staging-migrator` and exit non-zero.
- `deploy-infra` now passes `-c imageTag=${{ github.sha }}` (so the migrator task def references the SHA `build-image` is about to push).
- `ci` validation job adds a Postgres service container + a setup step (`prisma migrate deploy` against `localhost:5432`) so integration tests can run.
- Dockerfile: explicit `pnpm --filter @template/api exec prisma generate` after install (since `--ignore-scripts` skips `@prisma/client`'s postinstall).

## Testing
- **Unit** (`health-ready.test.ts`): mock `prisma.meta.findFirst`. Two tests: returns null/row → 200; throws → 503; one for the timeout path.
- **Integration** (`app.integration.test.ts`): vitest runs against the CI Postgres service container. After migration, asserts `/health/ready` → 200 with the right body. One test for now; future entity tests slot in next to it.
- **No transaction-rollback fixture yet** (single read-only test). Adds when entity tests arrive.

## Local dev
- `docker-compose.yml` ships Postgres only (`template_dev` and `template_test` databases).
- New runbook `docs/runbooks/local-postgres.md`: how to spin up Compose, create a migration with `prisma migrate dev`, run tests against `template_test`.

## Documentation
- `progress.md` — new entry on merge.
- `docs/system-design.md` — update infra Mermaid (add RDS box + migrator flow + ECS cluster's new home in DataStack); add `/health/ready` to request path section.
- `project_overview.md` — small ECS cluster placement tweak (already noted in modifications).
- New runbook `docs/runbooks/local-postgres.md`.

## Out of scope (deferred)
- Prisma error → typed error mapper (lands with first real-entity handler).
- Per-test transaction rollback (lands with first write-side test).
- Redis, BullMQ, S3, Secrets Manager for app-level secrets (separate features).
- Multi-AZ RDS, performance insights, backup-restore runbook (lands when we go production).
- Other Docker Compose services (Redis/MinIO/Mailhog) — add when their feature lands.
