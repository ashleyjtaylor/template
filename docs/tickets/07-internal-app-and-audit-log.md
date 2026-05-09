# 07 — `apps/internal` scaffold + audit log page (staff dashboard MVP)

Plan agreed via `/pre-feature` before implementation begins.
To be shipped via `feat/internal-app-audit-log`.

First SPA in the repo. First staff-only auth boundary. First CloudFront + S3 origin. First `/api/*` path prefix. First bootstrap mechanism. Local + staging deploy from day one (per the strengthened `building-feature` DoD).

Substantial PR — see the chunking note at the bottom for how it ships incrementally.

## Requirements

- **Day-one capability**: navigate to the apps/internal URL, log in with bootstrap creds, see a paginated/filterable audit log, click a row for the full event detail. Works locally via `pnpm dev` and on staging via the deployed CloudFront URL.
- "Done" bar:
  1. `pnpm dev` runs API + SPA together; bootstrap creds work locally; `/audit` shows real `audit_log` rows from local Postgres.
  2. After staging deploy + one-time `workflow_dispatch` bootstrap, the CloudFront URL serves the SPA; `/login` accepts bootstrap creds; `/audit` shows real rows from staging RDS.
  3. Customer signup via `/api/auth/sign-up/email` works (no regression); the resulting user has `staffRole = null` → cannot access `/api/audit-log` (403).

## Data model

One Prisma schema change to `User`:

```prisma
staffRole String?  // null | 'support' | 'engineer' | 'admin' (narrowed at the helper layer; better-auth's additionalFields type is just `string`)
```

- Migration `add_staff_role`: `ALTER TABLE "user" ADD COLUMN "staffRole" TEXT`. Trivial.
- Wired via better-auth `user.additionalFields.staffRole = { type: 'string', required: false, input: false }` so API callers can never set their own role.
- DB-level invariant ("staff cannot also be a customer org member" per `project_overview.md` line 113) preserved as design intent for the org-landing PR — no code change here (orgs don't exist yet).

No other schema changes.

## API design (all under `/api/*` — breaking move for existing routes)

**Path prefix migration:**

- `/auth/*` → `/api/auth/*` (better-auth `basePath: '/api/auth'`; mount becomes `app.on(['POST', 'GET'], '/api/auth/*', ...)`).
- `/health` and `/health/ready` **stay un-prefixed** — the ALB target-group probe hits them direct (not via CloudFront), and CI's smoke step hits them direct on the ALB DNS.
- All future API routes go under `/api/*`.

**New endpoints:**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/audit-log` | staff | Cursor-paginated list. Query: `action`, `from`, `to`, `requestId`, `cursor`, `limit` (default + cap 50). Response: `{ rows, nextCursor }`. Sort: `createdAt DESC`. |
| `GET` | `/api/audit-log/:entityId` | staff | Single row by `aud_<uuid>`. 404 if missing. |
| `GET` | `/api/audit-log/actions` | staff | Sorted unique action strings (sourced from the typed `AuditEvent` union) for the SPA filter dropdown. |

**Response row shape:**

```ts
type AuditLogRow = {
  entityId: string
  createdAt: string  // ISO
  action: string
  actorUser: { entityId: string; email: string } | null
  actorImpersonator: { entityId: string; email: string } | null
  resourceType: string | null
  resourceId: string | null
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
  details: unknown
}
```

JOINs User on `actorUserId` / `actorImpersonatorId` so the SPA renders emails without N+1.

**Cursor**: opaque base64 of `{ createdAt, entityId }` for stable order under inserts.

**Auth helper** (`apps/api/src/lib/auth-helpers.ts`):

```ts
async function requireStaff(c: Context): Promise<Session>
// Throws UnauthorizedError (401) if no session, ForbiddenError (403) if staffRole == null.
// Single source of truth: the column.
```

## SPA — `apps/internal`

**Stack** (locked in interview Q3): Vite + TanStack Router (file-based) + TanStack Query + Tailwind + shadcn/ui + REST + inlined Zod schemas (move to `packages/schemas` at second consumer).

**Route layout** (file-based):

```
apps/internal/src/routes/
  __root.tsx                    Top layout
  login.tsx                     Public — login form
  _authed.tsx                   Pathless: beforeLoad → /api/auth/get-session, redirect to /login if null
  _authed/index.tsx             Redirects to /audit
  _authed/audit.tsx             List page
  _authed/audit.$entityId.tsx   Detail page
```

**Auth flow:**

- `/login` POSTs `/api/auth/sign-in/email` (better-auth's existing route). On success → `navigate('/audit')`. On 401 → inline error.
- `_authed` `beforeLoad` redirects to `/login` if unauthenticated.
- 403 from `/api/audit-log` → "Not authorised" view (covers the case where a customer user with a session reaches the SPA).
- No signup form, no forgot password (deferred until SES wired).

**API client**: `apps/internal/src/lib/api.ts` — typed `fetcher` wrapping `fetch` + Zod parse.

## Bootstrap mechanism

**Single self-contained script** at `apps/api/scripts/bootstrap-staff.ts`:

- Reads `BOOTSTRAP_STAFF_EMAIL` / `_PASSWORD` / `_NAME` / `_ROLE` from `process.env`.
- Idempotent: if user exists → ensure `staffRole` is set (don't touch password). If not → `auth.api.signUpEmail()` (so password is hashed via better-auth) → `prisma.user.update({ staffRole })`.
- Inputs come at trigger time only — never persisted as long-lived env vars.

**Local**: `pnpm bootstrap:staff --email=… --password=… --name="…"` (CLI args via `tsx`).

**Staging / future production**: `.github/workflows/bootstrap-staff.yml` with `workflow_dispatch`-only trigger:

- Inputs: `environment`, `email`, `name`, `password` (masked via `::add-mask::`), `role` (default `admin`).
- Step: `aws ecs run-task` against the bootstrap task definition with **runtime env overrides** carrying the inputs. Waits for completion, dumps logs on failure.
- Triggered **once per env spinup**, never on regular deploys.

## Infrastructure (CDK)

**DataStack** changes:

- New `bootstrap-staff` Fargate task definition + log group `/ecs/${PRODUCT}-${envName}-bootstrap`. Same image as the migrator. Empty env block for bootstrap creds (they come from runtime overrides). DB secrets injected (it talks to RDS). New CFN outputs: `BootstrapStaffTaskDefArn`, `BootstrapStaffLogGroupName`.
- **No** new field in `app-secrets`. **No** long-lived bootstrap env vars.

**AppStack** changes:

- New private S3 bucket `${PRODUCT}-${envName}-internal-spa` (SSE, lifecycle rules to prune old bundles).
- New CloudFront distribution with two origins:
  - **S3 origin** (via OAC) for `/*` — SPA bundle. Cache hashed assets 1 year; `index.html` no-cache.
  - **ALB origin** for `/api/*` — forwards `Cookie`, `Authorization`, `Origin`, no caching.
  - Custom error response: 404 from S3 → return `index.html` 200 (SPA routing).
- API task env: `BETTER_AUTH_URL` and `CORS_ORIGINS` shift from ALB DNS → CloudFront DNS (https).
- New CFN outputs: `InternalSpaUrl`, `InternalSpaBucketName`.

**No** new RDS, Redis, security groups, NAT changes.

**Cost delta**: ~$1-3/mo (CloudFront free tier covers our scale; S3 storage pennies; bootstrap-staff task only runs on manual trigger).

## Env vars

| Var | Source local | Source production |
|---|---|---|
| `BOOTSTRAP_STAFF_EMAIL` / `_NAME` / `_PASSWORD` / `_ROLE` | CLI arg / shell env (one-shot) | Workflow input → ECS env override (one-shot, masked) |
| `BETTER_AUTH_URL` | `http://localhost:3000` (default) | CDK injects `https://${cloudfront.distributionDomainName}` |
| `CORS_ORIGINS` | `apps/api/.env` (`http://localhost:5173`) | CDK injects CloudFront URL |

No long-lived bootstrap env vars anywhere.

## Error handling

- `400 ValidationError` for bad query params (Zod).
- `401 UnauthorizedError` (no session), `403 ForbiddenError` (not staff).
- `404 NotFoundError` (detail not found).
- No 409 / 422 — read-only endpoints.

## CI/CD

`.github/workflows/ci.yml`:

- **`ci`** job extends to lint/typecheck/test `apps/internal` (Turborepo handles via filter).
- **New `build-spa`** job (parallel to `build-image`): `pnpm --filter @template/internal build`, uploads `apps/internal/dist/` as artifact.
- **`deploy-app`** job: also `aws s3 sync` the SPA artifact + CloudFront invalidation for `/index.html`.
- **`smoke`** job: also `curl` the CloudFront URL and assert it serves `index.html`.

DAG:

```
ci, cdk → deploy-infra → build-image, build-spa → migrate-db → deploy-app → smoke
```

`.github/workflows/bootstrap-staff.yml` (new, separate file): `workflow_dispatch`-only. Not part of the CI DAG. Triggered once per env spinup.

## Testing

**API** — `apps/api/test/integration/audit-log.test.ts` (new):

1. List: 200 with rows + `nextCursor` (staff)
2. List: 401 (no session)
3. List: 403 (authed, `staffRole = null`)
4. List: filter by `action` narrows results
5. List: cursor pagination returns next page with no overlap
6. Detail: 200 with the matching row
7. Detail: 404 missing
8. Actions: returns sorted unique actions

Existing auth tests get paths updated `/auth/*` → `/api/auth/*`. `/health` + `/health/ready` tests stay un-prefixed.

**SPA** — minimal:

- `apps/internal/src/lib/api.test.ts`: one Zod parse test (happy path + malformed-row case).
- CI's `build-spa` IS the smoke for "the SPA compiles."
- No Playwright in this PR. The `smoke` step asserting CloudFront serves `index.html` covers E2E.

## Documentation (every item lands in this PR per the strengthened DoD)

- `docs/tickets/07-internal-app-and-audit-log.md` — this plan, first commit.
- `docs/system-design.md` — extend topology Mermaid (CloudFront + S3); update deploy-flow Mermaid for new DAG; note `/api/*` prefix migration; mention bootstrap-staff as a separate workflow_dispatch path.
- `docs/endpoints.md` — add `/api/audit-log`, `/api/audit-log/:entityId`, `/api/audit-log/actions`. Update existing entries for `/api/*` prefix; keep `/health` + `/health/ready` un-prefixed with a note.
- `docs/runbooks/local-dev.md` — add "Running the SPA" section; add `pnpm bootstrap:staff` command.
- **New runbook** `docs/runbooks/staff-bootstrap.md` — when to trigger the workflow_dispatch, what inputs to provide, how to recover from accidental staff removal (re-trigger the workflow).
- `.claude/memory/project_overview.md` — note `staffRole` shipped, bootstrap pattern (workflow_dispatch only — no long-lived env), CloudFront/S3 wiring; `apps/internal` is now scaffolded.
- `.claude/memory/progress.md` — new entry at the top on merge.
- `.claude/skills/auth/SKILL.md` — add `staffRole` + `requireStaff` pattern + bootstrap mechanism (workflow only, single source of truth = column); document `/api/*` prefix.
- `.claude/skills/database/SKILL.md` — note `staffRole` field on User; update audit_log section to mention the read-API exists.
- `.claude/skills/infra/SKILL.md` — add CloudFront + S3 OAC pattern; bootstrap-staff task as a workflow_dispatch sibling of the migrator; the runtime-env-override pattern for one-shot tasks.

## Out of scope (deferred — explicit follow-ups)

- **Staff-management UI** (set/clear `staffRole` via the dashboard) — own next PR. Replaces the workflow_dispatch path for adding additional staff after bootstrap.
- **Customer organisations + DB-level invariant** — own PR.
- **Impersonation** — needs the staff-management UI + a session-creation endpoint setting `actor_impersonator_id`. The `audit_log.actor_impersonator_id` column is already there waiting.
- **API request log** (Stripe-style "every HTTP request stored") — own `/pre-feature` after this lands.
- **Apps/web** (customer SPA) — own `/pre-feature`.
- **Forgot password / email verification / magic link** — need SES.
- **OAuth providers, 2FA** — own PRs.
- **Real DNS** (`internal.staging.acme.io`) — when domain decided.
- **Playwright E2E** — when there's a second SPA worth its keep.

## Implementation chunking

Roughly 12 chunks, each a single-concern commit, stopping for review after each `git add`:

1. This ticket
2. API path-prefix migration (`/auth/*` → `/api/auth/*`; `/health` stays) + existing test updates
3. `staffRole` column + migration + better-auth `additionalFields` wiring
4. `requireStaff` helper + audit-log API routes + tests
5. `apps/internal` empty scaffold (Vite + TanStack Router + Tailwind + shadcn, no pages yet)
6. Login page + `_authed` boundary + session check
7. Audit list page + API client wrapper
8. Audit detail page + cross-link from list
9. CloudFront + S3 CDK (synth-only, no SPA upload yet)
10. CI: `build-spa` + S3 sync + CloudFront invalidation + `BETTER_AUTH_URL`/`CORS_ORIGINS` switch to CF URL
11. Bootstrap script + ECS task def + `workflow_dispatch` + new runbook
12. Doc catch-up (system-design, endpoints, project_overview, runbooks, skills, progress)

Some may collapse if tiny; some may split if they grow. Surfacing chunk boundaries as we go.
