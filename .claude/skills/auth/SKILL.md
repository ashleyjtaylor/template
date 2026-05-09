---
name: auth
description: Apply auth conventions — better-auth wiring, session vs JWT, route paths, additionalFields, CSRF/origin, env vars, cookie semantics. Use when adding auth-touching features, OAuth providers, or protected routes.
---

Apply these to any auth-related change.

## Framework choice

`better-auth`, self-hosted, configured in `apps/api/src/lib/auth.ts`. All auth routes are mounted at `/auth/*` via `app.on(['POST', 'GET'], '/auth/*', (c) => auth.handler(c.req.raw))`. We wrap better-auth in `packages/auth` only at its second consumer (likely the worker); until then it lives inline.

## Use the vendor route names

Use better-auth's own paths — `/auth/sign-up/email`, `/auth/sign-in/email`, `/auth/sign-out`, `/auth/get-session`, etc. **Don't add aliases** like `/auth/login` or `/auth/signup`. Two ways to do the same thing doubles the test/doc surface area, makes errors harder to trace, and the indirection is its own bug magnet. The vendor names are what docs and Stack Overflow answers reference — keep them.

## Sessions vs JWT — current model and when to change

**Today**: DB-backed cookie sessions. Cookie (`better-auth.session_token`) → row in `session` table → `userId`. `POST /auth/sign-out` deletes the row → instant revocation.

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
| `BETTER_AUTH_URL` | env.ts default `http://localhost:3000` | CDK app-stack injects `http://${alb.loadBalancerDnsName}`; swap to `https://api.<domain>` once Route53/ACM land |
| `trustedOrigins` (= `env.CORS_ORIGINS`) | `apps/api/.env` | CDK env (deferred until SPAs scaffold) |
| `basePath` | hardcoded `/auth` | same |
| `database` | `prismaAdapter(prisma, { provider: 'postgresql' })` | same |

When you need a new env var that better-auth reads (e.g. `BETTER_AUTH_TELEMETRY_ENDPOINT`, OAuth client IDs/secrets), add it to `apps/api/src/env.ts` (validated by Zod) and inject through CDK — never `process.env.X` directly.

## better-auth body schema deviations

Better-auth 1.6.x hardcodes a couple of things you can't config away. Document new ones here as you find them.

- **Signup requires `name`** in the body, despite our `additionalFields` adding `firstname` + `lastname`. Pragmatic fix: callers send `name: \`${firstname} ${lastname}\`` and the `databaseHooks.user.create.before` recomposes it as a fallback. Removing `name` cleanly would require a custom signup endpoint that wraps `auth.api.signUpEmail` — overkill.
- **Status codes** — duplicate-email signup returns **422** (`FAILED_TO_CREATE_USER`), not 409. Sign-out returns **200**, not 204.
- **Sign-out requires `Content-Type: application/json` AND a body** (even `{}`) AND an `Origin` header. Without any of these it's 415 / 500 / 403.

## What's deferred (don't add until needed)

- `requireAuth` middleware + `getCurrentUser` helper — ship with the first protected route, not preemptively (rule: no helpers under three call sites)
- Email verification / magic link / password reset — need an email transport (SES not wired)
- OAuth providers (Google, GitHub, etc.)
- 2FA (TOTP)
- Organisations + memberships
- Staff role + impersonation
- `packages/auth` extraction (lands at second consumer)
- `BETTER_AUTH_URL` swap to `https://api.<domain>` (lands with Route53/ACM)
- JWT plugin (lands when mobile or third-party API consumer arrives — see "Sessions vs JWT" above)
- Rate limiting (better-auth has its own; defer until rate-limit work lands)
- Audit log

## Before adding an auth-touching change, answer

- Is this a column on a better-auth table? If yes — `additionalFields` (probably with `defaultValue` if auto-generated). NOT `databaseHooks` alone.
- New env var better-auth needs? Add to `env.ts` (Zod), inject via CDK, document in this skill.
- New route — does better-auth already have one? Use it; don't alias.
- Will this break the 8 integration tests in `apps/api/test/integration/auth.test.ts`? Update them in the same commit.
- Does this need an `Origin` header from clients? Document if so — better-auth's CSRF errors are confusing without context.
