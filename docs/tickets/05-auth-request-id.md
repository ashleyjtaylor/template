# 05 — `requestId` column on auth tables (request-row correlation)

Plan agreed via `/pre-feature` before implementation begins.
To be shipped via `feat/api-auth-request-id`.

## Requirements

- Every row in `User`, `Session`, `Account`, `Verification` records the **exact HTTP request** that created it. The value is the `req_<uuid>` already attached to logs and the `X-Request-Id` response header (seeded by `apps/api/src/middleware/request-id.ts` via `AsyncLocalStorage`).
- "Done" bar:
  1. Sign up via `/auth/sign-up/email` → newly-created `user`, `session`, `account` rows all have `requestId` matching the response's `X-Request-Id` header.
  2. Sign in via `/auth/sign-in/email` → newly-created `session` row has `requestId` matching the response's `X-Request-Id` header (existing user/account rows untouched).
  3. Querying the table by `requestId` is fast (indexed lookup, not full scan).
  4. Out-of-request inserts (seed scripts, future BullMQ jobs, manual SQL) leave `requestId` as `NULL`.

## Data model

Identical change applied to all four better-auth tables in `apps/api/prisma/schema.prisma`:

```prisma
requestId String?
@@index([requestId])
```

- **Nullable** — out-of-request inserts (seed scripts, jobs, manual SQL) won't have a request context. Forcing `NOT NULL` would mean inventing fake IDs for those paths.
- **Indexed** — the use case is "give me every row that came from request `req_abc123`"; without an index, that's a full-table scan.
- **Not unique** — one signup creates 3 rows (user + session + account) sharing one requestId.
- **Set on `create` only** — never overwritten on update (a session refresh shouldn't change which request originally created the session).

## API design

No new routes. No body / response shape changes (clients see the same `X-Request-Id` header they already see on every response).

## Error handling

No new error codes. `requestId` capture is best-effort: if `getRequestId()` returns `undefined` (no AsyncLocalStorage context), the column stores `NULL` rather than throwing.

## Integration points

- **`apps/api/src/lib/auth.ts`** — adds one `additionalFields.requestId` entry per model (User, Session, Account, Verification), each with `defaultValue: () => getRequestId() ?? null`. Same pattern we already use for `entityId`.
- **No new deps**. No CDK changes.
- **Cross-cutting consequence**: this convention (every writable table we own carries `requestId`) is documented in the `database` skill so future tables inherit it without re-deciding.

## Infrastructure (CDK)

None.

## Env vars

None.

## CI/CD

None — existing `migrate-db` ECS one-off task applies the new migration in staging before `deploy-app` runs.

## Testing

- One assertion added to the existing `should create a user with a usr_-prefixed entityId and set a session cookie` test in `apps/api/test/integration/auth.test.ts`: assert the freshly-created user/session/account rows all have a non-null `requestId` matching the signup response's `X-Request-Id` header.
- No new test files. No unit tests for the better-auth wiring (framework code).

## Documentation

- **`.claude/skills/database/SKILL.md`** — extend with a "Row → request correlation" section: every writable table we own carries `requestId String?` + `@@index([requestId])`, populated automatically inside HTTP handlers via `AsyncLocalStorage`. Out-of-request inserts (seed scripts, jobs) leave it `NULL`.
- **`.claude/skills/auth/SKILL.md`** — extend the additionalFields example to include the `requestId` field so future better-auth-touching changes copy the right shape.

## Out of scope (deferred — explicit follow-ups)

- `audit_log` table for full request meta-data (headers, body hash, ipAddress, userAgent on every mutation) — driven by GDPR / SOC2 / staff impersonation logging, owns its own `/pre-feature`
- Generalising `requestId` to non-auth tables — happens automatically as new tables land via the `database` skill convention; no retroactive backfill of the (currently zero) other tables we own
- Backfill of pre-existing rows — there are no production rows yet (staging's been torn down multiple times), so no migration data update needed
