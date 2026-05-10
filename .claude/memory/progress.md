---
name: progress
description: What has actually shipped on this template, in reverse chronological order. Read alongside project_overview.md — the overview is the design, this is the status.
type: project
---

# Progress

Reverse chronological log of consequential changes. One section per milestone (a meaningful PR or feature), not per commit. Renovate bumps, lint fixes, typo corrections, and trivial dependency tweaks do **not** get entries.

Each entry: date, ref(s), what landed, what's now possible, what's deferred.

---

## 2026-05-10 — `apps/web` foundation: customer SPA scaffold + auth flows + accept-invite

- **Branch / PR**: `feat/web-app-foundation`
- **Plan**: `docs/tickets/11-web-app-foundation.md`
- **What landed**:
  - **Empty Vite + TanStack Router + Tailwind 4 + shadcn/ui scaffold** at `apps/web/`. Same config shape as `apps/internal` (tsconfig, vite, vitest, components.json, index.css with the full token set). Local port **5174** so both SPAs run side-by-side under `pnpm dev`.
  - **Two duplicated modules** copied from `apps/internal`: `modules/session/` (`useSession`, `useSignIn`, `useSignUp`, `useSignUpTeam`, `useSignOut` — the three middle ones are new mutation hooks) and `modules/theme/` (verbatim copy with `STORAGE_KEY` renamed to `web:theme`). One new module: `modules/invitations/` (`usePreviewInvite` + `useAcceptInvite`).
  - **Sidebar layout matching `apps/internal`** — brand wordmark "App", single Home nav item, env+SHA badge, user menu with theme switcher + sign-out. The customer flavour drops the `staffRole` pill from `UserMenu`.
  - **Auth gate in `__root.tsx`** copied from `apps/internal` with an expanded `UNAUTHED_PATHS` (`/login`, `/signup`, `/team-signup`, `/accept-invite`).
  - **Four auth pages** sharing a new `AuthCardLayout` + `AuthField` helper (avoids four copies of the dot-grid card shell):
    - `/login` — email + password.
    - `/signup` — standard `POST /api/auth/sign-up/email`. The "team workspace" CTA is promoted to a dashed-border accent row below the form (icon + arrow), separate from the sign-in footer link.
    - `/team-signup` — composite `POST /api/orgs/sign-up`. Mirror "personal sign-up" CTA back to `/signup`.
    - `/accept-invite?token=…` — public preview via `GET /api/invitations/:token`; if signed in with the matching email, accept via `POST /api/invitations/:token/accept` and navigate to `/`. Branches on (no session / wrong email / terminal status / pending) with appropriate copy and CTAs.
  - **CDK** (`infra/cdk/lib/app-stack.ts`) — second CloudFront distribution + private S3 bucket (`${PRODUCT}-${envName}-web-spa`) sharing the same `/api/*` ALB origin and the same SPA-routing 404/403 → `index.html` rewrite. `CORS_ORIGINS` on the API container is now a comma-joined list of both CloudFront URLs so better-auth's Origin check accepts requests from either SPA. `BETTER_AUTH_URL` stays single-valued (the internal CF) — single canonical base for OAuth callbacks / email links once SES lands. New CFN outputs: `WebSpaUrl`, `WebSpaBucketName`, `WebSpaDistributionId`.
  - **CI** (`.github/workflows/`) — new `build-web-app` PR sanity job in `ci.yml`; new `build-web-app` artifact + `deploy-web-spa` jobs in `deploy-staging.yml` (sequenced after `deploy-app-stack`); the `smoke` step now iterates over both CloudFront URLs and asserts each serves `id="root"`.
  - **Tests**: 6 unit tests (theme provider) copied from `apps/internal`. No SPA-side integration / Playwright in this PR — the API integration tests already cover the endpoints, the PR-time `build-web-app` job covers compilation, and the deploy smoke covers "the bundle is being served".
- **What's now possible**:
  - Customer journey: sign up (personal or team) → land on dashboard. Open an `/accept-invite?token=…` link in a browser to consume an org invitation. The orgs PR's link contract finally has a renderer.
  - Forks pick the signup mode at fork time without ripping out the other path — both pages stay live, the landing CTA points wherever the product wants.
- **Deferred** (explicit follow-ups):
  - **Extract `session` + `theme`** to `packages/spa-shared/` (or per-concern packages). Both copies now exist; extraction PR is informed by both call sites.
  - **OAuth providers, forgot password, verify email, magic link** — need SES.
  - **"My orgs" dashboard / per-org URL space** (`/orgs/:orgId/...`) — own ticket once a real per-org feature motivates the routes.
  - **Paywall / `/onboarding/subscribe`** — needs Stripe.
  - **Account settings** (change password, delete account, list active sessions).
  - **Real DNS** (`app.staging.acme.io`).
  - **Playwright E2E**.

## 2026-05-10 — Organisations: foundations + invites + role management

- **Branch / PR**: `feat/api-organisations`
- **Plan**: `docs/tickets/10-organisations-foundation.md`
- **What landed**:
  - **Three new Postgres tables** — `organisation`, `membership`, `invitation` — with the prefixed-id (`org_`, `memb_`, `inv_`) + `requestId` + snake_case `@map` conventions. Cascade delete from organisation; the invitation→user FKs are `Restrict` for the inviter and `SetNull` for the accepter. A hand-written partial unique index enforces "at most one outstanding invitation per (org, email)" — Prisma's schema can't express partial uniqueness so the migration was extended manually after `prisma migrate dev`.
  - **Two new modules** under the route → controller → service layering:
    - `apps/api/src/modules/organisations/` — org reads/edits, member changes, transfer-ownership, the composite `/api/orgs/sign-up` (calls `auth.api.signUpEmail` then `service.createOrg` and stitches together the response).
    - `apps/api/src/modules/org-invitations/` — invitation CRUD plus the public token-keyed preview/accept routes. Imports `Role` from the orgs module's schemas; orgs module has no inverse import (one-way dep).
  - **Two new middleware** alongside `require-staff.ts` — `require-session.ts` (session-only routes) and `require-org-role.ts` (`requireMember` / `requireAdmin` / `requireOwner`, mounted under `/api/orgs/:orgId` so `:orgId` resolves at the parent and the middleware reads it via `c.req.param('orgId')`).
  - **AuditEvent union extended** with the eight org-governance variants (`organisation.created`, `name_changed`, `member.invited`, `invitation.revoked`, `invitation.accepted` with `alreadyMember`, `member.role_changed`, `ownership.transferred`, `member.removed`, `member.left`) — the placeholder `organisation.role.changed` was reshaped to `organisation.member.role_changed` for `member.<verb>` consistency.
  - **Two signup paths**, both wired today. Standard `POST /api/auth/sign-up/email` (better-auth) creates a user only — single-user-product forks use just this. New `POST /api/orgs/sign-up` is a composite for team-product forks. **No personal-org-on-signup auto-create anywhere** — `project_overview.md` was updated to reflect this and to drop "active org is part of session state" (the URL is the active org; the server has no session-level active-org concept).
  - **Last-owner protection** is enforced inside every mutation transaction by `assertLastOwner` (which calls the pure, unit-tested `wouldStillHaveOwner`). Demoting / removing / leaving the only owner returns **409** `LastOwnerRequired`.
  - **Invitation tokens** are sha256-hashed at rest (raw token never stored). The raw token is returned exactly once, in the create response, as a relative `link: '/accept-invite?token=…'` — the consumer prefixes with the SPA host. SES isn't wired yet so the inviter sends the link out-of-band; the API shape is forward-compatible with a future email worker.
  - **Tests**: 12 new unit tests (`tokens.test.ts` + `service.test.ts` for the pure last-owner check) plus 37 integration tests across `organisations.test.ts` (18) and `org-invitations.test.ts` (19), against the existing Postgres service container. All 101 api tests green.
  - **Convention work**: this PR codified the route → controller → service layering and the no-await-in-`c.json` rule into the `code-style` skill (after the audit-log refactor that established the layering); also enshrined "Hono middleware lives in `src/middleware/`, not in feature modules" alongside `require-staff.ts`.
- **What's now possible**:
  - Forks pick a signup mode at fork time without ripping out the other path.
  - Team products can create / list / fetch orgs, manage memberships, and issue / accept invites without touching better-auth's surface beyond the existing signup/signin/signout.
  - Audit log captures every org governance event today; future SPA admin views can read straight off the existing `/api/audit-log` endpoints.
- **Deferred** (explicit follow-ups):
  - Soft-delete on Organisation (30-day restore window) — own ticket alongside the org-delete UI.
  - DB-level invariant — a user with `staffRole != null` cannot be in any membership. Postgres `CHECK` constraint plus service-layer assertion.
  - `assertCan(membership, action)` / `packages/auth` extraction — happens at the second consumer (worker).
  - Email transport for invitations — own ticket; a worker consumes an `invitation.created` event and renders an SES email.
  - `apps/internal` org admin UI — own ticket; this PR is API-only.
  - `apps/web` org settings — `apps/web` doesn't exist yet.
  - Pretty slugs in URLs, `User.lastVisitedOrganisationId`, bulk invite / CSV import, custom invite expiry.

## 2026-05-10 — CI workflow reorganisation (split deploy DAG, rename jobs)

- **Branch / PR**: `chore/ci-reorg`
- **Plan**: `docs/tickets/09-ci-workflow-reorg.md`
- **What landed**:
  - **`ci.yml` slimmed to validation only.** Jobs: `ci`, `cdk-synth`, `commitlint` (PR), `build-api-image` (PR sanity), `build-internal-app` (PR sanity — new; SPA build breakage now fails the PR rather than only surfacing on the next deploy).
  - **`deploy-staging.yml` is a new file** carrying the `workflow_dispatch`-only deploy DAG: `deploy-network-data` → `build-api-image` → `migrate-db` → `deploy-app-stack` → `deploy-internal-spa` → `smoke`, with `build-internal-app` running in parallel and feeding `deploy-internal-spa`.
  - **`deploy-app` (the misnomer) split into two jobs.** `deploy-app-stack` only runs `cdk deploy`; `deploy-internal-spa` does the S3 sync + CloudFront invalidation. The SPA can now be re-pushed without redeploying the API stack, and future SPAs (`apps/web`, `apps/portal`) get their own `deploy-<name>-spa` siblings rather than growing one fat job.
  - **Job renames for clarity.** `deploy-infra` → `deploy-network-data` (matches what it actually deploys), `build-image` + `docker-build` → `build-api-image` (parallels `build-internal-app`, says which image), `cdk` → `cdk-synth`. Every job is now `<verb>-<target>` where it isn't a one-word convention.
  - **Docs updated.** `system-design.md` deploy-flow Mermaid + paragraph reflect the new shape; `staging-teardown-and-redeploy.md` re-deploy section + per-step time table updated.
- **What's now possible**:
  - The deploy DAG is one file; PR validation is another. Either can grow without entangling the other.
  - Future SPAs slot in by adding `build-<name>` and `deploy-<name>-spa` jobs to `deploy-staging.yml` (and a sanity-build sibling to `ci.yml`); no other shape change needed.
  - The SPA can be re-deployed independently of the API stack via re-running `deploy-internal-spa` (and its dependency `build-internal-app`).
- **Deferred** (explicit follow-ups):
  - **`deploy-production.yml`** — when production env is wanted; pattern is the same as `deploy-staging.yml`.
  - **Reusable `workflow_call`** for the duplicated `build-internal-app` and `build-api-image` jobs — defer until a third caller justifies the indirection.
  - **In-workflow gate** on `deploy-staging.yml` requiring a green `ci.yml` for the same SHA — operator discipline for now.

## 2026-05-10 — `apps/internal` global layout (sidebar + theme + auth gate)

- **Branch / PR**: `feat/internal-global-layout`
- **Plan**: `docs/tickets/08-internal-global-layout.md`
- **What landed**:
  - **`APP_ENV` on `/health`** — distinct from `NODE_ENV` (which is `'production'` on both staging and prod and so can't tell them apart). CDK injects `APP_ENV: envName` into the API container env. The SPA reads it for the sidebar env+SHA badge.
  - **`modules/session/{schemas,api}.ts`** — `useSession()` wraps `GET /api/auth/get-session` (which always returns 200, `null` body when unauthed) and exposes `{ user, isAuthed, isLoading }`. `useSignOut()` mutation resets the session cache on settle so the auth gate redirects immediately.
  - **`modules/theme/`** — three-state theme switcher (light / dark / system). Provider applies `dark` to `<html>`, persists the chosen value to `localStorage`, listens to live `prefers-color-scheme` changes when `'system'`. `ThemeToggle` is a Radix DropdownMenu (added as a shadcn primitive — first cross-feature consumer beyond the toggle is the sidebar UserMenu).
  - **`vitest` + `jsdom` + Testing Library** for `apps/internal` — six tests cover the theme provider's load-from-storage, system-follow, explicit-override branches. Node 24+ ships an experimental built-in `localStorage` global that collides with jsdom's; the `--no-webstorage` execArgv (top-level in vitest 4) tells Node to leave the slot to jsdom.
  - **`components/layout/{Sidebar,NavItem,EnvBadge,UserMenu}.tsx`** — sidebar shell with brand wordmark, nav links (Home, Audit log), env+SHA badge driven by `/health` (`prod=red`, `staging=yellow`, `dev=green` dot), theme dropdown, signed-in-as user menu with sign-out.
  - **`__root.tsx` rewrite** — composes Sidebar around the page Outlet on authed routes; on `/login` (and any future entry in `UNAUTHED_PATHS`) renders a bare `<Outlet />`. A single `AuthGate` runs the redirect logic via `useSession()` — unauthed users hit `/login`, signed-in users on `/login` bounce to `/`. Renders null during the session-load window to avoid a flash before redirect resolves. Audit list + detail dropped their per-page 401 useEffects.
  - **`main.tsx`** — `ThemeProvider` mounted at the app root so the dark class persists across route changes.
  - **`routes/index.tsx`** — placeholder paragraph replaced with a real Home surface (header + three TBD widget cards in a responsive grid).
- **What's now possible**:
  - Real staff workflow: log in → land on Home → see env + SHA at a glance → click Audit log → toggle dark mode → sign out — all in the deployed SPA.
  - Future internal pages slot into the Sidebar nav by adding a `<NavItem>` and a route file; the auth gate covers them automatically.
  - Per-feature 401 handling can be deleted everywhere — the gate is the single redirect path.
  - Component tests are unblocked across `apps/internal` for any future React unit testing.
- **Deferred** (explicit follow-ups):
  - **Sidebar collapse / responsive behaviour** — fixed-width day one; revisit at 5+ routes.
  - **Per-role nav filtering** — all staff see all routes for now.
  - **Real Home widgets** — placeholder cards only; first real widget is its own PR.
  - **Mid-session 401 invalidation** — the gate handles fresh page loads and tab refocus; if a query 401s while the user is actively in a tab, the page shows the error block until the next refocus or refresh. Add a query-cache `onError` invalidator for the session if this becomes a real friction point.
  - **CI workflow reorganisation** — `deploy-app` is now a misnomer (deploys API stack + syncs SPA + invalidates CloudFront); split into per-target jobs once a second SPA appears.

## 2026-05-10 — `apps/internal` SPA + audit-log read API + staff bootstrap

- **Branch / PR**: `feat/internal-app-audit-log`
- **Plan**: `docs/tickets/07-internal-app-and-audit-log.md`
- **What landed**:
  - **Auth route prefix migration** — every application route now mounts under `/api/*`. better-auth runs at `/api/auth/*` (`basePath: '/api/auth'`), audit-log routes at `/api/audit-log/*`, `/health` + `/health/ready` stay un-prefixed (ALB target group hits them on the ALB DNS, CloudFront does not front them).
  - **`staffRole` column on `User`** (nullable string, `'support' | 'engineer' | 'admin'`). Wired via better-auth `additionalFields` with `input: false` so the auth API can never set it — promotion only goes through the bootstrap script. `requireStaff` middleware (`apps/api/src/middleware/require-staff.ts`) resolves the session, narrows the user shape, throws 401 / 403 as appropriate, and writes the resolved staff session to the Hono context.
  - **Audit-log read API** — `GET /api/audit-log` (filter + cursor pagination), `GET /api/audit-log/actions` (distinct list for the filter dropdown), `GET /api/audit-log/:entityId`. All gated by `requireStaff`.
  - **`apps/internal` scaffolded and deployed** — Vite + React 19 + TanStack Router (file-based) + TanStack Query + Tailwind 4 + shadcn (new-york + neutral). Login page (POST `/api/auth/sign-in/email`), audit-log list with filters and infinite-scroll pagination, audit-log detail with JSON viewer + copy + cross-link back to the list filtered by `requestId`. Trailing-underscore route opt-out (`audit_.$entityId.tsx`) keeps detail flat-sibling of the list rather than nested.
  - **CloudFront + S3 (OAC) for the SPA** — private bucket fronted by a CloudFront distribution. Default behaviour serves the SPA from S3 (`CACHING_OPTIMIZED`); `/api/*` behaviour forwards to the ALB (`CACHING_DISABLED`, `ALL_VIEWER_EXCEPT_HOST_HEADER`). 404/403 from S3 → return `index.html` 200 for SPA routing. `BETTER_AUTH_URL` and `CORS_ORIGINS` swap from ALB DNS → CloudFront URL on the API task env.
  - **CI deploy DAG extended** — new `build-internal-app` job runs in parallel with `build-image`. `deploy-app` downloads the bundle, two-pass-syncs to S3 (long-cache + immutable for hashed assets, `no-cache` for `index.html`), then invalidates `/` + `/index.html` on CloudFront. The smoke step now hits both ALB `/health` and the CloudFront URL.
  - **`bootstrap-staff` one-off task + workflow** — `apps/api/src/scripts/bootstrap-staff.ts` (compiled into the API image, invoked as `node dist/scripts/bootstrap-staff.js` on the dedicated Fargate task definition). Idempotent: creates via `auth.api.signUpEmail` if missing, then `prisma.user.update({ staffRole })`; on re-run for an existing user, promotes role only — never touches the password. The `bootstrap-staff` GitHub Actions workflow (`workflow_dispatch` only) passes `BOOTSTRAP_STAFF_*` as runtime env overrides on `aws ecs run-task` so bootstrap creds never get baked into the task def or Secrets Manager.
  - **Docs catch-up** — `docs/system-design.md` (topology + deploy-flow + bootstrap-staff sibling), `docs/endpoints.md` (path conventions, `/api/auth/*` rename, audit-log section), `docs/runbooks/local-dev.md` (running the SPA + bootstrap section), new `docs/runbooks/staff-bootstrap.md` runbook. Skills updated: `auth` (route prefix, staffRole + requireStaff section, bootstrap mechanism), `database` (audit-log read API note), `infra` (one-shot ops `workflow_dispatch` sibling pattern, SPA hosting via CloudFront + S3 OAC).
- **What's now possible**:
  - Real staff workflow end-to-end: trigger the bootstrap workflow → log into the deployed `apps/internal` → inspect every signup / login / logout event with full filter + detail.
  - Future internal routes layer on `requireStaff` as positional middleware; no per-route auth boilerplate beyond a single import.
  - Future SPAs (`apps/web`, `apps/portal`) follow the same per-app S3 bucket + CloudFront distribution pattern, each with its own `build-<name>-app` CI job.
  - One-shot operations (seed, backfill, future audit-replay) follow the bootstrap-staff template: dedicated task def + `workflow_dispatch` workflow + runtime env overrides for any sensitive inputs.
- **Deferred** (explicit follow-ups):
  - **Staff-management UI** — replaces the workflow_dispatch path for adding additional staff after bootstrap.
  - **Customer organisations + DB-level invariant** (`staffRole != null` cannot also be a member of a customer org).
  - **Impersonation** — needs the staff-management UI + a session-creation endpoint setting `actor_impersonator_id`. Audit-log column already exists.
  - **API request log** (Stripe-style "every HTTP request stored") — separate observability feature.
  - **`apps/web`** (customer SPA), forgot-password / email verification / magic link (need SES), OAuth providers, 2FA, real DNS (`internal.staging.acme.io`), Playwright E2E (lands when there's a second SPA worth it).

## 2026-05-09 — Audit log foundation (schema + write path)

- **Branch / PR**: `feat/api-audit-log` (#31)
- **Plan**: `docs/tickets/06-audit-log.md`
- **What landed**:
  - **`audit_log` table** — first table we own that isn't vendor-managed. `entity_id` PK with `aud_` prefix; `request_id` (cross-cutting convention from #30); snake_case columns via `@map`; indexes by `(actor_user_id, created_at)`, `(resource_type, resource_id, created_at)`, `(action, created_at)`, and `request_id`. `details Json` carries action-specific payload; we don't query into it. No FK to `User` — keeps audit independent of user-table cascades.
  - **`writeAudit` helper** (`apps/api/src/lib/audit.ts`) with a typed discriminated `AuditEvent` union covering auth + org + staff scopes (org and staff are type-only entries with no callers yet, ready for future feature PRs to wire). Awaited but error-swallowed (B1 — losing one event is preferable to failing a real user action because of an audit-write bug). Never wrap in `prisma.$transaction`.
  - **Better-auth wiring** — `databaseHooks.after` for `user.create`, `session.create`, `session.delete` call `writeAudit`. Signup intentionally yields **two events** (`user.signed_up` + `user.logged_in`) — semantically correct and avoids fragile differentiation logic that would silently drop the login event for a returning-user-with-zero-sessions edge case.
  - **3 new unit tests** for `writeAudit` (happy path, resourceType inference, error swallowing). Existing signup/signin/signout integration tests extended to assert `audit_log` rows match the response `X-Request-Id`. 43 tests total now.
  - **`database` skill** extended with a new "Audit log" section (action naming, `writeAudit` usage, DO/DON'T for `details`, tamper-evidence by code discipline, retention forever, anonymisation rule on user-delete, action-union as source of truth). Audit log is a database concern — section in the existing skill rather than a new skill file.
- **What's now possible**:
  - Every auth lifecycle event (signup, login, logout) is recorded with actor + requestId + timestamp + details payload.
  - Future org-governance and staff-action PRs add callers without extending the schema — the typed union already lists their actions.
  - Single source of truth for "what events exist" is the `AuditEvent` union; reviewers grep one file to see the full action surface.
- **Deferred**:
  - **Read API + UI** in `apps/internal` (its own `/pre-feature` once `apps/internal` is scaffolded)
  - **API request log** (the second observability feature alongside this one — every HTTP request stored, browsable; own `/pre-feature` next)
  - **Outbox pattern** / true tamper-evidence (hash chain, DB-level `REVOKE`) — adopt at SOC2 / HIPAA threshold
  - **User-deletion anonymisation logic** — lands with the user-delete feature
  - **Org-governance + staff event callers** — type entries exist; callers land with each respective feature PR

## 2026-05-09 — `requestId` column on auth tables (request-row correlation)

- **Branch / PR**: `feat/api-auth-request-id` (#30)
- **Plan**: `docs/tickets/05-auth-request-id.md`
- **What landed**:
  - **`requestId String?` + `@@index([requestId])`** on `User`, `Session`, `Account`, `Verification`. Nullable + non-unique + indexed — out-of-request inserts (seed scripts, future jobs, manual SQL) leave `NULL`; one HTTP request typically writes multiple rows; lookups are sparse but selective.
  - **Wired via better-auth's `additionalFields.requestId.defaultValue: () => getRequestId() ?? null`** on each model. Same pattern as `entityId` — better-auth's adapter strips fields not declared via `additionalFields`, so a hook-injection alone gets discarded.
  - **Middleware fix** — `apps/api/src/middleware/request-id.ts` now sets `X-Request-Id` on `c.res.headers` *after* `next()` returns, not via the pre-flight `c.header()` call. The old approach was discarded for `/auth/*` because `(c) => auth.handler(c.req.raw)` returns better-auth's fresh `Response` that replaces `c.res`. Post-flight set works for both Hono-built and handler-returned responses.
  - **Test extension** — the existing signup integration test asserts `user.requestId`, `session.requestId`, and `account.requestId` all match the `X-Request-Id` response header (one assertion proves wiring + middleware fix end-to-end).
  - **`database` skill** — new "Row → request correlation" section (every writable table we own carries this column; non-auth tables populate at the call site or via a Prisma extension when we have a third).
- **What's now possible**:
  - Any row in the auth tables can be traced to its originating HTTP request. Support investigation: "what did request `req_abc123` write?" → `SELECT FROM user WHERE request_id = ...` plus same query against session/account/verification.
- **Deferred**:
  - **Per-table `requestId` convention** applies to all future tables we own (already documented in the database skill); no retroactive backfill needed since there are zero other tables yet.
  - **Full request meta-data** (headers, body hash, ipAddress, userAgent on every mutation) — that lives in the `audit_log` table that follows in #31, not on every row.

## 2026-05-09 — Auth followups (env-var docs, `@/` alias, test reorg, `BETTER_AUTH_URL`)

- **Branch / PR**: `fix/api-auth-followups` (#29)
- **What landed**:
  - **`apps/api/.env.example`** documents `NODE_ENV=development` (without it, better-auth's IP-resolver dev fallback doesn't fire and `session.ipAddress` lands as `''`) and `CORS_ORIGINS=http://localhost:3000` (without it, Postman / curl get `MISSING_OR_NULL_ORIGIN`).
  - **`@/` path alias enabled across `apps/api`** — `tsconfig.json` adds `paths: { "@/*": ["./src/*"] }`, build chains `tsc -p tsconfig.build.json && tsc-alias -p tsconfig.build.json` (tsc emits unresolved `@/` specifiers; tsc-alias rewrites them to relative paths in `dist/`), vitest uses its built-in `resolve.tsconfigPaths` (no plugin dep). All 17 src files rewritten — no relative imports remain.
  - **Tests moved** out of `src/` into `apps/api/test/{unit,integration}/`. The `.integration.test.ts` suffix dropped (now redundant), and the matching `src/**/*.test.ts` exclude removed from `tsconfig.build.json`. Vitest auto-finds tests in the new location.
  - **`BETTER_AUTH_URL` wired** end-to-end. `env.ts` adds it as `z.string().url()` defaulting to `http://localhost:3000` (silences `pnpm dev`'s "Base URL could not be determined" warning without per-developer setup). `auth.ts` passes `baseURL: env.BETTER_AUTH_URL`. CDK app-stack reorders so the ALB is created before the task-def, then injects `BETTER_AUTH_URL: \`http://${alb.loadBalancerDnsName}\`` into the container env. CFN synth confirms `Fn::Join("http://", Fn::GetAtt(Alb, DNSName))`.
  - **New `auth` skill** (`.claude/skills/auth/SKILL.md`) consolidates the load-bearing decisions: framework choice, no-aliases rule for vendor route names, sessions vs JWT decision tree, the cookie-vs-JWT-in-memory security myth, how to extend better-auth tables (`additionalFields` vs `databaseHooks`), CSRF/Origin requirements, env-var wiring, the better-auth body-schema deviations, and what's deferred.
- **What's now possible**:
  - Local dev with `cp apps/api/.env.example apps/api/.env` is one step from working — no per-developer hunting for missing env vars.
  - `pnpm dev` no longer prints the better-auth base-URL warning.
  - Source files use `@/lib/...` instead of `../../lib/...` — refactors that move files don't have to fix-up relative paths.
- **Deferred**:
  - `/auth/login` and `/auth/signup` route aliases — initially built, then reverted on user pushback (vendor route names only, no aliases). Captured in the auth skill's "Use the vendor route names" section.
  - `CORS_ORIGINS` injection via CDK once SPAs scaffold (currently just the local dev value).

## 2026-05-09 — Auth foundation (better-auth signup/signin/signout)

- **Branch / PR**: `feat/api-auth` (#28)
- **Plan**: `docs/tickets/04-auth-foundation.md`
- **What landed**:
  - **better-auth wired into Hono** at `/auth/*` (`app.on(['POST', 'GET'], '/auth/*', (c) => auth.handler(c.req.raw))`), with `prismaAdapter` over the existing client. Email + password only, DB-backed cookie sessions (no JWT, no Redis), cookies `Secure + HttpOnly + SameSite=Lax`. `BETTER_AUTH_SECRET` validated at startup (`z.string().min(32)`, no default).
  - **Schema** — four new tables (`User`, `Session`, `Account`, `Verification`) following better-auth's vendor schema (camelCase columns, lowercase table names) plus a per-table `entityId String @unique` column. The previous `_meta` lighthouse table is dropped — `/health/ready` now probes `prisma.user.findFirst()` since a real domain table exists. Migration history collapsed into a single fresh `init` migration.
  - **Prefixed entityIds** — `usr_<uuid>` / `sess_<uuid>` / `acct_<uuid>` / `veri_<uuid>` generated via `crypto.randomUUID()`. Added through better-auth's `additionalFields.entityId.defaultValue` rather than `databaseHooks` — the Prisma adapter strips fields not declared in better-auth's schema, so a hook-injected entityId gets discarded before insert.
  - **CDK** — new Secrets Manager secret `${PRODUCT}-${envName}-app-secrets` (one JSON document, future fields just add a key) with auto-generated 64-char `betterAuthSecret`. AppStack injects it into the API task as `BETTER_AUTH_SECRET` via `EcsSecret.fromSecretsManager(secret, 'betterAuthSecret')`. Migrator task unchanged — it doesn't load `env.ts`.
  - **New `database` skill** (`.claude/skills/database/SKILL.md`) — owns the prefixed-ID registry, schema/column naming, migration etiquette, FK/cascade rules, soft-delete posture, runtime URL composition note. Code-style now points to it for ID conventions instead of restating them.
  - **8 integration tests** in `apps/api/src/auth.integration.test.ts` covering signup happy path + duplicate (422) + weak password (400), signin happy + wrong password (401), get-session with + without cookie, sign-out (200, requires `Origin` header for better-auth's CSRF check). Plan-vs-reality deltas captured in the ticket.
- **What's now possible**:
  - End-to-end signup → cookie → authenticated `/auth/get-session` works against the deployed API. Frontend SPAs can ship against the same routes when scaffolded.
  - The `additionalFields.defaultValue` pattern is the established way to add app-owned columns to vendor tables.
- **Deferred**:
  - Email verification, magic link, password reset (need an email transport — SES not wired)
  - OAuth providers (Google, GitHub, etc.)
  - 2FA (TOTP)
  - Organisations + memberships
  - Staff role + impersonation (need `apps/internal`)
  - `requireAuth` middleware + `getCurrentUser` helper (lands with first protected route)
  - `packages/auth` extraction (lands at second consumer — likely the worker)
  - Soft-delete on `User` (lands with first delete-user feature)

## 2026-05-08 — Database setup and check (RDS Postgres, Prisma, /health/ready, migration ECS task)

- **Branch / PR**: `feat/api-db`
- **Plan**: `docs/tickets/03-database-setup-and-check.md`
- **Verified live**: `GET http://<alb-dns>/health/ready` → `200 { status: "ok", checks: { db: "ok" } }`. End-to-end loop confirmed: `deploy-infra` → `build-image` → `migrate-db` (ECS one-off task applies migrations) → `deploy-app` (rolling update) → `smoke` (asserts the running container's `version` matches the pushed SHA). The runtime API container connects to RDS over TLS via `@prisma/adapter-pg`.
- **Post-merge fixes** (each landed as its own PR after the feature merge — captured in the `infra` skill's "common failure patterns" so they don't recur):
  - ECR rejected lifecycle policy with two rules targeting the same `tagStatus` — split into one TAGGED + one UNTAGGED rule.
  - RDS rejected `databaseName: 'template'` as an engine-reserved word — renamed to `app`.
  - RDS doesn't expose Postgres `18.0` (engine starts at `18.1`) — pinned to `VER_18_3`.
  - Migrator ECS task command failed with `SyntaxError: missing ) after argument list` because `node node_modules/.bin/prisma` invokes node on a `/bin/sh` wrapper — dropped the `node` prefix.
  - `deploy-app` was emitting a tagless image URI (Docker → `:latest`) when `needs.build-image.outputs.image-tag` was empty on individual job re-runs — switched to `${{ github.sha }}` directly + `||` instead of `??` for the imageTag default so empty strings can't slip through.
  - RDS rejected the runtime client's plaintext connection (`rds.force_ssl=1`) — appended `?sslmode=require` to the URL.
  - `pg-connection-string` then interpreted `sslmode=require` as `verify-full` and failed on the Amazon-CA-signed cert — appended `&uselibpqcompat=true` for libpq-compatible "encrypt, don't validate" semantics.
- **What landed**:
  - **Prisma + Postgres** wired into `apps/api`: `prisma/schema.prisma` with one lighthouse model `Meta` mapping to `_meta`, first migration creating the table. `apps/api/prisma.config.ts` (the Prisma-7-required CLI config) provides the `datasource.url` from `process.env.DB_*` (composition inlined, since the file ships to `/prod` where it can't import `src/env.ts`). `apps/api/src/lib/db.ts` constructs the runtime `PrismaClient` with the `@prisma/adapter-pg` adapter and stashes it on `globalThis` in non-production so hot-reload tools (tsx watch, vitest workers) reuse the connection instead of leaking on every reload.
  - **`GET /health/ready`** route (`apps/api/src/middleware/health-ready.ts`): probes `prisma.meta.findFirst()` with a 2 s `Promise.race` timeout. `200 { status: "ok", checks: { db: "ok" } }` when reachable; `503 { status: "unavailable", checks: { db: "down" } }` on throw or timeout. Excluded from the request logger (matches `/health` to keep CloudWatch noise down).
  - **`env.ts` extended**: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (with sensible local-dev defaults matching `docker-compose.yml`); a Zod `transform` composes `DATABASE_URL` with URL-encoded password.
  - **Graceful shutdown** updated: `registerShutdown` accepts a `beforeExit` array; `apps/api/src/index.ts` passes `[() => prisma.$disconnect()]` so DB connections close cleanly inside the `SHUTDOWN_TIMEOUT_MS` window.
  - **Dockerfile**: copies `prisma/` schema, runs `prisma generate` after install, and re-runs it after `pnpm deploy --prod` against `/prod` (where the deploy strips the original generated artifacts). `prisma` moved to runtime deps so the CLI is available in `/prod`. Bookworm-slim base now installs `openssl + ca-certificates` to satisfy Prisma's libssl detection.
  - **CDK — `NetworkStack`**: adds `rdsSg` (inbound `:5432` from `ecsSg` only) and `CfnOutput`s for `PrivateSubnetIds` + `EcsSecurityGroupId` (consumed by the `migrate-db` CI step).
  - **CDK — `DataStack`**: adds RDS Postgres (`db.t4g.micro`, 20 GB gp3, single-AZ, 7-day backups, encrypted at rest, `removalPolicy: DESTROY`, `deletionProtection: false`) with auto-generated Secrets Manager credentials. **The ECS cluster moves here from `AppStack`** so the migrator one-off task can run before `AppStack` deploys. Adds the migrator `FargateTaskDefinition` (uses the API ECR image at `imageTag` context, default CMD `prisma migrate deploy`), its log group, and `CfnOutput`s for `MigratorTaskDefArn`, `ApiClusterName`, `MigratorLogGroupName`.
  - **CDK — `AppStack`**: stops creating the cluster; imports it from `DataStack` props. Injects the same DB secrets into the API container via `ecs.Secret.fromSecretsManager` so app code reads `DB_*` env vars and composes `DATABASE_URL` itself.
  - **`bin/app.ts`**: passes `imageTag` context to `DataStack` too (so the migrator task definition references the SHA `build-image` is about to push).
  - **CI workflow**: `ci` job adds a `postgres:18-alpine` service container with `template_test` database and a step that applies `prisma migrate deploy` against it before tests. New `migrate-db` job between `build-image` and `deploy-app`: resolves the migrator task definition + cluster + subnets + SG from CFN outputs, calls `aws ecs run-task`, waits for completion, fails the workflow on non-zero exit (dumping the last 5 minutes of `/ecs/template-staging-migrator` logs). `deploy-infra` now passes `-c imageTag=$SHA` so DataStack updates the migrator task def on every run.
  - **`docker-compose.yml`** at repo root: Postgres on `:5432` with two databases (`template_dev`, `template_test`) created via an init script. Volume mounted at `/var/lib/postgresql` per Postgres 18+ guidance.
  - **New runbook** `docs/runbooks/local-postgres.md`: Compose setup, applying migrations to both databases, generating a new migration via `prisma migrate dev`, resetting local data.
  - **Tests**: 4 new tests across two files. `middleware/health-ready.test.ts` (unit, mocked Prisma): 200 success, 503 throw, 503 timeout. `app.integration.test.ts` (integration, real Postgres): hits `/health/ready` and asserts the round-trip works. 32 tests total now.
  - **`pnpm-workspace.yaml`** `allowBuilds`: adds `prisma`, `@prisma/client`, `@prisma/engines`.
- **What's now possible**:
  - The deploy chain proves the full migration loop end-to-end: `deploy-infra` → `build-image` → `migrate-db` → `deploy-app` → `smoke`. Adding new schema changes is just `prisma migrate dev` locally + commit.
  - `/health/ready` distinguishes "DB reachable + schema applied" from "DB down or migration missed", giving monitoring a strong signal that's independent of `/health` (which stays liveness-only for the ALB).
  - Local development boots a real Postgres via `docker compose up -d postgres` + applying migrations; same connection shape as production (just different host).
- **Deferred**:
  - **Prisma error → typed error mapper** (P2002 → `ConflictError`, P2025 → `NotFoundError`, etc.) — lands with the first real-entity handler that throws on Prisma errors.
  - **Per-test transaction rollback** — current integration test is read-only; arrives with the first write-side test.
  - **Redis, BullMQ, S3, application Secrets Manager secrets** — separate features.
  - **Multi-AZ RDS, Performance Insights, backup-restore runbook** — when production deploys.
  - **Other Compose services** (Redis / MinIO / Mailhog) — added when their feature lands.

## 2026-05-08 — `apps/api` foundations: logger, request ID, typed errors, security middleware, graceful shutdown

- **Branch / PR**: `feat/api-foundations`
- **What landed**:
  - **`apps/api/src/lib/logger.ts`** — pino 10.3.1 (JSON in prod, pino-pretty in dev), AsyncLocalStorage-backed request context with `runWithContext()` / `getRequestId()` helpers, pino mixin that automatically tags every log line with the current request ID, base fields `{ service: 'api', release: env.GIT_SHA }`.
  - **`apps/api/src/lib/errors.ts`** — abstract `HttpError` base + six subclasses (`ValidationError` 400, `UnauthorizedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409, `InternalError` 500), `formatError()` that returns the canonical wire shape `{ code, message, details? }`. Lives in-app for now; moves to `packages/errors` when the worker arrives.
  - **`apps/api/src/lib/shutdown.ts`** — registers SIGTERM/SIGINT handlers that call `server.close()`, wait up to `SHUTDOWN_TIMEOUT_MS` for in-flight requests to drain, then `process.exit(0)`. Returns an unregister function (used in tests). Idempotent — second signal is a no-op.
  - **Three middlewares** in `apps/api/src/middleware/`:
    - `request-id.ts` — generates a UUID via `crypto.randomUUID()`, sets `X-Request-Id` response header, seeds the ALS context.
    - `request-logger.ts` — logs one line per request on completion (`{ method, path, status, durationMs }`); skips `/health` (ALB probe noise).
    - `error-handler.ts` — `app.onError()` callback that formats `HttpError` subclasses, maps Hono `HTTPException` to the same wire shape, and falls back to a scrubbed `500 InternalError` for unhandled errors (original logged with stack).
  - **`apps/api/src/app.ts`** — `createApp()` factory wires the middleware chain in the locked order (`requestId → requestLogger → secureHeaders → cors → bodyLimit → routes → onError`). Optional `corsOrigins` and `bodyLimitBytes` factory props default to env values, override-able from tests.
  - **`apps/api/src/index.ts`** — registers the shutdown hook against the `serve()` instance.
  - **`apps/api/src/env.ts`** — adds `NODE_ENV`, `LOG_LEVEL`, `CORS_ORIGINS` (csv → array), `BODY_LIMIT_BYTES` (default 1 MB), `SHUTDOWN_TIMEOUT_MS` (default 25 s) — all optional with sensible defaults.
  - **`infra/cdk/lib/app-stack.ts`** — explicit `stopTimeout: Duration.seconds(30)` on the API container with a comment naming the cross-file invariant against `SHUTDOWN_TIMEOUT_MS`.
  - **`apps/api/vitest.config.ts`** — sets `NODE_ENV=test` and `LOG_LEVEL=silent` for test runs so the suite doesn't spew JSON logs.
  - **27 tests** across four files (errors, logger ALS, shutdown, app integration) — including request-ID format, security headers, CORS allow/deny, body limit, error wire shape, request-logger /health skip.
- **What's now possible**:
  - Throw a typed error from any future handler — `throw new NotFoundError('user missing')` → `404 { code: "NotFoundError", message: "user missing" }` on the wire, no per-handler `try/catch` plumbing.
  - Filter all logs from one request: `cloudwatch logs filter-pattern '{ $.requestId = "abc-..." }'` returns the full story for that request.
  - Tear down with no in-flight loss: ECS rolling deploy → SIGTERM → app drains for up to 25 s → exits cleanly before ECS's 30 s `stopTimeout`.
  - CORS-protected by default. When `apps/web` lands, set `CORS_ORIGINS=https://app.staging.<domain>` on the ECS task and that's it.
- **Deferred** (explicit follow-up surface):
  - **Rate limiting** — better-auth handles its own auth-route limiter; a generic Hono limiter for tRPC arrives once Redis exists.
  - **tRPC + typed contract** — lands with the first non-`/health` route.
  - **Sentry** — not wired; CloudWatch + structured logs cover triage until real users hit production.
  - **Auth middleware** (`getCurrentUser`, `assertCan`) — lands with better-auth + sessions.
  - **`packages/errors`, `packages/types`, `packages/schemas`** — extracted on first ≥2-consumer need (likely worker arrival).
  - **OpenTelemetry / X-Ray distributed tracing** — Sentry perf covers 80% per overview; defer indefinitely.

## 2026-05-08 — `apps/api` with `/health`, deployed to staging end-to-end

- **Branch / PRs**: `feat/api-health` (#10) + `fix/ecr-lifecycle-rules` (#11)
- **Verified live**: `http://<alb-dns>/health` → `200 { status: "ok", version: "<commit sha on main>", uptime: <seconds> }`. ALB DNS available from the `AlbDnsName` output of `template-staging-app`.
- **What landed**:
  - `apps/api` workspace (`@template/api`): Hono 4.12.18 + `@hono/node-server` 2.0.1 + Zod 4.4.3 on Node 24.15.0. Single route `GET /health` returns `{ status, version, uptime }` where `version` is the running container's `GIT_SHA` and `uptime` is seconds since the app started. Code is structured as a `createApp({ gitSha })` factory + a `src/env.ts` Zod schema that parses `process.env` once at boot — no `process.env.X` access in handlers, no `biome-ignore` for the index-signature lint. Two Vitest tests (factory-based, no env stubbing). Build via `tsc -p tsconfig.build.json`; tests excluded from the build output.
  - `apps/api/Dockerfile`: multi-stage (`base`/`deps`/`build`/runner) on `node:24.15.0-bookworm-slim` (chosen over alpine for glibc compatibility with native npm prebuilds, no musl DNS/threading edge cases). pnpm installed via `npm i -g`, no Corepack. `pnpm deploy --prod --ignore-scripts` produces a clean production directory copied into the runner. Runs as `USER node`. Build context is repo root; `.dockerignore` at root prunes `node_modules`, `.git`, `dist`, `cdk.out`, `.turbo`, `docs`, `*.md`.
  - **CDK stacks fully populated** (`template-staging-{network,data,app}`, all with `terminationProtection: false`):
    - `NetworkStack`: VPC `10.0.0.0/16`, 2 AZs, public + private subnets, **single NAT gateway**, `albSg` (`:80` from internet), `ecsSg` (`:3000` from `albSg` only). `APP_PORT = 3000` exported as the cross-file constant.
    - `DataStack`: ECR repo `template-staging-api` with `imageScanOnPush`, one lifecycle rule per storage class (TAGGED: keep last 30; UNTAGGED: expire after 1 day), `removalPolicy: DESTROY`, `autoDeleteImages: true`, `emptyOnDelete: true`.
    - `AppStack`: Fargate cluster, task def 0.25 vCPU / 0.5 GB, container from ECR `:imageTag` (CDK context), `circuitBreaker: { rollback: true }`, `minHealthyPercent: 0`, ECS container health check via `node -e fetch`. Service in private subnets, no public IP. Public ALB listener on `:80` with target group health check `GET /health`. CloudWatch log group `/ecs/template-staging-api` 30d retention `DESTROY`. `AlbDnsName` `CfnOutput`.
  - **Promote-by-image-friendly CI/CD DAG** in `.github/workflows/ci.yml`: `[ci, cdk] → deploy-infra → build-image → deploy-app → smoke`. ECR login via `aws-actions/amazon-ecr-login@v2.1.5`. Image tag = `github.sha`. Smoke step polls `/health` for up to 5 minutes and asserts `version` matches the pushed SHA — catches "deploy succeeded but rolling update did not actually swap the image". Added a `docker-build` job that runs on PRs only (catches Dockerfile breakage before merge; on `main` the existing `build-image` job covers it).
  - `infra/cdk/tsconfig.json`: relaxed `exactOptionalPropertyTypes: false` for the CDK package only (CDK's interface types declare optional fields without `| undefined` and trip the strict check; this is a documented CDK incompatibility).
  - **pnpm bumped 10.33.4 → 11.0.8** across all pinned locations. `pnpm-workspace.yaml` opts into `injectWorkspacePackages: true` (proper way to make `pnpm deploy` work in Docker without `--legacy`), and uses pnpm 11's new `allowBuilds: { esbuild, lefthook }` (which replaces the deprecated `onlyBuiltDependencies`).
  - `docs/system-design.md`: first version, with Mermaid diagrams for AWS infra topology, request path, and deploy flow.
- **What's now possible**:
  - Push to `main` → ~5 min later, `http://<alb-dns>/health` returns `200 { status: "ok", version: <sha>, uptime: <seconds> }`. The ALB DNS is exposed as a CFN output on `template-staging-app` and the smoke step asserts the deploy reached the running task. _(Note: while the template is being scaffolded, deploys are gated on `workflow_dispatch` rather than push — see `docs/runbooks/staging-teardown-and-redeploy.md`.)_
  - `cdk destroy "template-staging-*"` tears the whole staging environment down cleanly (ECR images auto-deleted, log groups go away, no stuck CFN exports).
  - The four-job deploy DAG is the right shape for promote-by-image: when a future `deploy-production.yml` lands, it consumes a tag built by `build-image` rather than re-building.
- **Deferred** (explicit follow-up surface):
  - **Cross-file version drift**: Node `24.15.0` and pnpm `11.0.8` are duplicated in root `package.json`, `.github/workflows/ci.yml` (5 jobs), `apps/api/Dockerfile`, and `README.md`. Renovate currently does not group these. Add `customManagers` regex rules so a Node bump updates every location in one PR.
  - **HTTPS / TLS / DNS**: ALB serves `:80` only. Route53, ACM, CloudFront, custom domain all deferred until a real domain exists for this template.
  - **Data layer**: no RDS, Redis, S3 (uploads), Secrets Manager. Add when first feature requires them; will need NAT (already in place) plus security group additions.
  - **`apps/worker`, `apps/web`, `apps/internal`**: not scaffolded. Scaffold the next time a feature needs background work or a frontend.
  - **`packages/*`**: nothing yet. `packages/errors`, `packages/types`, `packages/schemas`, `packages/db`, `packages/auth`, etc. — created on first need.
  - **`deploy-production.yml`**: tag-triggered, environment-protected. Will retag the existing staging-tested ECR image rather than re-build (promote-by-image).
  - **Tighten OIDC role**: still `AdministratorAccess`. Runbook at `docs/runbooks/github-oidc-setup.md` has the plan; surface is now known (CDK exec roles + ECR push + ECS update-service + CFN describe-stacks).
  - **Production env sizing**: prod stacks compile with the same sizing as staging. Parameterise via `config.ts` when `deploy-production` lands.
  - **Path-ignore on `deploy-staging` for doc-only changes**: discussed and deferred. Would skip ECS rolling updates on doc-only merges. Worth doing once doc PR frequency justifies it.

## 2026-05-07 — `building-feature` skill: self-review step

- **Commits**: `c3f4cdf`
- **What landed**: Added a "Review (before committing — be your own code reviewer)" section to `.claude/skills/building-feature/SKILL.md`. Lists specific things to audit (overlooked logic, cross-file consistency, CI coverage, version compatibility, hardcoded values, failure modes, reverse-direction effects, footguns, skill drift).
- **What's now possible**: feature work has an explicit self-review gate before commit, reducing "next commit is a follow-up fix" patterns.
- **Deferred**: nothing.

## 2026-05-07 — CDK skeleton + staging CI/CD pipeline

- **Commits**: `be1436a`, `69e08b1`, `0cb8e2c`, `42be839` (PR #6, PR #7)
- **What landed**:
  - `infra/cdk/` workspace (`@template/cdk`) with `aws-cdk-lib` 2.253.0 and `aws-cdk` CLI 2.1121.0 pinned.
  - Three empty stack classes: `NetworkStack`, `DataStack`, `AppStack` in `infra/cdk/lib/`.
  - `bin/app.ts` instantiates all three for both `staging` and `production` envs (`template-{env}-{stack}`), tagged with `Product`/`Environment`/`ManagedBy=cdk` via `tagsFor()`.
  - Region locked to `eu-west-1` in `infra/cdk/lib/config.ts`.
  - `.github/workflows/ci.yml`: `ci` (lint+typecheck+test), `cdk` (synth), `commitlint` (PR-only), `deploy-staging` (push-to-main, gated on `[ci, cdk]` passing, OIDC role assumption, `cdk deploy "template-staging-*"`).
  - `pnpm-workspace.yaml` `onlyBuiltDependencies: [esbuild, lefthook]` to allow postinstall scripts CI needs.
  - Runbooks: `docs/runbooks/cdk-bootstrap.md`, `docs/runbooks/github-oidc-setup.md`.
- **What's now possible**: pushes to `main` automatically run lint/typecheck/test/synth and (if green) call `cdk deploy` against the staging account. Right now this is a no-op because the stacks are empty, but the wiring is end-to-end.
- **Deferred**:
  - All actual infra resources (VPC, NAT, ECR, ECS, ALB, RDS, Redis, S3) — stacks are empty.
  - `deploy-production.yml` workflow (tag-triggered, requires reviewer approval).
  - Tightening the OIDC role from `AdministratorAccess` to scoped permissions (runbook has the plan).
  - Promote-by-image flow (build once, retag for prod).

## 2026-05-06 — Monorepo bootstrap

- **Commits**: `15f9fb4`
- **What landed**:
  - `package.json` at root (`type: module`, Node ≥24.15.0, pnpm 10.33.4 via `packageManager`).
  - `pnpm-workspace.yaml` covering `apps/*`, `packages/*`, `infra/*`.
  - Turborepo 2.9.10 with `build`, `typecheck`, `test`, `lint`, `format`, `dev` tasks (build/typecheck/test depend on `^build`).
  - Biome 2.4.14 for lint + format.
  - TypeScript 6.0.3 with strict `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `isolatedModules`, NodeNext modules).
  - Lefthook 2.1.6 for git hooks.
  - Commitlint 20.5.3 with conventional config — non-conforming commit messages rejected at commit time.
- **What's now possible**: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all wired up across the workspace. Conventional Commits enforced.
- **Deferred**: any actual app, package, or infra code — all directories are empty.

---

## Convention

- **One section per milestone**, not per commit. Group related commits (the same feature, follow-up fixes, hotfixes) under one entry.
- **Skip**: renovate bumps, lint/format fixes, typo corrections, version bumps that don't change behaviour, internal-only refactors that don't shift capability.
- **Reverse chronological** — newest at the top, just under the "Progress" heading.
- **Date format**: `YYYY-MM-DD` from the merge date.
- **Every entry must include "Deferred"** — even "nothing" — so the next session knows the explicit follow-up surface, not just what's done.
