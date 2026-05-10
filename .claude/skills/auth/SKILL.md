---
name: auth
description: Apply auth conventions — better-auth wiring, session vs JWT, route paths, additionalFields, CSRF/origin, env vars, cookie semantics. Use when adding auth-touching features, OAuth providers, or protected routes.
---

Apply these to any auth-related change.

## Framework choice

`better-auth`, self-hosted, configured in `apps/api/src/lib/auth.ts`. All auth routes are mounted at `/api/auth/*` via `app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))` with `basePath: '/api/auth'` on the better-auth config. The `/api` prefix exists because CloudFront forwards only `/api/*` to the ALB — every application route lives under it. We wrap better-auth in `packages/auth` only at its second consumer (likely the worker); until then it lives inline.

## Use the vendor route names

Use better-auth's own paths — `/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/auth/sign-out`, `/api/auth/get-session`, etc. **Don't add aliases** like `/api/auth/login` or `/api/auth/signup`. Two ways to do the same thing doubles the test/doc surface area, makes errors harder to trace, and the indirection is its own bug magnet. The vendor names are what docs and Stack Overflow answers reference — keep them.

## Sessions vs JWT — current model and when to change

**Today**: DB-backed cookie sessions. Cookie (`better-auth.session_token`) → row in `session` table → `userId`. `POST /api/auth/sign-out` deletes the row → instant revocation.

| Factor | Cookie session (current) | JWT |
|---|---|---|
| DB hit per authed request | 1 SELECT (~1ms, same VPC) | 0 |
| Immediate revocation on logout | ✅ | ❌ valid until `exp` (~15 min) |
| Mobile / native client support | Awkward | Easy (bearer in keychain) |
| Cross-domain third parties | Hard | Easy |
| Client complexity | Browser handles cookie | Refresh + rotation logic |

**Don't go pure JWT.** The 15-min revocation gap is a real footgun the day someone needs to be locked out *now*.

**Adopt the hybrid model** (better-auth's `jwt()` plugin) when *any* of:
- Mobile app appears (cookies in WebViews are awkward)
- Third-party API consumer needs a bearer credential
- Session-lookup latency shows up in p99 traces

Hybrid = long-lived session cookie (root credential, revocable) + short-lived JWT minted from the session via `GET /auth/token` (~15 min TTL). Web stays on cookies; mobile uses JWT.

## Cookies are MORE secure than JWT-in-memory for browsers

Common myth: "JWT in memory beats cookies because XSS can't read it." Wrong. XSS can hook `fetch`, intercept `Authorization` headers, and exfiltrate before send — JS-readable storage is JS-stealable. **HttpOnly cookies cannot be read by JS at all**, full stop.

What people *actually* mean by "cookies are insecure" is "cookies have CSRF risk" — solved by:
1. `SameSite=Lax` (browser default; cross-origin POSTs don't carry the cookie)
2. Server-side `Origin` / `Referer` check (better-auth enforces this — that's `MISSING_OR_NULL_ORIGIN`)

OWASP recommends HttpOnly cookies for browser session tokens. Linear, GitHub, Vercel, Stripe dashboards all use cookie sessions. So do we.

## Adding a column to a better-auth-managed table

Better-auth's Prisma adapter **strips fields not declared in its schema** before insert. So:

- **Required column with auto-generated value (e.g. `entityId`)** → declare via `additionalFields` with `defaultValue: () => '...'`. NOT via `databaseHooks` alone — the hook fires but the adapter discards the field.
- **User-input field (e.g. `firstname`, `lastname`)** → declare via `additionalFields` with `input: true, required: true`.
- **Computed field with a fallback** (e.g. composing `name` from `firstname + lastname`) → declare via `additionalFields`, then refine in `databaseHooks.<model>.create.before` (the hook merges with `actualData = { ...actualData, ...result.data }` so partial returns are fine).

Example layout in `apps/api/src/lib/auth.ts`:
```ts
user: {
  additionalFields: {
    firstname: { type: 'string', required: true, input: true },
    lastname: { type: 'string', required: true, input: true },
    entityId: { type: 'string', required: true, input: false, defaultValue: () => `usr_${crypto.randomUUID()}` },
    requestId: { type: 'string', required: false, input: false, defaultValue: () => getRequestId() ?? null }
  }
}
```

Per-table prefix lives in the **`database` skill registry** — add new prefixes there. The `requestId` convention (every writable table we own carries one) is also documented there; this section just shows the better-auth-specific wiring.

## CSRF / Origin

Better-auth rejects state-changing requests with no `Origin` header (`MISSING_OR_NULL_ORIGIN`) and any `Origin` not in the `trustedOrigins` allowlist. We pass `trustedOrigins: env.CORS_ORIGINS` so one env var configures both Hono CORS and better-auth's CSRF check.

For local dev: `.env` sets `CORS_ORIGINS=http://localhost:3000` (or whatever the SPA origin is). Postman / curl must send `Origin: http://localhost:3000` or the request 403s.

For tests: integration tests pass `Origin: http://localhost:3000` explicitly.

For production: CDK injects `CORS_ORIGINS` per env (deferred until first SPA scaffolds).

## Required config — current set

| Config | Source local | Source production |
|---|---|---|
| `BETTER_AUTH_SECRET` | `apps/api/.env` (developer-chosen) | Secrets Manager `${PRODUCT}-${envName}-app-secrets.betterAuthSecret`, injected via `EcsSecret.fromSecretsManager` |
| `BETTER_AUTH_URL` | env.ts default `http://localhost:3000` | CDK app-stack injects the CloudFront distribution URL (`https://${distribution.distributionDomainName}`); swap to `https://app.<domain>` once Route53/ACM land |
| `trustedOrigins` (= `env.CORS_ORIGINS`) | `apps/api/.env` (`http://localhost:3000,http://localhost:5173`) | CDK app-stack injects the same CloudFront URL as `BETTER_AUTH_URL` |
| `basePath` | hardcoded `/api/auth` | same |
| `database` | `prismaAdapter(prisma, { provider: 'postgresql' })` | same |

When you need a new env var that better-auth reads (e.g. `BETTER_AUTH_TELEMETRY_ENDPOINT`, OAuth client IDs/secrets), add it to `apps/api/src/env.ts` (validated by Zod) and inject through CDK — never `process.env.X` directly.

## Staff identity (`staffRole` + `requireStaff`)

Staff are users with `staffRole` set to one of `'support' | 'engineer' | 'admin'`. The column lives on the `User` table — same table as customer users — and is wired via better-auth `additionalFields` with `input: false` so the auth API can never set it from a request body. The string values are the source of truth: there is no separate staff-users table, no separate roles table.

`apps/api/src/middleware/require-staff.ts` resolves the session, narrows the user shape, and throws `UnauthorizedError` (401) for no session and `ForbiddenError` (403) for any session whose `staffRole` is `null` or not in the allowed set. Apply per-route as positional middleware:

```ts
router.get('/api/audit-log', requireStaff, async (c) => { ... })
```

The middleware writes the resolved `staffSession` onto the Hono context (`c.get('staffSession')`) — handlers can read the staff user's email / entityId / staffRole without re-fetching.

The middleware does NOT differentiate between the three staff roles today — `support`, `engineer`, and `admin` all pass. When per-role gates appear (e.g. only `admin` can change billing plans), add a `requireStaffRole('admin')` factory that wraps `requireStaff`; don't reach for `assertCan` / membership-style permissions for staff actions.

## Org membership gates (`requireSession`, `requireMember`, `requireAdmin`, `requireOwner`)

Three middlewares in `apps/api/src/middleware/require-org-role.ts` gate org-scoped routes by the caller's `Membership.role` for the `:orgId` URL param: `requireMember` (any role), `requireAdmin` (admin or owner), `requireOwner` (owner only). They call `getMembership` from the orgs service, throw **404** when the org doesn't exist OR the caller isn't a member (no enumeration), and **403** when the caller is a member but lacks the role. On success they stash both the resolved `authSession` and `orgMembership` on the Hono context.

`apps/api/src/middleware/require-session.ts` exports `requireSession` for routes that need an authed user but no org context (e.g. `POST /api/orgs`). It loads the better-auth session via `auth.api.getSession` and stashes `authSession` (with `userId`, `userEntityId`, `email`).

These mount cleanly under parent routes that define `:orgId` — Hono passes parent params to children, so `app.route('/api/orgs/:orgId/invitations', orgInvitationRoutes)` lets `requireAdmin` inside `orgInvitationRoutes` read `c.req.param('orgId')`.

## Composite team-signup endpoint (`/api/orgs/sign-up`)

The template ships **two signup paths** to support both single-user and team-product forks:

- **Standard** — the existing `POST /api/auth/sign-up/email` (better-auth) creates a user only. Use this when the product doesn't have a tenancy model.
- **Composite team-signup** — `POST /api/orgs/sign-up` (in `apps/api/src/modules/organisations/`) takes the standard signup body plus `organisationName`, calls `auth.api.signUpEmail` server-side with `asResponse: true`, and on success calls `service.createOrg` to create the org + owner membership in one DB transaction. The route returns better-auth's `set-cookie` header verbatim alongside our `{ user, organisation, membership }` JSON. **On signup failure the route forwards better-auth's response as-is** (e.g. 422 for `FAILED_TO_CREATE_USER` on duplicate email) — keep this passthrough rather than translating into our error envelope, so the SPA can render the same copy regardless of which path it took.

The composite route's body is `.strict()` so unknown fields like `inviteToken` are rejected (400). Invited signups go through the **standard** path — once authenticated they call `POST /api/invitations/:token/accept` to consume the invite. Don't bake invite-acceptance into the signup endpoint.

## Bootstrapping the first staff user

There is no public route to set `staffRole` (the `input: false` on `additionalFields` blocks the auth API). The `bootstrap-staff` script is the **only** path that promotes a user to staff:

- **Local**: `pnpm --filter @template/api bootstrap:staff --email=… --name="…" --password=… --role=admin`.
- **Staging / production**: `.github/workflows/bootstrap-staff.yml` (`workflow_dispatch` only) runs `aws ecs run-task` against the `template-${env}-bootstrap` Fargate task definition with the four `BOOTSTRAP_STAFF_*` inputs as **runtime env overrides**. Bootstrap creds appear at trigger time only — no long-lived env vars on the task definition or in Secrets Manager.

The script (`apps/api/src/scripts/bootstrap-staff.ts`) is idempotent: it creates the user via `auth.api.signUpEmail` if missing (so the password is hashed by better-auth and the `user.signed_up` audit event fires), then sets `staffRole` via a direct `prisma.user.update`. Re-running with the same role is a no-op; with a different role it updates `staffRole` only — never the password.

After the first staff user exists, additional staff are added through `apps/internal` (deferred — staff-management UI lands in its own PR).

See [`docs/runbooks/staff-bootstrap.md`](../../../docs/runbooks/staff-bootstrap.md) for the operator-facing runbook.

## better-auth body schema deviations

Better-auth 1.6.x hardcodes a couple of things you can't config away. Document new ones here as you find them.

- **Signup requires `name`** in the body, despite our `additionalFields` adding `firstname` + `lastname`. Pragmatic fix: callers send `name: \`${firstname} ${lastname}\`` and the `databaseHooks.user.create.before` recomposes it as a fallback. Removing `name` cleanly would require a custom signup endpoint that wraps `auth.api.signUpEmail` — overkill.
- **Status codes** — duplicate-email signup returns **422** (`FAILED_TO_CREATE_USER`), not 409. Sign-out returns **200**, not 204.
- **Sign-out requires `Content-Type: application/json` AND a body** (even `{}`) AND an `Origin` header. Without any of these it's 415 / 500 / 403.

## What's deferred (don't add until needed)

- Email verification / magic link / password reset — need an email transport (SES not wired). Once SES lands, an email worker consumes `invitation.created` events and renders the invite link from the create-response shape we already return.
- `assertCan(membership, action)` / `packages/auth` extraction — happens at the second consumer (worker). Today the role gates are inline in `require-org-role.ts`.
- OAuth providers (Google, GitHub, etc.)
- 2FA (TOTP) — staff sessions will require it (per `project_overview.md`); end-user 2FA optional
- Organisations + memberships
- Impersonation — `audit_log.actor_impersonator_id` column already exists; needs a session-creation endpoint and a staff-management UI to be useful
- Staff-management UI in `apps/internal` (set/clear `staffRole` from the dashboard) — replaces the workflow_dispatch path for adding additional staff after bootstrap
- `packages/auth` extraction (lands at second consumer)
- `BETTER_AUTH_URL` swap to `https://app.<domain>` (lands with Route53/ACM)
- JWT plugin (lands when mobile or third-party API consumer arrives — see "Sessions vs JWT" above)
- Rate limiting (better-auth has its own; defer until rate-limit work lands)

## Before adding an auth-touching change, answer

- Is this a column on a better-auth table? If yes — `additionalFields` (probably with `defaultValue` if auto-generated). NOT `databaseHooks` alone.
- New env var better-auth needs? Add to `env.ts` (Zod), inject via CDK, document in this skill.
- New route — does better-auth already have one? Use it; don't alias.
- Will this break the 8 integration tests in `apps/api/test/integration/auth.test.ts`? Update them in the same commit.
- Does this need an `Origin` header from clients? Document if so — better-auth's CSRF errors are confusing without context.
