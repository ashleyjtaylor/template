---
name: project_overview
description: Bootstrappable monorepo template for shipping new SaaS products — full stack, architecture, and load-bearing design decisions
type: project
---

# Project Overview

A bootstrappable monorepo template designed to be **forked per product** and shipped as an independent SaaS application. Core plumbing (auth, billing, infra, CI/CD, admin tooling, async work) is wired up so each new product fork starts at "v1 of a real SaaS" rather than "blank pnpm monorepo."

The goal is **minimum friction to add bespoke product features** on top of opinionated defaults. Generic functionality is template-default; product-specific logic is layered on per fork.

---

## Per-product shape

- **Repo model**: each new product is a fresh fork into its own GitHub repository. No shared codebase between products. Template improvements are cherry-picked into existing forks manually (and rarely — most forks diverge fast).
- **AWS account**: a single shared AWS account hosts every product fork. Resource isolation is by **prefixed naming** (`${productSlug}-${env}-${role}`) and **resource tags** (`Product`, `Environment`, `ManagedBy=cdk`).
- **Environments per fork**: 2 — `staging` and `production`. No PR-preview environments. Staging runs against test credentials (Stripe test mode, separate Google OAuth client, sandboxed SES domain).
- **DNS per fork**: each product owns one Route53 hosted zone for its apex (e.g. `acme.io`). Subdomains: `app.`, `portal.` (if scaffolded), `internal.`, `api.` for prod; `*.staging.acme.io` for staging.

---

## Monorepo layout

```
apps/
  web/          consumer/end-user SPA (default scaffold)
  internal/     staff platform admin SPA (default scaffold)
  portal/       business-side SPA (B2B2C only — scaffolded on demand)
  api/          Hono + tRPC HTTP server (single backend)
  worker/       BullMQ consumer + scheduled jobs (shares packages/services with api)

packages/
  auth/         better-auth wrapper, session helpers, getCurrentUser, assertCan, getOrgAccessState
  billing/      Stripe SDK wrapper, entitlement resolver, comp grant logic
  db/           Prisma client, repository helpers (soft-delete-aware)
  email/        react-email templates + SES sender (provider-swappable facade)
  emails/       email template components (separate from packages/email so templates are pure UI)
  entitlements/ pure plan → entitlements lookup
  errors/       typed error classes (ConflictError, NotFoundError, etc.)
  events/       in-process bus + outbox + BullMQ adapter
  ids/          prefixed id generators (id('usr') etc.)
  schemas/      shared Zod schemas (request/response shapes)
  test-factories/ typed builders for tests (createOrgWithOwner, etc.)
  types/        cross-package TypeScript types (string unions, branded ids)
  ui/           shared headless React primitives (rare; most UI lives per-app)

infra/
  cdk/
    network-stack.ts   VPC, subnets, NAT, security groups
    data-stack.ts      RDS, Redis, ECR, Secrets, S3 (uploads)
    app-stack.ts       ECS services (api + worker), ALB, CloudFront, Route53, ACM

templates/
  spa-app/            scaffold for `pnpm scaffold:app <name>`

scripts/
  bootstrap-staff.ts  one-shot to create the first staff user in any env
  seed.ts             idempotent seed script (--scenario=minimal|dev|e2e)
```

Tooling: **pnpm** (workspaces) + **Turborepo** (task graph + caching) + **Biome** (lint/format) + **TypeScript**.

**Package extraction rule.** Each `packages/*` is created when it has its **second** consumer, not pre-created. Until then, the same code lives inline in the single consuming app (e.g. error classes start in `apps/api/src/lib/errors.ts` and move to `packages/errors/` when the worker arrives). The list above describes the *eventual* shape; at any given commit, some packages may not yet exist — `git status` is the truth.

---

## Apps

| App | Audience | Auth boundary |
|---|---|---|
| `apps/web` | End users | any authenticated user |
| `apps/portal` (optional) | Business-side customers in B2B2C products | membership with `role >= admin` (i.e. `owner` or `admin`) |
| `apps/internal` | Platform staff (us) | session has `staffRole != null` AND verified 2FA |
| `apps/api` | All clients (tRPC + non-tRPC routes) | per-procedure |
| `apps/worker` | (none — background) | n/a |

`apps/web` and `apps/internal` are **always scaffolded by default**. `apps/portal` is added per-fork via `pnpm scaffold:app portal`, which copies `templates/spa-app/` and wires up CDK + CI + DNS + the auth boundary.

`apps/internal` ships with a persistent sidebar layout — brand wordmark, nav links (Home, Audit log), env+SHA badge driven by `/health`, three-state theme switcher (light / dark / system, persisted in localStorage), and a UserMenu with sign-out. A single `AuthGate` at `__root.tsx` runs the redirect logic via `useSession()` (wraps `GET /api/auth/get-session`); per-page 401 effects are not needed. Home is a placeholder dashboard with TBD widget cards.

---

## Identity & access

### Authentication: `better-auth` (self-hosted)

- Stores users + sessions in our Postgres alongside business data; no external auth SaaS.
- All app code talks to `packages/auth` — never imports from `better-auth/*` directly. The facade is the swap-out point if the library changes or is replaced.
- **Sessions**: DB-backed (better-auth default). Redis-backed sessions deferred until session lookups dominate latency.
- **Methods enabled**: email + password, magic link, Google OAuth. Add others per-fork.
- **Email verification**: required, 24-hour grace window during which the account works but email-sending features are gated.
- **2FA (TOTP)**: optional for end users (UI exposed in settings); **mandatory for staff** — staff sessions without verified 2FA are rejected at the `apps/internal` boundary.
- **Cookies**: `Domain=.acme.io` (per fork), `Secure`, `HttpOnly`, `SameSite=Lax`. Cross-subdomain so `app.acme.io` and `api.acme.io` share the session.
- **CORS**: explicit allowlist of frontend origins per env, no wildcards.

### Tenancy: organisations + memberships (many-to-many)

- Users can belong to multiple organisations. Sign-up creates a personal organisation by default.
- A user's "active org" is part of session state.
- **Invitations**: email-based, token tied to org + email, token redeemed on acceptance.
- Organisation deletion: owner-only, soft-delete with 30-day restore window, then hard-delete (cancels Stripe sub, deletes uploads, anonymises in audit log to preserve referential integrity).

### Roles + authorisation

- Roles are a fixed string union per membership: `'owner' | 'admin' | 'member'`.
- All authz decisions go through `assertCan(membership, action)` in `packages/auth`. **No inline `if (role === ...)` checks anywhere.** The implementation today is a hardcoded matrix; swapping in a permissions table is a single-file change.
- Action naming convention: `'resource:verb'` (e.g. `'members:invite'`, `'org:manage'`, `'documents:edit'`). Kept consistent so the eventual `role_permissions` schema is just `(role, action)` pairs.
- Billing entitlements use a parallel helper: `assertEntitled(org, feature)` and `getLimit(org, key)`, sourced from plan entitlements + per-org overrides.

### Staff identity

- **Same `users` table** as customer users, with `staffRole` field (`null | 'support' | 'engineer' | 'admin'`).
- **DB-level invariant**: a user with `staffRole != null` cannot also be a member of a customer organisation (Prisma `@@check` + service-layer assertion). Prevents privilege-escalation footguns.
- Staff users are bootstrapped via the `bootstrap-staff` script — `pnpm --filter @template/api bootstrap:staff --email=…` locally, and the `bootstrap-staff` GitHub Actions workflow (`workflow_dispatch` only) for any deployed env. The workflow runs `aws ecs run-task` against a dedicated Fargate task definition with `BOOTSTRAP_STAFF_*` passed as runtime env overrides — no long-lived bootstrap secrets on the task def or in Secrets Manager. After the first, additional staff are added through `apps/internal` (UI deferred — workflow remains the path until then).

### Impersonation

- Staff with `staffRole >= 'support'` can impersonate any customer user from `apps/internal`.
- Impersonation creates a scoped better-auth session: `actorUserId = staffUserId`, `expiresAt = +30min`.
- Customer-facing UI shows a non-dismissable banner during impersonation: *"Acme Support is signed in as you."*
- Every action during impersonation is double-logged in `audit_log` (actor + impersonated user).
- Hard denylist: impersonated sessions cannot perform billing changes, role mutations, or destructive ops (org delete, member removal).

---

## Data layer

### Prisma + Postgres

- **Single source of truth** in `apps/api/prisma/schema.prisma`. The `db` package re-exports the typed client.
- **Migrations**: `prisma migrate deploy` runs as an **ECS one-off task** before every API rolling deploy. Never at container startup (causes boot storms when ECS scales out).

### Soft-delete

- `deleted_at TIMESTAMPTZ NULL` on every "live" entity: `users`, `organizations`, `memberships`, `subscriptions`, `uploads`, plus product-domain entities per fork.
- Repository layer in `packages/db` defaults all queries to `deleted_at IS NULL`. Internal staff tools can opt-in to include soft-deleted rows for restore flows.
- **Hard-delete** (no `deleted_at`): `sessions`, magic-link tokens, password-reset tokens, `stripe_events` after retention, orphan `uploads` rows.
- **Audit log is append-only**, never deleted.

### Identifiers

- **Stripe-style truncated prefixed IDs** for every system-generated identifier — entities (`usr_…`, `org_…`, `memb_…`, `sub_…` (ours, not Stripe's), `upl_…`, `aud_…`, `cgrt_…`) and ephemeral identifiers (`req_…` for HTTP request IDs). Any new identifier follows the same `prefix_<id>` shape with a 3-4 char truncated prefix; the full registry lives in the `database` skill.
- Underlying generator: `crypto.randomUUID()` (Node native, no dep) for both entity IDs and ephemeral IDs. When `packages/ids` lands, it owns the generator. Better-auth-managed tables (User, Session, Account, Verification) get the prefixed `entityId` via the adapter's `additionalFields.defaultValue`; better-auth's own internal `id` column stays untouched.
- External Stripe IDs stored in dedicated `stripe_id` columns, never used as primary keys.

### Dates + money

- **Dates**: stored as `timestamp with time zone` (UTC), transmitted as ISO 8601 strings, manipulated via `date-fns`. No `moment`. UI converts to user TZ at render only.
- **Money**: stored as integer minor units (`amount_cents: integer` + `currency: char(3)`). Never floats. `dinero.js` only if a fork does arithmetic.

### Audit log

- `audit_log` table: `entity_id` (PK, `aud_<uuid>`), `request_id`, `action`, `actor_user_id`, `actor_impersonator_id`, `resource_type`, `resource_id`, `ip_address`, `user_agent`, `details` (JSONB), `created_at`. Append-only by code discipline; `writeAudit` is the only write path. Indexed by `(actor_user_id, created_at)`, `(resource_type, resource_id, created_at)`, `(action, created_at)`, and `request_id`.
- Scope: **auth lifecycle** (signup, login, logout, password change, …) **+ org governance** (create, member invite, role change, billing change) **+ staff actions** in `apps/internal` (especially impersonation, double-logged with both actor + impersonated user). Customer per-domain mutations get their own per-table history, not audit log.
- Storage in main Postgres. Append-only forever; on user deletion the actor IDs get nulled (`updateMany`) but rows survive. Detailed conventions (`writeAudit` usage, action naming, DO/DON'T for `details`, anonymisation rule) live in the `database` skill.

---

## API + validation

### Hono + tRPC

- `apps/api` is Hono on Node.js (long-lived process on ECS Fargate).
- **tRPC owns the typed contract** between `apps/api` and the SPAs. No OpenAPI generation, no manual client.
- Non-tRPC routes (auth callbacks, Stripe webhooks, health check, file-upload pre-signing for non-browser clients) are plain Hono handlers.

### Validation

- **Zod everywhere**: tRPC inputs, env-var parsing, non-tRPC request bodies, better-auth config, Stripe webhook payload shape.
- Shared schemas live in `packages/schemas`. A schema validating a form in `apps/web` is the same schema validating the tRPC procedure in `apps/api` — single source of truth.
- **Env validation**: `apps/*/src/env.ts` parses `process.env` through a Zod schema at startup; the process refuses to boot on missing/invalid fields.

### Errors

- Typed error classes in `packages/errors`: `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `InternalError`.
- tRPC error formatter wraps them at the boundary into a standardised wire shape: `{ code: ErrorClassName, message, details? }`.
- Frontend has one `formatError(err)` helper consumed by all UI; no per-call ad-hoc parsing.
- Workers throw/catch the same classes — same code, same patterns.

### Rate limiting

- **better-auth** built-in limiter for auth routes (Redis-backed): login, signup, password reset, magic link, email verification.
- Hono middleware in `apps/api` for tRPC procedures: 10/min per IP for unauthenticated, 100/min per user for authenticated. Configurable per-procedure.

### Webhooks (incoming)

Pattern (used by Stripe; reusable for any future provider):

1. `POST /webhooks/:provider` — Hono handler verifies signature.
2. Insert raw event into `${provider}_events` (idempotency key = provider event id).
3. Return 200 immediately.
4. Enqueue a `${provider}-webhook` BullMQ job referencing the event id.
5. Worker fetches the row, dispatches by `event.type`, marks processed.

Webhook handlers are **idempotent by event id** — duplicate deliveries are no-ops.

---

## Frontend

### Framework: TanStack Router + Vite

- Build target: SPA (deployed to S3 + CloudFront). No SSR, no edge runtime.
- TanStack Router chosen for first-class type-safe search params (admin tables with filter/sort/pagination URL state) and tight integration with TanStack Query (which `@trpc/react-query` builds on).

### UI

- **Tailwind CSS** as the styling substrate.
- **shadcn/ui** components copy-pasted into `apps/<name>/src/components/ui` (intentionally not an installed dependency — owned and modifiable per app).
- **Dark mode** wired up by default via `next-themes` (works outside Next.js).
- **Forms**: React Hook Form + Zod resolver. Schemas from `packages/schemas`.
- **Tables**: TanStack Table (headless), URL-state via TanStack Router search params.
- **Toasts**: `sonner`.
- **Error boundaries**: per-route via TanStack Router's `errorComponent`, plus a top-level boundary that reports to Sentry.

### Data

- `@trpc/react-query` is the only data-fetching primitive. No SWR, no Redux Query, no manual fetch.
- Client state: React state + `zustand` if/when needed. No Redux Toolkit by default.

---

## Async work + events

### Job queue: BullMQ + Redis

- `apps/worker` consumes BullMQ queues; ECS service alongside `apps/api`, sharing `packages/services` so business logic is written once.
- Per-queue concurrency caps configurable via env vars (sensible defaults: emails 5, webhooks 10).
- **Dead-letter queue** for jobs that exhaust retries; CloudWatch alarm on DLQ depth > 0.
- **Bull Board** mounted at `apps/internal/queues` behind staff auth — visibility without SSH.
- Idempotency: every job handler treats itself as idempotent on `jobId`.

### Events

- **In-process bus** (`packages/events`): typed `DomainEvent` union, `events.emit()` looks up subscribers in a registry and either calls in-process or enqueues a BullMQ job per the subscriber's declared transport. Handlers are transport-agnostic.
- **Outbox pattern** for events emitted from within a DB transaction: an `outbox` row is INSERTed in the same transaction; a small worker drains the outbox to BullMQ. Eliminates the dual-write problem (DB committed but publish failed, or vice versa).

### Scheduled / cron jobs

- Native BullMQ repeatable jobs. Definitions live in `apps/worker/src/schedules.ts`, register on boot, version-controlled.
- Per-customer schedules ("send daily digest at 9am in user's TZ") use delayed jobs that reschedule themselves.

### Real-time

- **Not in the template default.** When a fork needs WebSockets/SSE, document points to the recommended pattern (SSE in Hono for one-way push; managed service like Pusher/Ably for two-way).

---

## Billing: Stripe

### Surface

- **Stripe Checkout** for new subscriptions (no custom payment Elements).
- **Stripe Customer Portal** for self-service (change card, change plan, view invoices, cancel).
- Keeps PCI scope at SAQ A.

### Subscription shape

- **Per-organisation** subscription. `organizations.stripe_customer_id` and `subscriptions.organization_id` (1:1 active sub).
- **Two line items per subscription**:
  - Item 1: Plan (qty=1, includes the owner seat)
  - Item 2: Seat (qty = `members - 1`, soft cap)
- Seat sync triggered by `org.seat_count_changed` events written to outbox on accepted membership add/remove. Worker calls `stripe.subscriptions.update` with the new quantity. Stripe prorates automatically.
- `seat_quantity` denormalised on `subscriptions` for fast queries.

### Plans + entitlements

- **Plans defined in Stripe** (products + prices), with a `planKey` in price metadata linking to code-managed entitlements.
- **Mirror tables** (`stripe_products`, `stripe_prices`, `subscriptions`, `invoices`) populated by webhook handlers — read-only from app code.
- **Entitlements** in `packages/entitlements`: pure function `entitlementsForPlan(planKey, overrides) → { seats, features, limits }`.
- Enforcement: `assertEntitled(org, 'integrations.slack')` + `getLimit(org, 'seats')`.
- Per-org overrides via `feature_flag_overrides` (staff-controlled), winning over plan defaults.

### Signup → paywall flow (no trials)

```
sign up → verify email → create org → /onboarding/subscribe → Stripe Checkout → access
                                                ↑
                                  comp grant (set by staff) bypasses this entirely
```

- Paywall is a route guard in `apps/web`: any authenticated session whose org has no active subscription AND no active comp grant gets redirected to `/onboarding/subscribe`.
- `getOrgAccessState(org)` in `packages/billing` is the single resolver: `comped > paid > paywalled`. tRPC procedures, route guards, UI banners all consume it.
- `past_due` still grants access (Stripe Smart Retries running); UI shows a "card declined" banner.

### Comps

- Single primitive: `comp_grants` table (`organization_id`, `plan_key`, `granted_at`, `expires_at`, `granted_by_user_id`, `note`, `revoked_at`). No user-redeemable codes.
- Staff in `apps/internal` set comps directly on an org. Audit-logged.
- Auto-expiry job runs hourly: expired comps with no active sub trigger a "your early access has ended" email + UI banner; paywall clicks back in on next request.

### Conversion nudges

- BullMQ scheduled jobs at signup + 1h, +24h, +3d. Each checks `getOrgAccessState()`; if still paywalled, sends a SES email via react-email templates.

### Internal-app billing actions

- Issue refund (full/partial) — calls Stripe API, audit-logged.
- Comp an org (direct grant).
- Cancel/reactivate subscription — proxies to Stripe API.
- View invoice history with hosted-invoice links.
- Resend receipt.
- All mutations go through Stripe APIs; no direct DB edits to mirror tables.

### Tax + currency

- **Stripe Tax: enabled by default.**
- Default currency USD; mirror tables are multi-currency-aware (no `usd`-baked column types).
- Payment methods in Checkout: card + Apple Pay + Google Pay.

### What's per-fork (not template-default)

- Actual plan definitions in Stripe (template ships one reference `Pro` plan).
- Pricing page UI (varies wildly per product).
- Coupons / promo codes (enable in Stripe + Checkout config).
- Usage-based billing (Stripe Billing meters).
- Free tier (add a `Free` plan_key with limited entitlements; skip the paywall for that plan).

---

## Email

- **Amazon SES** for delivery, **react-email** for templates.
- **`packages/email`** is the swap-out facade — app code calls `sendEmail({ to, template, props })`. Today calls SES; a fork can swap to Resend/Postmark in ~50 LOC.
- **Templates** are React components in `packages/emails/`, previewable via `react-email dev`, snapshot-tested.
- **Bounce + complaint handling**: SES → SNS → SQS → BullMQ → updates `email_suppressions` table. Better-auth + Stripe handlers check this table before sending.
- **Per-env sender domains**: prod uses `noreply@acme.io`; staging uses `noreply@staging.acme.io` to avoid deliverability cross-contamination.
- DKIM + SPF + DMARC set up in CDK per fork. Each fork's AWS account needs a one-time SES production-access ticket.
- **Local dev**: Mailhog catches all outgoing email at `:8025`.

---

## File uploads: S3 with pre-signed URLs

### Flow

1. Client calls `uploads.requestUrl({ kind, mimeType, size })`.
2. Server validates: size ≤ kind-specific cap, mime in allowlist, `assertCan` on the parent resource.
3. Server creates `uploads` row (`status: 'pending'`), returns 10-min pre-signed PUT URL.
4. Client PUTs directly to S3.
5. Client calls `uploads.confirm(id)`.
6. Server `headObject`s S3, transitions status to `confirmed`, links to parent resource.

### Layout

```
s3://{product}-{env}-uploads/{orgId}/{kind}/{uploadId}
```

### Public vs private (by `kind`)

- `avatar`, `org_logo` → public, served via CloudFront with long cache TTL.
- `attachment`, `document`, customer files → private, served via short-lived pre-signed GET URLs from `uploads.getUrl(id)` (re-checks authz).

### Cleanup

- Daily BullMQ job hard-deletes `pending` uploads older than 24h and their orphaned S3 objects.

### Local dev

- **MinIO** (S3-compatible) in Docker Compose. Same S3 SDK with a different endpoint URL — no code change between local and prod.

### Not in template

- Virus scanning. Per-fork add-on for products taking customer files at scale (ClamAV in Lambda triggered by S3 ObjectCreated, or a third-party scanner).

---

## Infrastructure (AWS, CDK)

### Stack split per environment (lifecycle, not resource type)

```
{product}-{env}-network    VPC, subnets, NAT gateway(s), security groups
{product}-{env}-data       RDS, ElastiCache Redis, ECR, Secrets Manager, S3 (uploads), ECS cluster, migrator task def
{product}-{env}-app        ECS services (api + worker), ALB, CloudFront, Route53, ACM
```

ECR lives in `data` (image must exist before ECS can start). The ECS cluster also lives in `data` so the migrator one-off task can run before `app` deploys; the api / worker services in `app` import the cluster via cross-stack ref. Tags applied via stack-level CDK aspects: `Product`, `Environment`, `ManagedBy=cdk`.

### Environments

- **Staging**: minimum sizes — `db.t4g.micro` 20GB single-AZ, `cache.t4g.micro` single node, 1 ECS task each at 0.25 vCPU / 0.5GB Fargate min, single NAT gateway. ~$50–70/mo per fork before traffic. Optional CDK switch to schedule shutdown overnight/weekends.
- **Production**: `db.t4g.small` Multi-AZ, `cache.t4g.small` 2 nodes, ECS API 2 tasks autoscale 2–10, worker 1 task autoscale 1–4, dual-AZ NAT. ~$220/mo before traffic.

### Security groups (least privilege chain)

- ALB SG: inbound 80/443 from internet
- ECS SG: inbound app port from ALB SG only
- RDS SG: inbound 5432 from ECS SG only
- Redis SG: inbound 6379 from ECS SG only
- No inbound rule = default deny.

### Secrets

- AWS Secrets Manager, one JSON secret per env (`{product}-{env}-app-secrets`) containing all keys.
- ECS reads each field as a separate env var via `ecs.Secret.fromSecretsManager(secret, 'FIELD_NAME')`.
- Never `environment:` for secrets in CDK.
- Populated **out-of-band** after the data stack deploys, before the app stack deploys.

### DNS

```
PROD:                                   STAGING:
acme.io          (marketing, n/a)       app.staging.acme.io
app.acme.io      → CloudFront → S3      portal.staging.acme.io
portal.acme.io   → CloudFront → S3      internal.staging.acme.io
internal.acme.io → CloudFront → S3      api.staging.acme.io
api.acme.io      → CloudFront → ALB
```

One Route53 hosted zone for the apex; staging and (future) preview live as records inside it.

### First-deploy sequence (always sequential)

1. Deploy network + data stacks.
2. Populate secrets out-of-band.
3. Build + push API/worker Docker image.
4. Deploy app stack.

Subsequent deploys: push image → CI orchestrates ECS rolling update; CDK only runs on infra changes.

---

## CI/CD

### Workflow shape

Three workflow files, split by purpose:

- **`.github/workflows/ci.yml`** — PR + push validation only. Runs on every PR and every push to `main`.
- **`.github/workflows/deploy-staging.yml`** — `workflow_dispatch`-only deploy DAG. Operator triggers from the Actions tab after the green check on `main`.
- **`.github/workflows/bootstrap-staff.yml`** — `workflow_dispatch`-only one-shot for creating / promoting a staff user (sibling to the deploy DAG, never wired into it).

Staging is intentionally pull-based — pushes to `main` don't auto-deploy, so doc/code merges don't unintentionally restart torn-down infra. To switch back to push-driven, change the `on:` block in `deploy-staging.yml`.

Job naming is `<verb>-<target>` (e.g. `build-api-image`, `deploy-internal-spa`) so each job says what it does and which thing it does it to. Single-word jobs (`ci`, `smoke`, `commitlint`) keep their conventional names.

Job layout:

- **Validation** (`ci.yml`, every PR + push to `main`):
  - `ci` — install → Biome → typecheck → test (unit + integration with Postgres service container).
  - `cdk-synth` — `cdk synth` against all stacks.
  - `commitlint` (PR-only).
  - `build-api-image` (PR-only) — builds `apps/api/Dockerfile` so Dockerfile breakage fails the PR.
  - `build-internal-app` (PR-only) — builds the apps/internal Vite bundle so SPA build breakage fails the PR.
- **Staging deploy DAG** (`deploy-staging.yml`, `workflow_dispatch` only):
  - `deploy-network-data` — `cdk deploy` network + data stacks with `-c imageTag=${sha}` so the migrator + bootstrap-staff task definitions reference the SHA the next job is about to push.
  - `build-api-image` — `docker build` + push image tagged `${sha}` to ECR.
  - `build-internal-app` — `vite build` + upload bundle as a workflow artifact (parallel with the API path; doesn't depend on infra).
  - `migrate-db` — ECS one-off task running `prisma migrate deploy`.
  - `deploy-app-stack` — `cdk deploy` app stack with `imageTag` context (rolling ECS update; creates the CloudFront distribution + S3 bucket on first run).
  - `deploy-internal-spa` — downloads the SPA artifact, two-pass-syncs to S3 (long-cache + immutable for hashed assets, no-cache for `index.html`), invalidates `/` + `/index.html` on CloudFront. Sequenced after `deploy-app-stack` so the distribution exists.
  - `smoke` — poll ALB `/health` (asserting `version` matches the SHA + `env` matches `APP_ENV`) and curl CloudFront for the SPA shell (asserting `id="root"`).
  - On green, re-tag the image as `staging-passed-${sha}` for promotion (deferred — see below).
- **Production deploy DAG** (deferred — `deploy-production.yml` doesn't exist yet):
  - When the production env is wanted, mirror `deploy-staging.yml` with `environment: production` and an environment-protected approval rule. Verify the SHA has a `staging-passed` tag, require approval, re-tag as `v${tag}` → `migrate-db` → `deploy-app-stack` → `deploy-internal-spa` → `smoke`. **No rebuild** — the same image binary that passed staging runs in production (promote-by-image).

Each future SPA (`apps/web`, `apps/portal`) follows the same pattern: a `build-<name>` job in both files (PR sanity + deploy artifact) and a `deploy-<name>-spa` job in `deploy-staging.yml`.

### Promote-by-image (critical)

The same Docker image binary that ran in staging E2E is what runs in production. Production deploy **never rebuilds** — it re-tags the existing ECR image. Eliminates the "staging passed but prod broke" class of bugs.

### AWS access

- **OIDC** federation. GitHub Actions assumes a per-env IAM role (`acme-deploy-staging`, `acme-deploy-production`) scoped to the relevant stacks. **No long-lived AWS access keys** in GitHub.

### Branching

- **Trunk-based**, short-lived feature branches, merge via PR with CI green + 1 review.
- `main` is always deployable.
- Production deploys are **tags on `main`** (e.g. `v1.2.3`) — the tag is the audit trail.

---

## Testing

### Pyramid

- **Unit** (Vitest) — pure logic in `packages/*` and service layer in `apps/api`. No I/O. Run on every push.
- **Integration** (Vitest + real Postgres in CI service container, MinIO + Redis where needed) — hit tRPC procedures end-to-end through the actual router with a real DB. **No mocking the DB.** Stripe + SES stubbed via `MockStripe` / `MockEmailSender` that record calls.
- **E2E** (Playwright) — runs against staging after every staging deploy. Golden paths only: signup → org creation → checkout → invite → impersonation → comp grant. ~10–15 scenarios. Uses real Stripe test mode.
- **Smoke** post-deploy — minimal `curl`-or-Playwright set verifying the deploy is alive on staging and prod.

### Fixtures

- **Per-test transaction rollback**: each integration test runs inside a Postgres transaction rolled back at end. No fixture cleanup, no test-order dependence.
- **Factories** in `packages/test-factories` — typed builders (`createOrgWithOwner({ plan: 'pro' })`). Tests never call `prisma.create` directly.
- **Time control** with `vi.useFakeTimers()` for date-sensitive flows (trial-end, comp-expiry).

### Default coverage shipped in template

- Auth (signup, login, logout, verification, password reset, magic link, invite acceptance)
- Org/membership (create, invite, accept, change role, remove, last-owner protection)
- Billing (checkout, webhook → mirror, seat sync, comp grant + expiry)
- Authz (every `assertCan` action: positive + negative)
- Internal app (impersonation guardrails, audit log writes, comp grant flow)

~60–80 tests. Sets the bar without becoming a maintenance burden.

---

## Observability

### Sentry (per-fork project)

- `@sentry/react` in frontends (TanStack Router integration; replay at 10% sample rate).
- `@sentry/node` Hono middleware in `apps/api`; tRPC error formatter pipes errors through.
- `@sentry/node` BullMQ failed-job hook in `apps/worker`.
- Release tracking: every CI build sets `SENTRY_RELEASE=${git-sha}`, uploads source maps during CI (stripped from S3 deploy).
- User context: `setUser({ id: userId, organization: orgId })`. **No PII** (no email, no name).

### Logs

- **pino** (JSON in prod, pretty in dev) → ECS → CloudWatch Logs (one log group per service per env).
- Retention: 30 days staging, 90 days prod.
- Structured fields per log line: `traceId`, `userId`, `orgId`, `route`, `level`, `service`, `release`. Pino mixin populates them via async-local-storage.
- Search: CloudWatch Logs Insights. **No paid log aggregation SaaS** in the default.

### Metrics + alarms

- AWS-emitted metrics for free: ALB, ECS, RDS, Redis.
- App-level custom metrics via CloudWatch EMF: `auth.signups`, `auth.login_failed`, `billing.checkout_completed`, `billing.subscription_active` (gauge), `jobs.duration` (histogram), `jobs.failed`, `jobs.dlq_depth`.
- **Pre-built CloudWatch dashboard per env** (CDK-defined).
- Alarms (CDK-defined) → SNS → email:
  - 5xx rate > 1% / 5min
  - API p95 latency > 500ms / 5min
  - DLQ depth > 0
  - ECS service unhealthy
  - RDS CPU > 80% / 10min
  - RDS connections > 80% of max / 5min
  - Stripe webhook backlog > 1min
  - Comp grant expiring tomorrow (informational)

### Health endpoints

Two routes, different consumers:

- **`GET /health`** — liveness. Returns `200 { status, version, uptime }` whenever the process is up; that's all it checks. Used by the **ALB target health check** (no DB dependency, so a slow query never blackholes traffic). Hit by ALB every 30s; excluded from the request logger to keep CloudWatch signal clean.
- **`GET /health/ready`** — readiness. Probes every required dependency (DB now; Redis, queue, etc. as they land). Returns `200` when all dependencies are reachable, `503` otherwise. Used by **internal tooling and monitoring**, not by ALB. Failures here do **not** pull tasks out of rotation — that's deliberate, a temporary RDS hiccup shouldn't take the whole service down.

### Not included by default

- OpenTelemetry / X-Ray distributed tracing (Sentry perf covers 80%).
- External uptime / synthetic monitoring (just `/health` for ALB).
- Analytics (PostHog / Mixpanel / Plausible) — per-fork.

### Audit log vs application log

- Application logs (pino → CloudWatch): debugging, ops, ephemeral, aged out.
- Audit log (Postgres table): permanent, "who did what, when" for compliance/support.

---

## Local development

### Docker Compose (repo root)

- Postgres (`:5432`)
- Redis (`:6379`)
- MinIO (`:9000`, console `:9001`) — local S3
- Mailhog (`:1025` SMTP, `:8025` web UI) — local email catcher

### Scripts

```
pnpm dev               turbo dev — starts api, worker, web, internal with hot-reload
pnpm db:reset          drop + recreate + migrate + seed
pnpm db:seed           idempotent seed (--scenario=minimal|dev|e2e)
pnpm db:studio         prisma studio
pnpm typecheck         turbo typecheck
pnpm test              turbo test
pnpm test:e2e          playwright against local
pnpm lint              biome
pnpm scaffold:app      add a new SPA (e.g. portal)
pnpm bootstrap:staff   one-shot to create the first staff user in any env
```

### Stripe webhooks locally

`stripe listen --forward-to localhost:3000/webhooks/stripe` (Stripe CLI). Documented in README; not started by `pnpm dev` because `stripe login` is a one-time setup.

### Seed data

- `apps/api/prisma/seed.ts`. Idempotent (upserts). `--scenario` flag:
  - `minimal` — single staff user (used by bootstrap script).
  - `dev` — realistic local dev: 3 orgs in different states (paywalled, paid, comped), members at various roles, sample audit log entries, sample uploads.
  - `e2e` — deterministic data Playwright tests assume.

---

## Cross-cutting

### Account deletion

- **User self-deletion**: soft-delete with 30-day restore window via support; hard-delete via scheduled job after 30 days (PII anonymised, row preserved for referential integrity in audit logs).
- **Org deletion**: owner-only, requires confirmation, 30-day restore window, then cancels Stripe sub + hard-deletes uploads.

### First-staff bootstrap

- Local: `pnpm --filter @template/api bootstrap:staff --email=you@example.com --name="…" --password=… --role=admin`.
- Deployed envs: trigger the `bootstrap-staff` GitHub Actions workflow (`workflow_dispatch` only). It runs `aws ecs run-task` against the `${product}-${env}-bootstrap` Fargate task definition with `BOOTSTRAP_STAFF_*` as runtime env overrides — bootstrap creds appear at trigger time only.
- Idempotent: creates the user with the requested `staffRole` if missing; promotes an existing user to the requested role; no-op if already at that role. Never touches the password on a re-run.
- Magic-link email + SES delivery deferred until the email transport lands; today the operator hands the chosen password to the new staff member out of band.
- After the first staff user, additional staff are added through `apps/internal` by existing staff (UI deferred; workflow remains the path until the staff-management UI ships).

### CSRF

- `SameSite=Lax` cookies. Better-auth handles auth-route CSRF; tRPC's POST-only mutation surface + the same-site cookie blocks CSRF on mutations.

### Code style

- See the `code-style` skill at `.claude/skills/code-style/SKILL.md` — applies repo-wide.
- Key rules: no comments by default, string union types over enums, typed error classes, no inline role checks, no defensive validation outside system boundaries.

### Workflow skills

The repo's `.claude/skills/` contains process skills. Future Claude instances should invoke them at the matching phase:

- `/pre-feature` — interview before writing code on any non-trivial feature.
- `/building-feature` — Definition of Done checklist; lint + typecheck + build + tests must pass; both local and production paths implemented (e.g. local file upload AND pre-signed S3).
- `/discuss` — stress-test a plan one question at a time.
- `/debug` — structured debugging.
- `/infra` — AWS CDK design and review.
- `/code-style` — apply conventions to a file or module.

---

## Per-fork extension points

When a fork needs to deviate, these are the named places to do it:

- **New domain entities** → `apps/api/prisma/schema.prisma` + `packages/services/<domain>` + tRPC router under `apps/api/src/routers/<domain>` + `packages/schemas/<domain>` for shared Zod.
- **New plans / entitlements** → Stripe (products + prices with `planKey` metadata) + `packages/entitlements/plans.ts`.
- **New `assertCan` actions** → extend the `Action` union in `packages/auth`, add to the role matrix.
- **New emails** → `packages/emails/<TemplateName>.tsx` + send call via `packages/email`.
- **New apps (e.g. `apps/portal`)** → `pnpm scaffold:app <name>` (uses `templates/spa-app/`, wires up CDK + CI + DNS + auth boundary).
- **Branding + UI** → shadcn components in `apps/<name>/src/components/ui` are owned per-app; theme tokens in `apps/<name>/tailwind.config.ts`.
- **Per-product staff actions** → routes under `apps/internal/src/routes/` + procedures in `apps/api/src/routers/internal/`.
- **Fork-specific integrations** → new `packages/<integration>` module with its own facade + tests.

---

## Explicitly deferred (NOT in template default)

These are real concerns; they're left out because adding them prematurely creates dependencies forks may never need.

- API keys for programmatic access (per-org keys, scopes, rotation, last-used).
- Outgoing webhooks to customer URLs (signing, retries, customer-facing management UI).
- Session listing UI ("active devices, log out everywhere") — better-auth has the data; UI is per-fork.
- WebSockets / SSE / real-time.
- i18n / multi-region.
- SAML/OIDC SSO + SCIM provisioning (year-2 problem when an enterprise customer demands it; WorkOS is the recommended bolt-on).
- Custom email branding per organisation.
- Mutation testing, contract testing, load testing.
- Cross-region disaster recovery.
- Virus scanning on uploads.
- Analytics (PostHog / Mixpanel / Plausible) — per-fork choice.
- Feature flag SaaS (LaunchDarkly / Statsig / ConfigCat) — per-fork when serious A/B testing arrives.

---

## Backups + DR

- **RDS automated backups**: 7-day retention staging, 30-day retention prod, daily snapshot in low-traffic window.
- **RDS point-in-time recovery**: enabled in prod (default with automated backups).
- **S3 versioning + lifecycle**: enabled on the prod uploads bucket, 30-day retention for deleted versions. Staging has versioning off.
- **Single-region** (us-east-1 or eu-west-1, fork's choice). No cross-region replication in v1.
- **Restore runbook** at `docs/runbooks/restore-from-backup.md` with the actual `aws rds restore-db-instance-to-point-in-time` command. Tested once during template development.
