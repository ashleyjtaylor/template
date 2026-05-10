---
name: database
description: Apply database conventions — prefixed entity IDs, schema/column naming, migrations, soft-delete, cascade rules. Use when designing or reviewing schema changes, writing migrations, or naming a new entity.
---

Apply these to any schema change, migration, or new entity.

## Prefixed entity IDs

Every system-generated identifier — entities (`User`, `Session`, future `Organisation`, `Subscription`, `Upload`, etc.) and ephemeral identifiers (`req_…` HTTP request IDs) — uses Stripe-style `prefix_<id>` form.

**Truncated, not full word.** 3-4 char prefix:

- `usr_` not `user_`
- `acct_` not `account_`
- `sess_` not `session_`
- `org_` (already short — keep)
- `memb_` not `membership_`
- `sub_` not `subscription_`
- `upl_` not `upload_`

**Generator**: `crypto.randomUUID()` (Node native, no dep). Same generator for everything; the prefix is the only differentiator. When `packages/ids` lands, it owns the generator.

**Storage column**: `entityId` (camelCase, separate from the auth-framework-managed `id` column on better-auth tables; primary key on tables we own). The `entityId` is `@unique` and indexed — it is the public-facing identifier in URLs, logs, API responses. Internal joins still go through whichever column is the primary key.

**New prefixes need user sign-off.** Once a prefix is chosen, it cannot be renamed without a data migration (the value is in URLs, logs, customer support records). Add the new entry to the registry below in the same PR that introduces it.

### Prefix registry

| Prefix | Entity | Defined in |
|---|---|---|
| `req_` | HTTP request ID | `apps/api/src/middleware/request-id.ts` |
| `usr_` | User | `apps/api/src/lib/auth.ts` (better-auth `additionalFields.entityId.defaultValue`) |
| `sess_` | Session | `apps/api/src/lib/auth.ts` |
| `acct_` | Auth account (better-auth) | `apps/api/src/lib/auth.ts` |
| `veri_` | Email verification token | `apps/api/src/lib/auth.ts` |
| `aud_` | Audit log row | `apps/api/src/modules/audit-log/service.ts` |
| `org_` | Organisation | `apps/api/src/modules/organisations/service.ts` |
| `memb_` | Membership (M:N user↔org with role) | `apps/api/src/modules/organisations/service.ts` |
| `inv_` | Invitation | `apps/api/src/modules/org-invitations/service.ts` |

## Column naming

Default to **snake_case** for column names via Prisma's `@map`. Two exceptions exist today:

1. **Better-auth tables** (User, Session, Account, Verification) keep camelCase columns to match better-auth's vendor schema 1:1 — its docs and migrations assume camelCase, and remapping every field would create an ongoing maintenance tax. Our additions on those tables (`entityId`, `firstname`, `lastname`) follow the same vendor convention for consistency within the table.
2. **Tables we own** use snake_case (`created_at`, `user_id`, etc.).

If a future vendor library forces another camelCase island, document the deviation in the schema file with a comment naming the vendor and reason.

## Migrations

- One commit per schema change; one Prisma migration directory per change. Don't bundle unrelated schema changes.
- Migration names use kebab-slug describing the change (`add_auth_tables`, `add_organisation_membership`, not `update_schema`).
- Generated locally via `pnpm exec prisma migrate dev --name <slug>` (apply to dev DB). Apply to test DB via `DB_NAME=template_test pnpm exec prisma migrate deploy`. Same files run in CI's `migrate-db` ECS one-off task against staging.
- **Inspect the generated SQL before committing.** Prisma occasionally emits no-op or surprising SQL (e.g. converting `SERIAL` to explicit sequence + nextval) that may collide with the existing DB state. Strip noise; keep what actually expresses the schema delta.
- Once a migration is committed and shipped, **never edit it**. Add a new migration to fix.

## Partial unique indexes

Prisma's schema language can't express partial uniqueness (`UNIQUE ... WHERE ...`). When you need one — e.g. "at most one outstanding invitation per (organisation, email), but accepted/revoked rows don't collide" — generate the migration via `prisma migrate dev` first, then **append** the partial-index SQL to the migration file by hand:

```sql
CREATE UNIQUE INDEX "invitation_organisation_id_email_pending_key"
  ON "invitation" ("organisation_id", "email")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
```

Apply it to the local DB out-of-band (`docker exec -i template-postgres psql -U postgres -d template_dev <<<...`) so dev / file / staging stay in sync. Add a comment in `schema.prisma` near the model noting the partial index lives in the migration. Service code should still pre-check for friendlier 409s — the partial index is the safety net under concurrent writes.

## Foreign keys + cascades

- Foreign keys to a parent that owns the child use `onDelete: Cascade` (`Session.userId → User.id`, `Account.userId → User.id`).
- Foreign keys to a parent that doesn't own the child use the default `Restrict` — let the DB block deletion until the caller explicitly handles it. No `onDelete: SetNull` unless there's a documented reason in the schema.
- Index every foreign key column. Prisma adds an index automatically when you declare the relation; verify the migration created it.

## Row → request correlation

Every writable table we own carries:

```prisma
requestId String?
@@index([requestId])
```

The column captures the `req_<uuid>` of the HTTP request that created the row. Inside any request handler the value comes from the `AsyncLocalStorage` context seeded by `apps/api/src/middleware/request-id.ts` — read via `getRequestId()` from `@/lib/logger.js`.

**Nullable + non-unique + indexed.** Out-of-request inserts (seed scripts, future BullMQ jobs, manual SQL) leave it `NULL`; one HTTP request typically writes multiple rows so uniqueness would be wrong; lookups are sparse enough that the index pays off.

**Set on `create` only.** Never overwrite on subsequent updates — the original creation request is the audit value.

**For better-auth-managed tables** (User, Session, Account, Verification): wire via `additionalFields.requestId.defaultValue: () => getRequestId() ?? null`. Better-auth's Prisma adapter strips fields not declared via `additionalFields` — see the `auth` skill for the full pattern.

**For our own future tables**: declare the column on the model and populate at the call site (or via a Prisma client extension once we have several). When we have a third call site, factor into `packages/db`.

**For full request meta-data** (headers, body hash, ipAddress, userAgent, etc.) on security-sensitive mutations: that lives in the `audit_log` table, not on every row. `requestId` here is the lightweight per-row correlation key; `audit_log` (next section) is the heavyweight semantic event store.

## Audit log

`audit_log` is the **append-only** record of cross-cutting governance events. The `writeAudit` helper lives in `apps/api/src/modules/audit-log/service.ts`; the `AuditEvent` discriminated union (every action's typed payload) lives next to it in `events.ts`. **Best-effort writes** (awaited but error-swallowed); never wrap in `prisma.$transaction` with the originating mutation — losing one event is preferable to failing a real user action because of an audit-write bug.

### When to write an event

Write one when the action is one of:

- **Auth lifecycle** — signup, login, logout, password change, email change, 2FA toggle, account deletion. Wired today via better-auth's `databaseHooks.<model>.<event>.after`.
- **Org governance** — org create/delete/rename, member invite/accept/remove, role change, billing-plan change.
- **Staff actions** — anything performed from `apps/internal`, especially staff-as-customer impersonation (impersonation events are double-logged: actor + impersonated user).

Don't write for:

- Reads (no state changed)
- Health probes, internal cron ticks, container lifecycle
- Per-domain mutations that already have their own row (e.g. don't audit-log "document edited" — the document table is the audit). Audit is for **cross-cutting governance events**, not every business mutation.

### How to write

```ts
import { writeAudit } from '@/modules/audit-log/service.js'

// after the mutation has succeeded
await writeAudit({
  action: 'organisation.member.invited',
  actorUserId: actor.entityId,
  resourceId: org.entityId,
  email: invitee.email,
  role: 'admin'
})
```

- Awaited, error-swallowed (~1-2ms latency, errors logged via pino at `error` level, never propagated)
- Outside transactions
- Better-auth events go through `databaseHooks.<model>.<event>.after` in `apps/api/src/lib/auth.ts`; our own services call `writeAudit` after the mutation succeeds

### Action naming

`<resource>.<event>` with these rules:

- **Past-tense verbs by default** — `user.signed_up`, `user.logged_in`, `org.member.invited`, `org.role.changed`, `staff.impersonation.started`. Reads naturally as "X happened."
- **CRUD-style where it fits** — `<resource>.created`, `<resource>.updated`, `<resource>.deleted` for pure lifecycle events on a single resource.
- **snake_case for the verb part**, dot-separated for the noun chain.
- **Pick once, never rename** — action names live in audit rows forever. Add a new action; deprecate the old in code.
- **New actions need user sign-off** before adding to the union.

### What to put in `details` (the JSON column)

**DO store:**
- Action discriminator (mirrored from the `action` field — keeps details self-contained for export/analysis)
- Resource IDs (entityIds), role names, plan names
- Before/after for changed scalars (`{ before: 'member', after: 'admin' }` on `org.role.changed`)
- Email, firstname, lastname on signup events (already in user table; storing in audit is not new exposure, useful for support)

**DON'T store anywhere:**
- Passwords (hashed or otherwise), OAuth tokens, payment-card details, secrets
- Full request bodies, full response bodies
- Full email content (MIME bodies, message text)

If unsure: lean against. Audit is forever; PII added today is PII you carry forever.

### Tamper-evidence + retention

Append-only by **code discipline**:

- `writeAudit` is the **only** caller that touches `audit_log`. It only does `prisma.auditLog.create`.
- Never call `update` / `delete` / `deleteMany` / `upsert` against `audit_log` from anywhere.
- The **one exception**: user-deletion code anonymises rows by nullifying `actorUserId` / `actorImpersonatorId` (see below). That's the only allowed `update` path.
- DB-level hardening (`REVOKE`, hash chains, signed rows) is appropriate at the SOC2 / HIPAA stage. Premature today.

Retention: **forever.** No scheduled cleanup. ~5 GB/year at our scale; storage is cheap and future compliance always leans toward longer retention.

### Anonymisation on user delete

When the user-deletion feature lands (deferred), it must call:

```ts
await prisma.auditLog.updateMany({
  where: { actorUserId: user.entityId },
  data: { actorUserId: null }
})
await prisma.auditLog.updateMany({
  where: { actorImpersonatorId: user.entityId },
  data: { actorImpersonatorId: null }
})
```

The action and details survive — identity is erased. Personal fields inside `details` (email, firstname, lastname) also need nulling out by the same flow. This is the **only** code path allowed to `update` `audit_log`.

### Source of truth: the action union

Every audit action lives as a member of the `AuditEvent` discriminated union in `apps/api/src/modules/audit-log/events.ts`. To add one:

1. Add the new union member with the typed payload fields.
2. Add a caller (`writeAudit({ action: '...', ... })`) at the mutation site.
3. PR the change with the same review depth as a public API addition — these names persist forever.

Never write `prisma.auditLog.create` directly; always go through `writeAudit`.

### Read API + UI

The `audit_log` table is exposed read-only at `/api/audit-log`, `/api/audit-log/actions`, and `/api/audit-log/:entityId`, gated by the `requireStaff` middleware (see the `auth` skill). `apps/internal` consumes those routes — list view with filter + cursor pagination, detail view with the full `details` JSON. Per-route documentation lives in `docs/endpoints.md`.

## Soft delete

Not implemented yet. When the first delete-user feature lands, add `deletedAt DateTime?` to the relevant tables and route reads through a repository helper that filters `deletedAt: null` by default. Until then: `delete()` is a hard delete.

## Readiness probe

`/health/ready` calls `prisma.user.findFirst()` to prove (a) DB reachable and (b) migrations applied. When the User table goes away or gets an access constraint that breaks a `findFirst()` from the API role, swap the probe to another long-lived table — but always use a real domain table (not a lighthouse table — those rot the moment a real model exists).

## Connection URL composition

Two places compose the Postgres URL from the five `DB_*` env vars: `apps/api/src/env.ts` (runtime client) and `apps/api/prisma.config.ts` (Prisma CLI). Both must produce the same string. The duplication is intentional — `prisma.config.ts` ships to the container's `/prod` directory after `pnpm deploy --prod`, where importing from `src/` isn't possible. Cross-file invariant comments in both files name the other; keep them in sync.

RDS endpoints (`*.rds.amazonaws.com`) get `?sslmode=require&uselibpqcompat=true` appended — RDS forces TLS, and `pg-connection-string` interprets `sslmode=require` as `verify-full` which fails against RDS's Amazon CA. Local Compose / CI Postgres doesn't speak SSL, so the suffix is gated on host name.

## Before adding a schema change, answer

- What entity prefix? Is it already in the registry?
- snake_case (we own it) or camelCase (vendor table)?
- Foreign keys + cascade rules?
- Indexes — beyond the auto-generated FK indexes, anything queried frequently?
- Migration name slug?
- Does this affect `/health/ready` or any other read?
