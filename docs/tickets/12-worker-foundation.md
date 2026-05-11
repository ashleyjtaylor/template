# 12 — Worker foundation (BullMQ + Redis + outbox + events bus + scheduled jobs)

## Goal

Scaffold `apps/worker` with Redis-backed BullMQ, an in-package events bus, transactional outbox pattern, and scheduled-jobs registration. Land package extractions for `db`, `errors`, and the new `events`. Ship a synthetic heartbeat for proof-of-life, one real schedule (cleanup of stale invitations), and outbox-routed `invitation.created` events with a noop logger subscriber. The email PR plugs in next.

## Acceptance criteria

- `pnpm dev` brings up Redis, API, worker, both SPAs; worker logs heartbeats.
- `events.emit({ type: 'invitation.created', ... }, { tx })` inside the invitation-create transaction reliably triggers the logger subscriber after commit.
- Cleanup schedule hard-deletes invitations where `expires_at < now() - interval '30 days' AND accepted_at IS NULL AND revoked_at IS NULL`.
- Staff member reaches `/api/admin/queues` in deployed staging, sees the queues, can retry a failed job.
- Worker survives `SIGTERM` with in-flight jobs draining cleanly before the ECS `stopTimeout`.
- All tests green; CI builds both `api` and `worker` images; `deploy-staging` deploys both ECS services.

## Data model — one new table

```
outbox
  entity_id     text  pk, obx_<uuid>
  request_id    text  nullable
  topic         text  the event type, e.g. 'invitation.created'
  payload       jsonb
  target_queue  text  which BullMQ queue receives the published job
  created_at    timestamptz default now()
  processed_at  timestamptz nullable until published
  attempts      int default 0
  last_error    text nullable

index (processed_at, created_at)   -- publisher pull
```

No other schema changes.

## Packages

**`packages/db`** — Prisma client + schema + migrations move here from `apps/api`.

- `apps/api/prisma/schema.prisma` → `packages/db/prisma/schema.prisma`
- `apps/api/prisma/migrations/` → `packages/db/prisma/migrations/`
- `apps/api/prisma.config.ts` → `packages/db/prisma.config.ts`
- `apps/api/src/lib/db.ts` → `packages/db/src/index.ts` (`globalThis` dev-stashing + adapter wiring)
- Apps import `prisma` from `@template/db`
- Migrator ECS task runs `pnpm --filter @template/db prisma migrate deploy`

**`packages/errors`** — typed error classes + `formatError` move from `apps/api/src/lib/errors.ts`. Apps import from `@template/errors`. No infra change.

**`packages/events`** — new. Owns:

- `DomainEvent` typed union (every event the app emits)
- `events.emit(event, { tx? })` — producer-side; writes outbox row or enqueues directly
- `events.on(type, handler, { queue })` — subscriber registration API
- BullMQ `Queue` instances (one per named queue) and queue-name constants
- Shared `IORedis` connection factory
- Outbox publisher implementation (a reusable repeatable job)
- Routing logic: given an event + its registered subscribers, enqueue to the right queues

**Deferred packages** (single-consumer today): `packages/auth`, `packages/jobs` (typed payload schemas for external commands), `packages/services`.

## Producer/consumer surface

```ts
// Producer (apps/api)
events.emit({ type: 'invitation.created', invitationId, orgId, email }, { tx })

// Subscriber registration (apps/worker boot)
events.on('invitation.created', invitationCreatedHandler, { queue: 'internal' })
```

**Bull Board** — `GET /api/admin/queues/*`, mounted in `apps/api`, gated by `requireStaff`. `apps/internal` sidebar gets a "Queues" nav item that opens Bull Board in a new tab. `/api/admin/*` becomes the namespace for staff-only operational tools, distinct from feature data routes like `/api/audit-log`.

## Queue layout (template default)

| Queue          | Purpose                                            | Concurrency | Retries                            |
| -------------- | -------------------------------------------------- | ----------- | ---------------------------------- |
| `internal`     | Default fan-out for events with no specific channel | 5           | 3, exponential backoff (1s, 5s, 25s) |
| `outbox-publisher` | 1s repeatable publisher (singleton)                | 1           | 3                                  |
| `schedules`    | Repeatable schedule executions                     | 3           | 3                                  |

Per-queue concurrency configurable via `WORKER_QUEUE_<NAME>_CONCURRENCY` env vars. Forks add queues by editing `packages/events/queues.ts` — e.g. `emails` (typically 5), `webhooks` (typically 10) land with their respective feature PRs.

## Events shipping in this PR

All tied to existing template surface; fork-specific events come later by appending to the `DomainEvent` union and adding subscribers under `apps/worker/src/subscribers/`.

| Event / job                       | Why template-appropriate                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `worker.heartbeat`                | Framework-level proof-of-life. Synthetic but operationally useful as a smoke check.                        |
| `invitation.created`              | `org-invitations` module already exists; emits inside the create transaction; subscriber is a logger today, email PR replaces it. |
| `cleanup.expiredInvitations` (schedule) | Generic housekeeping that every fork wants; runs hourly; hard-deletes stale rows.                          |

## Error handling + retry policy

- BullMQ built-in retries: 3 attempts, exponential backoff `{ type: 'exponential', delay: 1000 }`.
- After max retries: job lands in BullMQ "failed" state; visible in Bull Board, manual retry.
- Per-queue retry overrides at registration time.
- Stalled-job recovery: built-in (30s lock duration).
- Handler idempotency by `jobId` convention — required, not framework-enforced.
- CloudWatch alarm: per-queue `failed > 5 in 5 min` → SNS.

## Graceful shutdown

Mirrors `apps/api/src/lib/shutdown.ts`:

- `SIGTERM`/`SIGINT` → close all BullMQ `Worker` instances (drain in-flight up to `SHUTDOWN_TIMEOUT_MS`, default 25 000).
- `prisma.$disconnect()`.
- Quit `IORedis`.
- `process.exit(0)`.

ECS task `stopTimeout: 30s`; drain fits inside the SIGKILL window.

## Integration points

- **Postgres**: outbox table + cleanup schedule target (invitations).
- **Redis**: BullMQ store + repeatable schedule registrations.
- **ECS**: worker runs as a separate service alongside api.

Effects on existing modules:

- `apps/api/src/modules/org-invitations/services.ts` — invitation-create transaction adds one `events.emit({ ... }, { tx })` line. Subscriber is a logger; email PR replaces it.
- `apps/api/src/lib/db.ts`, `apps/api/src/lib/errors.ts` — relocated to packages, all imports updated.

External services not introduced in this PR: SES, S3 uploads, Sentry — deferred to their own tickets.

## Testing plan

**Unit (Vitest, no I/O):**

- `packages/events`: `emit()` routing with and without `{ tx }`; subscriber registration; queue mapping.
- Outbox publisher logic (mocked Prisma + Queue).
- Cleanup schedule SQL builder.
- Graceful-shutdown sequencing.

**Integration (real Postgres + Redis service containers in CI):**

- `emit(event, { tx })` inside a transaction → outbox row → publisher tick → subscriber fires once.
- `emit(event)` outside a transaction → BullMQ enqueue → subscriber fires.
- Publisher idempotent — re-tick doesn't double-deliver.
- Heartbeat schedule fires on its configured interval.
- Cleanup schedule deletes matching invitations, leaves others alone.
- Bull Board route: staff session 200, unauth 401, non-staff 403.

**No E2E in this PR.** Bull Board is the user-facing surface but it's a vendor UI; Playwright comes when there's something fork-specific to assert.

## Infrastructure (CDK)

**NetworkStack** — add `redisSg` (inbound `:6379` from `ecsSg` only).

**DataStack** — add ElastiCache Replication Group:

- `numCacheClusters: 1` staging (`cache.t4g.micro`), `2` prod (`cache.t4g.small`).
- AUTH token: auto-generated, stored as `redisAuthToken` field on existing `${PRODUCT}-${envName}-app-secrets` JSON.
- TLS in-transit enabled (`transitEncryptionEnabled: true`).
- Single-AZ staging, multi-AZ prod.
- New CFN outputs: `RedisHost`, `RedisPort`.
- New ECR repo `${PRODUCT}-${envName}-worker` (sibling to the api repo).

**AppStack** — add worker ECS service:

- Fargate, 0.25 vCPU / 0.5 GB staging; 0.5 vCPU / 1 GB prod.
- 1 task staging (no autoscale), 1–4 tasks prod (autoscale on CPU).
- No port binding, no ALB target group.
- New CloudWatch log group `/ecs/${PRODUCT}-${envName}-worker`, 30d staging / 90d prod.
- Same Secrets Manager secret + new `REDIS_*` env.

**Shared env additions (api + worker):**

- `REDIS_HOST`, `REDIS_PORT` (plain env, sourced from CFN outputs).
- `REDIS_AUTH_TOKEN` (Secrets Manager field).
- `env.ts` transform composes `REDIS_URL = rediss://default:${authToken}@${host}:${port}` for deployed envs; local dev overrides to `redis://localhost:6379` (no TLS, no auth).

**Worker-specific env:**

- `WORKER_QUEUE_INTERNAL_CONCURRENCY` (default 5).
- `WORKER_QUEUE_SCHEDULES_CONCURRENCY` (default 3).
- `SHUTDOWN_TIMEOUT_MS` (default 25000, shared convention with api).

**`APP_ENV` enum** updated: `'local' | 'staging' | 'production'` (renames `'development'` → `'local'`). Touches `apps/api/src/env.ts`, both SPA `EnvBadge.tsx` files, `bin/app.ts`, and any CDK `envName` plumbing. Captures the convention: `APP_ENV === 'local'` is the single switch for local-service substitutes (Mailpit instead of SES, MinIO instead of S3 when those land, etc.). No per-service `*_TRANSPORT` env vars.

## CI/CD

**`ci.yml`:**

- New `build-worker-image` job — PR sanity, mirrors `build-api-image`.
- `ci` job — add Redis service container alongside Postgres; tests use both.

**`deploy-staging.yml`:**

- New `build-worker-image` job — `docker build` + push to `template-staging-worker` ECR repo, tagged `${sha}` (parallel with `build-api-image`).
- `deploy-network-data` — adds Redis on first run.
- `deploy-app-stack` — CDK rolls out both api + worker ECS services on the same `imageTag` context.
- `smoke` — extended: assert worker is alive (poll CloudWatch for heartbeat log entries, or hit a queue-health endpoint via Bull Board).
- Promote-by-image (deferred to production deploy ticket) — both images re-tagged atomically with `staging-passed-${sha}` after smoke passes.

**Renovate / version-pinning** — Node + pnpm versions already covered; BullMQ + IORedis added under the standard regex managers.

## Local dev

**`docker-compose.yml`** — add Redis:

```yaml
redis:
  image: redis:8-alpine
  container_name: template-redis
  ports: ['6379:6379']
  healthcheck:
    test: ['CMD', 'redis-cli', 'ping']
    interval: 5s
```

**`pnpm dev`** — `apps/worker` participates automatically via workspace globbing; `tsx watch` for hot-reload.

**`.env.example`:**

- `apps/api/.env.example` — add `REDIS_URL=redis://localhost:6379`, update `APP_ENV=local`.
- New `apps/worker/.env.example` — `APP_ENV`, `LOG_LEVEL`, `REDIS_URL`, `DB_*`, `SHUTDOWN_TIMEOUT_MS`.

## Deferred (explicit follow-up surface)

- `packages/auth`, `packages/jobs`, `packages/services` extractions — single-consumer today; land with their second consumer.
- **Email + SES + bounce/complaint handling** — own ticket; this PR's `invitation.created` subscriber is a logger that the email PR replaces.
- **Stripe webhooks** — own ticket; uses direct `queue.add()` (external boundary crossing), not the events bus.
- **DLQ → richer alerting** (PagerDuty, Slack) — basic CloudWatch alarm only in this PR.
- **Bull Board cosmetics** (branding, custom auth flow) — vendor defaults.
- **Per-test transaction rollback** for worker integration tests — adopt when there's a write-heavy worker test that needs it.
- **Production deploy DAG** including the dual-image promote-by-image — own ticket once production is wanted.
