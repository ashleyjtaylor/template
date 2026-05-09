# 04 — Auth foundation (better-auth: signup + signin + DB sessions)

Plan agreed via `/pre-feature` before implementation begins.
To be shipped via `feat/api-auth`.

## Requirements
- Wire **better-auth** into Hono, mounted at `/auth/*` (its default), email + password only, DB-backed sessions (no Redis), cookie-based session (`Secure`, `HttpOnly`, `SameSite=Lax`).
- **No `/me` route** in this PR — better-auth's `/auth/get-session` covers the use case. **No `requireAuth` middleware** and **no `getCurrentUser` helper** either; both arrive with the first protected route in a future PR (rule: no helpers under three call sites).
- **"Done" bar** — from a terminal:
  1. POST `/auth/sign-up/email` with `{ email, password, firstname, lastname }` → 200, user row in DB, cookie returned.
  2. POST `/auth/sign-in/email` with `{ email, password }` → 200, cookie returned.
  3. GET `/auth/get-session` with cookie → 200, `{ user, session }`.
  4. GET `/auth/get-session` without cookie → 200, `null` (better-auth's deliberate convention).
  5. POST `/auth/sign-out` with cookie → 204, session row deleted.
  6. Re-signup same email → 409.
  7. Sign-in with wrong password → 401.

## Data model

Four new Prisma models from better-auth's standard schema, customised:

- **`User`** (table `user`): `id` (better-auth internal), `entityId` (`usr_<uuid>`, unique, indexed), `firstname` (required), `lastname` (required), `email` (unique), `emailVerified Boolean @default(false)`, `image String?`, `createdAt`, `updatedAt`. The default `name` field is dropped if better-auth tolerates it; otherwise kept nullable + computed from `firstname + ' ' + lastname` in a `databaseHooks.user.create.before`.
- **`Session`** (table `session`): standard fields + `entityId` (`sess_<uuid>`, unique, indexed). Cascade-deletes with user.
- **`Account`** (table `account`): standard fields + `entityId` (`acct_<uuid>`, unique, indexed). Holds the password hash (better-auth uses scrypt, JS-native).
- **`Verification`** (table `verification`): standard fields + `entityId` (`veri_<uuid>`, unique, indexed). Created but unused until email verification / magic link / password reset land.

**ID generation**: `crypto.randomUUID()` (Node native, no dep) for the `entityId` column, prefixed per table. Implemented via `databaseHooks.<model>.create.before` for each of the four models. Same generator as `req_<uuid>` already in production.

**Soft-delete**: deferred. Adds when the first delete-user feature lands.

**Migration**: one new migration `add_auth_tables` adds all four. Generated locally via `prisma migrate dev`; applied in CI via the existing `migrate-db` ECS one-off task.

## API design
- **Mount**: `app.mount('/auth', auth.handler)`. Routes used in this PR: `/auth/sign-up/email`, `/auth/sign-in/email`, `/auth/sign-out`, `/auth/get-session`.
- **Cookies**: better-auth defaults — `Secure`, `HttpOnly`, `SameSite=Lax`, no `Domain` set yet (no DNS).
- **No app-owned auth routes** in this PR.
- **Error wire shapes**: better-auth uses its own format on its routes (accepted, no wrapping). The existing typed-error envelope (`{ code, message, details? }`) continues to apply to non-better-auth routes.

## Error handling
- Better-auth handles its own route errors (400 on bad body, 401 on bad credentials, 409 on duplicate email).
- No new typed-error classes.
- Better-auth's password validation defaults (min 8 chars). No custom rules.

## Integration points
- **New deps**: `better-auth` (latest pinned).
- **No new AWS resources** beyond an additional Secrets Manager secret.
- **Touches**: `apps/api/src/env.ts`, `apps/api/src/app.ts`, `apps/api/src/lib/auth.ts` (new), `apps/api/prisma/schema.prisma`, one new Prisma migration, `apps/api/package.json` + `pnpm-lock.yaml`, `apps/api/vitest.config.ts`, `infra/cdk/lib/data-stack.ts` (new secret), `infra/cdk/lib/app-stack.ts` (inject secret).

## Infrastructure (CDK)
- **DataStack**: new Secrets Manager secret `${PRODUCT}-${envName}-app-secrets` with auto-generated 32-byte `betterAuthSecret` field via `SecretValue.generateSecretString`. Future app-level secrets land in the same JSON (one secret, many fields).
- **AppStack**: API container injects `BETTER_AUTH_SECRET` from the secret via `ecs.Secret.fromSecretsManager(appSecrets, 'betterAuthSecret')`.
- **No deploy-order changes** — secret created in DataStack, consumed by AppStack, same as DB credentials pattern.
- **Cost**: Secrets Manager $0.40/mo per secret + API call costs (negligible). Total ~$0.50/mo additional.

## Env vars
| Var | Default | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | **required, no default** | `z.string().min(32)`. Production via Secrets Manager. CI via `vitest.config.ts`. Local via `.env` file (see below). |

`BETTER_AUTH_URL` deferred to the OAuth PR (not needed for email + password).

## Local dev
- Add `apps/api/.env.example` with `BETTER_AUTH_SECRET=local-dev-secret-not-for-production-min-32-chars`. Developer copies once to `.env` (gitignored).
- `pnpm dev` script: `tsx watch --env-file-if-exists=.env src/index.ts` (Node 24 native flag, tsx passes it through, no new dep).
- **Rename `docs/runbooks/local-postgres.md` → `docs/runbooks/local-dev.md`**; extend with the `.env` setup step alongside the existing Postgres + migrations content.

## CI/CD
- No workflow changes. Existing `ci` (with Postgres service container + `prisma migrate deploy`), `migrate-db`, `deploy-app`, `smoke` cover this PR.
- `vitest.config.ts` adds `BETTER_AUTH_SECRET: 'test-secret-32-chars-minimum-aaaa'` to `test.env`.

## Testing
8 integration tests in `apps/api/src/auth.integration.test.ts`:
1. Signup happy path → 200, cookie set, user row exists with `entityId` matching `^usr_[0-9a-f-]{36}$`.
2. Signup duplicate email → 409.
3. Signup weak password (<8 chars) → 400.
4. Signin happy path → 200, cookie set.
5. Signin wrong password → 401.
6. Get-session with cookie → 200 with `{ user, session }`.
7. Get-session without cookie → 200 with `null`.
8. Sign-out with cookie → 204, then get-session returns `null`.

**Isolation**: unique email per test (`${test-name}-${randomUUID()}@example.com`). No DB cleanup. Transaction-rollback fixture deferred until the first write-side test that needs strict isolation.

**No unit tests** for the better-auth wiring (framework code). **No E2E** in this PR (no frontend yet).

## Documentation
This PR includes (not separate docs PRs):
- **`code-style` skill** — extend the "Naming → Prefixed IDs" bullet with: (a) the truncated/Stripe-style rule (3-4 chars, not full word), (b) the requirement that new prefixes need user sign-off, (c) a small **registry table** of every approved prefix in use after this PR (`req_`, `usr_`, `sess_`, `acct_`, `veri_`).
- **`project_overview.md`** — Identifiers section: update the example list to use truncated prefixes (`usr_`, `org_` already short, `memb_`, `sub_`, etc.), and update "Underlying generators" to say `crypto.randomUUID()` is the single generator across request and entity IDs.
- **Renamed runbook** `docs/runbooks/local-dev.md` (was `local-postgres.md`) — add `.env.example` setup step.
- **`progress.md`** — new entry at the top on merge.
- **`system-design.md`** — minor: add `/auth/*` to the mounted-route list. No infra topology change.

## Out of scope (deferred — explicit follow-ups)
- Email verification, magic link, password reset (need an email transport — SES not wired)
- OAuth providers (Google, GitHub, etc.)
- 2FA (TOTP)
- Organisations + memberships (their own data model + invite flow)
- Staff role + impersonation (need `apps/internal`)
- Frontend signup / login forms (no SPA scaffolded yet)
- Rate limiting (`better-auth` ships its own — defer until rate-limit work lands)
- Audit log
- `requireAuth` middleware + `getCurrentUser` helper (lands with first protected route)
- `packages/auth` extraction (lands at second consumer — likely the worker)
- `BETTER_AUTH_URL` env var (lands with OAuth)
- Soft-delete on `User` (lands with first delete-user feature)
- Per-test transaction-rollback fixture (lands with first write-side test that needs strict isolation)
