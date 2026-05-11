# Local development

End-to-end setup for working on this repo locally — Postgres, Redis, env vars, the dev server, and tests.

## Prerequisites

- **Node + pnpm** — managed via [Volta](https://volta.sh). The pinned versions live in `package.json`'s `engines` and `packageManager`. Once Volta is installed, `cd` into the repo and Volta auto-uses the pinned versions.
- **Docker** — for the local Postgres + Redis containers.
- A POSIX shell (zsh, bash). All commands assume you're at the repo root unless noted.

## First-time setup

```bash
pnpm install
docker compose up -d                       # starts both postgres and redis
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
```

`.env` is gitignored. The example values work as-is; only swap `BETTER_AUTH_SECRET` if you want a deterministic dev secret.

Apply Prisma migrations to **both** local databases:

```bash
pnpm --filter @template/db exec prisma migrate deploy
DB_NAME=template_test pnpm --filter @template/db exec prisma migrate deploy
```

After this, `pnpm dev` and `pnpm test` both work.

## Env vars

`apps/api/.env.example` documents every env var the API needs locally. The notable ones:

| Var | Purpose |
|---|---|
| `NODE_ENV=development` | Lets libraries that read `process.env.NODE_ENV` directly (e.g. better-auth's IP-resolver dev fallback) know we're not in prod |
| `APP_ENV=local` | Which deployed environment we are — drives any conditional logic (e.g. Mailpit vs SES, MinIO vs S3) inside facade packages |
| `BETTER_AUTH_SECRET` | Signs better-auth session cookies — any 32+ char string locally |
| `BETTER_AUTH_URL=http://localhost:3000` | Canonical base URL better-auth uses for OAuth callbacks, email links, and CSRF/trustedOrigins fallback |
| `CORS_ORIGINS=http://localhost:3000` | Origins allowed for both Hono CORS and better-auth's CSRF check |
| `REDIS_URL=redis://localhost:6379` | Connection string for the local Redis container. Deployed envs use `rediss://` with `REDIS_HOST` + `REDIS_PORT` + `REDIS_AUTH_TOKEN` instead |

In production the same vars come from Secrets Manager (`BETTER_AUTH_SECRET`, `REDIS_AUTH_TOKEN`) and CDK-injected env (`BETTER_AUTH_URL`, `REDIS_HOST`, `REDIS_PORT`). DB connection vars in production come from RDS's auto-generated secret.

## Running the dev server

```bash
pnpm dev
```

Spawns the API at `http://localhost:3000`, the worker (no HTTP — logs to stdout), and both SPAs, all with hot-reload via `tsx watch` / `vite`. Hits `/health/ready` to verify the DB is reachable. The worker connects to Redis and starts processing the heartbeat schedule, outbox publisher, and any registered subscribers on boot.

Smoke from another terminal:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
```

For auth requests via Postman / curl, you must send an `Origin` header that matches one of the values in `CORS_ORIGINS`, otherwise better-auth returns `MISSING_OR_NULL_ORIGIN` or `INVALID_ORIGIN`. Example:

```bash
curl -X POST http://localhost:3000/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -d '{"email":"x@y.com","password":"abcd1234","firstname":"X","lastname":"Y","name":"X Y"}'
```

Browsers set `Origin` automatically; only manual tools need to specify it.

## Running the internal SPA

`apps/internal` is the staff-facing dashboard (login + audit-log views). Vite dev server, separate from the API, talks to `http://localhost:3000` for `/api/*`:

```bash
pnpm --filter @template/internal dev
```

Defaults to `http://localhost:5173`. Add the SPA origin to the API's `CORS_ORIGINS` so the browser cookie + better-auth CSRF check pass:

```
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

Without a staff user the login screen still works but every audit-log call returns 403. Create one with the bootstrap script (next section).

## Bull Board

Once logged in as staff, click **Queues** in the sidebar (or hit `http://localhost:3000/api/admin/queues/` directly) to see the live BullMQ state — jobs in flight, completed, failed, repeatables. Useful for confirming the worker is alive end-to-end and for retrying failed jobs without SSH. Bull Board serves its own server-side HTML, so the sidebar link opens a new tab.

## Bootstrapping a staff user locally

The `staffRole` column gates `/api/audit-log/*` and any future internal route. There is no UI for self-promotion (by design) — use the bootstrap script:

```bash
pnpm --filter @template/api bootstrap:staff \
  --email=you@example.com \
  --name="Your Name" \
  --password='choose-something-strong' \
  --role=admin
```

Idempotent: re-running with the same email + role is a no-op; with a different role it updates `staffRole` only. For the production / staging path see [`staff-bootstrap.md`](./staff-bootstrap.md).

## Running tests

```bash
pnpm test
```

Runs unit + integration tests across every workspace package (`@template/api`, `@template/events`, `@template/errors`, both SPAs). Tests use `template_test` (per each package's `vitest.config.ts`) and the local Redis on `:6379`. Each api integration test uses a unique email; `@template/events` tests clean the outbox table + drain the relevant queues between cases.

## Adding a new migration

1. Edit `packages/db/prisma/schema.prisma` with the new model / column / index.
2. Generate the migration **against the dev database**:
   ```bash
   pnpm --filter @template/db exec prisma migrate dev --name <kebab-slug>
   ```
   Prisma writes a new directory under `packages/db/prisma/migrations/<timestamp>_<slug>/` containing `migration.sql`.
3. **Inspect the generated SQL** before committing — Prisma 7 occasionally emits no-op `AlterTable` blocks (e.g. converting `SERIAL` to explicit-sequence form) that collide with existing DB state. Strip them.
4. Apply the same migration to the test database:
   ```bash
   DB_NAME=template_test pnpm --filter @template/db exec prisma migrate deploy
   ```
5. Commit the new migration directory **plus** the schema change.
6. After regenerating the client, run `pnpm typecheck --force` (Turbo can serve a stale cached pass otherwise).

In CI, the `migrate-db` job applies the same committed migrations to the staging RDS via the migrator ECS one-off task. Same migration files run everywhere.

## Resetting local data

If a migration goes wrong locally and you want to start over:

```bash
docker compose down -v              # destroys the postgres volume
docker compose up -d postgres       # fresh Postgres with init script re-run
# then re-apply migrations as above
```

`prisma migrate reset` is blocked when invoked from an AI agent (Prisma's safeguard); a human can run it directly.

## Connecting from a SQL client

Any client that speaks Postgres (TablePlus, DBeaver, `psql`, etc.):

```
host:     localhost
port:     5432
user:     postgres
password: postgres
database: template_dev   (or template_test)
```

## Two databases, why?

- `template_dev` holds whatever data you're poking at while running the app.
- `template_test` is the integration-test target.
- Keeping them separate means `pnpm test` doesn't blow away the dev's local state.

The Postgres init script at `docker/postgres-init.sql` creates both on container start.

## Versions in Compose, not in narrative docs

Versions live in `docker-compose.yml`, `package.json`, the Dockerfile, and CI workflow files where Renovate / Dependabot keeps them current automatically. Narrative docs avoid version pins so they don't go stale silently.

## Stopping the containers

```bash
docker compose stop            # keeps containers, keeps volumes
docker compose down            # removes containers, keeps volumes
docker compose down -v         # removes containers AND data (postgres + redis volumes)
```
