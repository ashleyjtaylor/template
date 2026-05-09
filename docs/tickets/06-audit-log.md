# 06 — Audit log foundation (schema + write path)

Plan agreed via `/pre-feature` before implementation begins.
To be shipped via `feat/api-audit-log`.

This is the **first** of two complementary observability features. Audit log records semantic state-changing actions (who did what); the **API request log** (high-volume per-HTTP-request store) is its own future ticket.

## Requirements

- Every auth-significant action (and, when those tables exist, every org-governance + staff action) writes a row to `audit_log` after the originating mutation succeeds. Best-effort: if the audit write throws, log it via pino and let the request succeed.
- "Done" bar:
  1. Sign up → `audit_log` has a row with `action: 'user.signed_up'`, `actorUserId` matching the new user's `entityId`, `requestId` matching the response's `X-Request-Id` header, `details` carrying email/firstname/lastname.
  2. Sign in → row with `action: 'user.logged_in'`.
  3. Sign out → row with `action: 'user.logged_out'`.
  4. The TS action union is exhaustive over the auth + org + staff scopes — auth events have callers wired today; org and staff event types exist in the union with no callers, ready for future PRs to wire.
  5. Spot-check via `psql` / Prisma Studio. No read API, no UI in this PR.

## Data model

```prisma
model AuditLog {
  entityId            String   @id @map("entity_id")           // aud_<uuid>
  requestId           String?  @map("request_id")
  createdAt           DateTime @default(now()) @map("created_at")
  action              String                                    // 'user.signed_up' | 'organisation.member.invited' | …
  actorUserId         String?  @map("actor_user_id")            // entityId of the acting user; null for system actions
  actorImpersonatorId String?  @map("actor_impersonator_id")    // entityId of staff acting as actorUserId; null otherwise
  resourceType        String?  @map("resource_type")            // 'user', 'organisation', etc.
  resourceId          String?  @map("resource_id")              // entityId of the affected resource
  ipAddress           String?  @map("ip_address")
  userAgent           String?  @map("user_agent")
  details             Json                                      // typed at write, free-form at rest

  @@index([actorUserId, createdAt])
  @@index([resourceType, resourceId, createdAt])
  @@index([action, createdAt])
  @@index([requestId])
  @@map("audit_log")
}
```

- snake_case columns via `@map` (our own table → follows database skill convention)
- Single PK is `entityId` with the `aud_` prefix (per the database skill — our own tables have `entityId` as PK, no separate `id`)
- No FK to `User` — keeps the audit table independent of user-table cascades. User-deletion code (future PR) will explicitly anonymise via `prisma.auditLog.updateMany({ where: { actorUserId: <id> }, data: { actorUserId: null } })`.
- `details` is `Json`; we don't query into it.

## `writeAudit` helper (`apps/api/src/lib/audit.ts`, new file)

Typed discriminated union of every action; helper serialises the action-specific fields into `details` and pulls cross-cutting fields (requestId, ipAddress, userAgent, actorImpersonatorId) from request context.

```ts
export type AuditEvent =
  // wired today
  | { action: 'user.signed_up'; actorUserId: string; email: string; firstname: string; lastname: string }
  | { action: 'user.logged_in'; actorUserId: string }
  | { action: 'user.logged_out'; actorUserId: string }
  // future — type entries only, no callers yet
  | { action: 'organisation.created'; actorUserId: string; resourceId: string; name: string }
  | { action: 'organisation.member.invited'; actorUserId: string; resourceId: string; email: string; role: string }
  | { action: 'organisation.role.changed'; actorUserId: string; resourceId: string; targetUserId: string; before: string; after: string }
  | { action: 'staff.impersonation.started'; actorUserId: string; targetUserId: string }
  | { action: 'staff.impersonation.stopped'; actorUserId: string; targetUserId: string }
```

## Write path (Q5: D + B1)

- **Better-auth events** (signup, login, logout) → `databaseHooks.<model>.<event>.after` blocks in `apps/api/src/lib/auth.ts` call `writeAudit({ ... })`. Awaited; errors caught and logged (B1 — *awaited, error-swallowed*).
- **Our own services** (none today; future PRs) → call `writeAudit({ ... })` after the mutation succeeds. Awaited, errors caught and logged.
- **No transaction wrapping.** Best-effort writes. The latency cost is ~1-2ms (one insert) and visibility on failures is worth far more than zero added latency.
- Differentiating signup from login: `user.create.after` fires `user.signed_up` (only fires for new users). `session.create.after` fires `user.logged_in` *unless* it's the first session for the user (in which case `user.signed_up` already covered it). Implementation: query `prisma.session.count({ where: { userId } })` inside the hook — if `1`, skip; otherwise emit `user.logged_in`.

## API design

None. No read endpoints in this PR. Read API + UI ship with `apps/internal` scaffold (its own `/pre-feature`).

## Error handling

`writeAudit` catches everything, logs at `error` level via pino (`logger.error({ err, action }, 'audit write failed')`), and returns. The originating request never sees an audit failure. No new HTTP error classes.

## Integration points

- **`apps/api/src/lib/audit.ts`** (new) — helper + types
- **`apps/api/src/lib/auth.ts`** — extends `databaseHooks` with `after` hooks for `user.create`, `session.create`, `session.delete`
- **`apps/api/prisma/schema.prisma`** — adds `AuditLog` model + new migration
- **No new deps**, no CDK changes

## Infrastructure

None. New Postgres table, picked up by the existing `migrate-db` ECS one-off task before `deploy-app` runs.

## Tamper-evidence (Q7 = A)

Append-only by code discipline. No `update` or `delete` calls anywhere in our code — `writeAudit` is the only entry point and it only does `prisma.auditLog.create`. No DB-level revoke (that's appropriate at the SOC2/HIPAA stage; premature today).

## Retention (Q8 = A + D)

- **Keep forever.** No scheduled cleanup. ~5 GB/year at our projected scale; storage is cheap and future compliance requirements always lean toward longer retention.
- **On user deletion** (future feature): anonymise `actorUserId` (and `actorImpersonatorId` if present) via `updateMany({ where: { actorUserId: <id> }, data: { actorUserId: null } })`. Action and details survive, identity is erased.

## PII storage policy (Q9)

- **DO store** in `details`: action discriminator, resource IDs, role names, plan names, before/after for changed scalars, email/firstname/lastname on signup events.
- **DON'T store** anywhere: passwords (hashed or otherwise), OAuth tokens, payment-card details, secrets, full email content, full request bodies, anything covered by the existing "what not to log" list in the project overview.

## Testing

- One unit test for `writeAudit` happy path (mocked Prisma).
- One unit test asserting `writeAudit` swallows errors and logs them (mocked Prisma rejects → `logger.error` called → `writeAudit` returns).
- Extend the existing signup integration test to assert a `user.signed_up` row exists with the right `actorUserId`, `requestId`, and `details.email`/`details.firstname`/`details.lastname`.
- Extend the existing signin happy-path integration test to assert a `user.logged_in` row exists.
- Extend the existing signout integration test to assert a `user.logged_out` row exists.

## Documentation

- **New `audit` skill** (`.claude/skills/audit/SKILL.md`) — action naming convention (past-tense + CRUD), `writeAudit` usage pattern, DO/DON'T for `details` payloads, tamper-evidence + retention policy, anonymisation rule on user-delete, the action union as the source of truth for "what events exist".
- **`database` skill** — short cross-reference to the audit skill from the "Row → request correlation" section ("for high-level semantic events, see the `audit` skill — `requestId` is the lightweight per-row correlation, `audit_log` is the heavyweight semantic store").

## Out of scope (deferred — explicit follow-ups)

- **Read API + UI** in `apps/internal` (its own `/pre-feature` once `apps/internal` is scaffolded)
- **API request log** (the second feature from the original "Stripe-style logs" ask — own `/pre-feature` after this lands)
- **Outbox pattern** / true tamper-evidence (hash chain, DB-level `REVOKE`) — adopt at the SOC2 / HIPAA threshold
- **User-deletion anonymisation logic** — lands with the user-delete feature
- **Org-governance + staff event callers** — type entries exist; callers land with each respective feature PR
- **Per-user "Your account activity" UI** in `apps/web` — own `/pre-feature` later
- **Diff capture for updates** (storing both `before` and `after` snapshots automatically) — for now each event carries explicit before/after fields where relevant
