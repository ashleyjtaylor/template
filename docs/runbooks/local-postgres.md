# Local Postgres

Spin up Postgres locally via Docker Compose and apply Prisma migrations. Required for `pnpm test` (the integration test connects to a real database) and for `pnpm dev` (the API queries Postgres on `/health/ready`).

## First-time setup

```bash
docker compose up -d postgres
```

This creates two databases on `localhost:5432`:

| Database | Used by | User / password |
|---|---|---|
| `template_dev` | `pnpm dev`, manual connections | `postgres / postgres` |
| `template_test` | `pnpm test` integration tests | `postgres / postgres` |

Apply migrations to both:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/template_dev pnpm --filter @template/api exec prisma migrate deploy
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/template_test pnpm --filter @template/api exec prisma migrate deploy
```

After this, `pnpm test` and `pnpm dev` both work.

## Adding a new migration

1. Edit `apps/api/prisma/schema.prisma` with the new model / column / index.
2. Generate the migration **against the dev database**:
   ```bash
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/template_dev pnpm --filter @template/api exec prisma migrate dev --name <kebab-slug>
   ```
   Prisma writes a new directory under `apps/api/prisma/migrations/<timestamp>_<slug>/` containing `migration.sql`.
3. Apply the same migration to the test database:
   ```bash
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/template_test pnpm --filter @template/api exec prisma migrate deploy
   ```
4. Commit the new migration directory **plus** the schema change.

In CI, the `migrate-db` job applies the same committed migrations to the staging RDS via the migrator ECS one-off task. Same migration files run everywhere.

## Resetting local data

If a migration goes wrong locally and you want to start over:

```bash
docker compose down -v              # destroys the postgres volume
docker compose up -d postgres       # fresh Postgres with init script re-run
# then re-apply migrations as above
```

## Connecting from a SQL client

Any client that speaks Postgres (TablePlus, DBeaver, `psql`, etc.):

```
host:     localhost
port:     5432
user:     postgres
password: postgres
database: template_dev   (or template_test)
```

## Why two databases instead of one?

- `template_dev` holds whatever data the developer is poking at while running the app.
- `template_test` is wiped/recreated by CI and integration tests.
- Keeping them separate means `pnpm test` doesn't blow away the dev's local state.

## Why pin to Postgres in Compose but not in docs?

Versions live in `docker-compose.yml` (and `package.json`, `Dockerfile`, CI workflow) where Renovate / dependabot keeps them current automatically. The narrative docs avoid version pins so they don't go stale silently.

## Stopping Postgres

```bash
docker compose stop postgres   # keeps the volume
docker compose down            # removes the container, keeps the volume
docker compose down -v         # removes the container AND the data
```
