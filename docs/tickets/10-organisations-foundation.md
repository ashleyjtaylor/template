# 10 — Organisations: foundations + invites + role management

Plan agreed via `/pre-feature` before implementation begins.
To be shipped via `feat/api-organisations`.

First multi-tenancy primitive in the template. Lays down the `Organisation`, `Membership`, and `Invitation` tables; both signup paths (standard user-only and team composite); the full member + invite + role-management API; and the row-level permission helpers. Deliberately excludes soft-delete, the staff-vs-customer DB invariant, Stripe customer creation, and any UI — those follow as their own tickets.

## Requirements

- **Two signup paths.** Forks pick whichever fits their product:
  - Existing `POST /api/auth/sign-up/email` — user only, no org. Single-user-product forks use just this.
  - New `POST /api/orgs/sign-up` — composite: creates user + org + owner membership in one transaction. Team-product forks use this.
  - **No personal-org-on-signup auto-create** anywhere. Project_overview gets revised.
- **Invited new users** sign up via the standard route, then their client calls `POST /api/invitations/:token/accept` once authenticated. Invites are not coupled to either signup endpoint.
- **Org URL identifier**: `entityId` (`org_<uuid>`). No `slug` column in this PR — pretty URLs land later as an additive migration if/when wanted.
- **Active org** = whatever's in the URL. No server-side active-org state, no `lastVisited` field anywhere. SPA hits `GET /api/orgs` (queries `Membership` by `userId`) and routes to a member org.
- **Roles**: `'owner' | 'admin' | 'member'`. Action matrix locked in the interview (see "Role capabilities" below).
- **No email transport in this PR.** `POST /api/orgs/:orgId/invitations` returns the raw token in the response (only on creation, never in subsequent listings). Inviter sends the link out of band. When SES lands, a worker consumes an `invitation.created` event and renders the email — API shape is forward-compatible.

**"Done" bar**:

1. Standard signup → user only, `GET /api/orgs` returns `[]`.
2. Team signup with `organisationName` → user + org + owner membership in one transaction; `GET /api/orgs` returns the new org with role `owner`.
3. Authed user creates a second org via `POST /api/orgs` → becomes its owner.
4. Owner invites someone via `POST /api/orgs/:orgId/invitations` → response includes a one-time `link` containing the raw token; subsequent `GET .../invitations` responses do not.
5. Invitee signs up via standard route then `POST /api/invitations/:token/accept` → membership row created, audit row written, email-mismatch / expired / revoked / already-accepted all return their typed errors.
6. Last-owner protection: any operation that would leave an org with zero owners (demote / remove / leave / accept-while-already-only-owner-of-other-org) returns `409 LastOwnerRequired`.
7. Role-based access enforced on every org route per the matrix — non-members get 404 (no enumeration), authed-but-underprivileged get 403.

## Data model

Three new tables. All columns snake_case via Prisma `@map` per `database` skill. Cascade deletes wired today; once soft-delete lands in a future PR, those cascades still apply at hard-delete time.

### `Organisation` (table `organisation`)

- `entityId` PK, `org_<uuid>`
- `name` — free-text, trimmed, 1–80 graphemes, non-unique
- `requestId` — nullable, indexed (existing convention)
- `createdAt`
- (no `updatedAt` — audit log captures changes)
- (no `deleted_at` — soft-delete deferred)

### `Membership` (table `membership`)

- `entityId` PK, `memb_<uuid>`
- `organisationId` FK → `organisation.entityId`, **cascade delete**
- `userId` FK → `user.id` (better-auth's internal column, not `entityId`), **cascade delete**
- `role` — column type `text`; narrowed at the helper layer to `'owner' | 'admin' | 'member'`
- `requestId` — nullable, indexed
- `createdAt`
- **Unique** `(organisationId, userId)` — a user is in an org at most once
- **Indexed** `(userId)` for "list my orgs"
- **Indexed** `(organisationId, role)` for "find owners of this org" (last-owner check)

### `Invitation` (table `invitation`)

- `entityId` PK, `inv_<uuid>`
- `organisationId` FK → cascade delete
- `email` — lowercased on write, the address being invited
- `role` — `'admin' | 'member'` only; cannot invite straight to `owner`
- `tokenHash` — sha256 hex of the raw token. **Raw token never stored** — only delivered in the create response and embedded in the email link.
- `invitedByUserId` FK → user
- `acceptedAt` (nullable), `acceptedByUserId` (nullable FK), `revokedAt` (nullable), `expiresAt` (default now + 7 days)
- `requestId`, `createdAt`
- **Partial unique index** `(organisationId, email) WHERE acceptedAt IS NULL AND revokedAt IS NULL` — at most one outstanding invite per email per org
- **Indexed** `(tokenHash)` — fast lookup on accept
- **Indexed** `(email)` — "what invites am I sitting on"

## Role capabilities

| Action | member | admin | owner |
|---|---|---|---|
| View org / list members / list invites | ✓ | ✓ | ✓ |
| Edit org name | – | ✓ | ✓ |
| Invite a `member` | – | ✓ | ✓ |
| Invite an `admin` | – | – | ✓ |
| Revoke a pending invite | – | ✓ | ✓ |
| Change a `member`'s role to `admin` | – | – | ✓ |
| Change an `admin`'s role to `member` | – | – | ✓ |
| Promote anyone to `owner` (creates co-owner) | – | – | ✓ |
| Demote an `owner` to `admin`/`member` | – | – | ✓ (last-owner rule) |
| Remove a `member` | – | ✓ | ✓ |
| Remove an `admin` | – | – | ✓ |
| Remove an `owner` | – | – | ✓ (last-owner rule) |
| Leave the org (self) | ✓ | ✓ | ✓ (last-owner rule) |
| Transfer ownership (atomic step-down) | – | – | ✓ |

**Edge-case rules** (locked in interview):

- **Last-owner protection**: any mutation that would leave an org with zero owners → `409 LastOwnerRequired`. Enforced inside a transaction that re-checks the owner count after the candidate mutation.
- **Accepting an invite when already a member**: invite is consumed (marked `acceptedAt`), no new membership created, returns 200 with the existing membership. `audit_log` row carries `alreadyMember: true`.
- **Accepting an invite for a different email**: `403 ForbiddenError` with `details.reason = 'InvitationEmailMismatch'`. Bob can't redeem an invite addressed to alice@example.com.

## API design

All under `/api/*`. `:orgId` is the org's `entityId`; `:userId` is a user's `entityId` (`usr_…`); `:invitationId` is `inv_…`; `:token` is the raw base64url token from the invite link.

**Org creation paths**

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/api/orgs/sign-up` | none (public) | `{ email, password, firstname, lastname, organisationName }` | `200` `{ user, organisation, membership }` + session cookie |
| `POST` | `/api/orgs` | session | `{ name }` | `200` `{ organisation, membership }` (caller becomes `owner`) |

`POST /api/orgs/sign-up` internally calls `auth.api.signUpEmail()` then creates org + membership in the same transaction. Rolls back the whole thing on any failure. **Rejects an `inviteToken` field in the body** — invited signups go through standard signup, not team-signup.

**Org reads + edits**

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/api/orgs` | session | – | `200` `[{ organisation, membership: { role, createdAt } }, …]` |
| `GET` | `/api/orgs/:orgId` | session + member | – | `200` `{ organisation, membership }` |
| `PATCH` | `/api/orgs/:orgId` | session + admin/owner | `{ name }` | `200` `{ organisation }` |

**Members**

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/api/orgs/:orgId/members` | session + member | – | `200` `[{ membership, user: { entityId, email, firstname, lastname } }, …]` |
| `PATCH` | `/api/orgs/:orgId/members/:userId` | session + per matrix | `{ role }` | `200` `{ membership }` |
| `DELETE` | `/api/orgs/:orgId/members/:userId` | session + per matrix | – | `204` |
| `POST` | `/api/orgs/:orgId/leave` | session + member of org | – | `204` |
| `POST` | `/api/orgs/:orgId/transfer-ownership` | session + owner | `{ newOwnerUserId }` | `200` `{ memberships: [<new owner>, <caller-now-admin>] }` |

`/leave` is dedicated (not `DELETE .../members/me`) so it gets its own audit event distinct from "removed by admin". `/transfer-ownership` is atomic step-down (promote target + demote caller in one tx); if caller wants to stay as co-owner, they use PATCH instead.

**Invitations (org-scoped)**

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/api/orgs/:orgId/invitations` | session + admin/owner | `{ email, role: 'admin' \| 'member' }` | `201` `{ invitation, link }` (raw token only here, never again) |
| `GET` | `/api/orgs/:orgId/invitations?status=pending\|all` | session + admin/owner | – | `200` `[{ invitation, invitedBy: { entityId, email } }, …]` (default pending; `?status=all` includes accepted/revoked/expired). No `tokenHash`, no raw token. |
| `DELETE` | `/api/orgs/:orgId/invitations/:invitationId` | session + admin/owner | – | `204` |

**Invitation acceptance (token-keyed)**

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/api/invitations/:token` | none — bearer token IS the auth | – | `200` `{ organisation: { entityId, name }, role, email, invitedBy: { firstname, lastname }, expiresAt, status }` |
| `POST` | `/api/invitations/:token/accept` | session, email must match invite | – | `200` `{ organisation, membership }` |

`GET .../:token` is public so an unauthenticated user clicking the link can see "Accept invite to **Acme Corp** as **admin** (sent to alice@example.com)" before deciding to sign up or sign in. Accept endpoint hashes incoming token, validates not-expired / not-revoked / not-already-accepted, validates email match, and either creates the membership or no-ops if already a member.

## Validation defaults

- `Organisation.name`: zod `.trim().min(1).max(80)`, no character constraint beyond non-empty after trim.
- `Invitation.email`: `z.string().email().toLowerCase()`. Stored lowercased.
- `Invitation` token: 32 random bytes via `crypto.randomBytes`, base64url-encoded (~43 chars). `tokenHash` = sha256 of raw token, hex-encoded.
- `Invitation.expiresAt`: now + 7 days. Not configurable per-invite for now.
- Outstanding-invite uniqueness: enforced at the DB via partial unique index. Service layer pre-checks for a friendlier `409 OutstandingInvitationExists` rather than a Prisma constraint error.

## Error handling

| HTTP | Code | When |
|---|---|---|
| 400 | `ValidationError` | Bad body (Zod fail) — name length, role enum, email format, etc. |
| 401 | `UnauthorizedError` | No session on a session-required route |
| 403 | `ForbiddenError` | Authed but not authorised. `details.reason` ∈ `'NotAMember'`, `'InsufficientRole'`, `'InvitationEmailMismatch'`. |
| 404 | `NotFoundError` | `:orgId` doesn't exist OR caller isn't a member (deliberate — don't reveal org existence to non-members). `:invitationId` missing. Invite token unknown / hash-mismatch. |
| 409 | `ConflictError` | `details.reason` ∈ `'LastOwnerRequired'`, `'OutstandingInvitationExists'`, `'AlreadyAccepted'`, `'AlreadyRevoked'`, `'Expired'`. |
| 422 | (better-auth's existing) | Reused only on `POST /api/orgs/sign-up` if the underlying `signUpEmail` fails (duplicate email etc.) |

The `details.reason` discriminator is what the SPA branches on for user-friendly copy.

## Audit events

Extend the existing typed `AuditEvent` union in `src/modules/audit-log/events.ts`. Replace the placeholder `organisation.role.changed` with `organisation.member.role_changed` for `member.<verb>` consistency, and wire callers for all of these:

```ts
| { action: 'organisation.created'; actorUserId: string; resourceId: string; name: string }
| { action: 'organisation.name_changed'; actorUserId: string; resourceId: string; before: string; after: string }
| { action: 'organisation.member.invited'; actorUserId: string; resourceId: string; email: string; role: string; invitationId: string }
| { action: 'organisation.invitation.revoked'; actorUserId: string; resourceId: string; invitationId: string }
| { action: 'organisation.invitation.accepted'; actorUserId: string; resourceId: string; invitationId: string; alreadyMember: boolean }
| { action: 'organisation.member.role_changed'; actorUserId: string; resourceId: string; targetUserId: string; before: string; after: string }
| { action: 'organisation.ownership.transferred'; actorUserId: string; resourceId: string; targetUserId: string }
| { action: 'organisation.member.removed'; actorUserId: string; resourceId: string; targetUserId: string }
| { action: 'organisation.member.left'; actorUserId: string; resourceId: string }
```

## Module layout

Following the route → controller → service layering established by the audit-log module refactor (no Prisma in route files; routes do Zod validation only; controllers orchestrate; services own DB + business logic):

```
apps/api/src/modules/organisations/
  routes.ts        — Hono routes. Zod-parses inputs and delegates. No Prisma imports, no business logic.
  controllers.ts   — Orchestration between validated inputs and services. Combines service calls,
                     shapes responses, decides 4xx semantics (e.g. 404 vs found, alreadyMember branch).
  service.ts       — Prisma queries + business logic: createOrg, addMember, changeRole, last-owner
                     check, invite token issuance, the transactional accept flow.
  permissions.ts   — requireMember / requireAdmin / requireOwner (Hono middleware-style; loads
                     membership and gates by role).
  schemas.ts       — Zod input/output schemas.
  tokens.ts        — generateInviteToken, hashToken (sha256). Pure helpers, no I/O.
```

Two `Hono` instances exported from `routes.ts` — `orgRoutes` (mounted at `/api/orgs`) and `invitationAcceptRoutes` (mounted at `/api/invitations`) — wired in `src/app.ts`.

Audit events stay centralised in `modules/audit-log/events.ts` (single discriminated union) so `writeAudit` keeps exhaustive type checking. Orgs module imports `writeAudit` from `audit-log/service.ts`.

`assertCan(membership, action)` / `packages/auth` extraction is **not done in this PR** — role checks live in `permissions.ts` as small helpers. Lifts to `packages/auth` at the second consumer (worker), per the package-extraction rule.

## Testing

Follows the established `apps/api/test/{unit,integration}/` layout, with `unit/modules/<feature>/` mirroring `src/modules/<feature>/`.

**Unit** (`test/unit/modules/organisations/`):

- `permissions.test.ts` — pure last-owner check (given a list of memberships and a candidate mutation, does the result still have ≥1 owner?), positive + negative cases.
- `tokens.test.ts` — token generator produces 32 bytes / base64url; hash determinism (same raw → same hash; different raw → different hash); raw token is never reconstructible from the hash.

**Integration** against the existing Postgres service container, one file per concern:

- `test/integration/organisations.test.ts`:
  - Org creation (5): `sign-up` happy / `sign-up` duplicate email → 422 / `sign-up` rejects `inviteToken` in body → 400 / authed `POST /api/orgs` happy / unauth → 401.
  - Org reads + edits (5): list mine / fetch as member / fetch as non-member → 404 / patch name as admin → 200 + audit row / patch name as member → 403.
  - Members (9): list members / promote member→admin (owner) / promote attempt by admin → 403 / demote sole owner → 409 / remove member as admin / admin tries to remove admin → 403 / remove sole owner → 409 / leave as member / sole-owner leave → 409.
  - Transfer ownership (2): happy / not-owner → 403.
- `test/integration/invitations.test.ts`:
  - Org-scoped (8): create as owner happy (link returned, raw token format) / create as admin invites member / admin invites admin → 403 / duplicate pending → 409 / create as member → 403 / list default = pending no tokens / list `?status=all` includes terminal states / revoke happy.
  - Acceptance (8): public GET happy / public GET unknown token → 404 / accept happy → 200 + membership + audit row / accept email mismatch → 403 InvitationEmailMismatch / accept already-a-member → 200 + no new membership + audit `alreadyMember: true` / accept expired → 409 / accept revoked → 409 / accept unauth → 401.

~37 integration tests + 3 unit tests. Sized to the privilege-escalation footprint — for membership code, breadth is justified.

External I/O: real Postgres only. `auth.api.signUpEmail()` runs as in production (not mocked). No Stripe, SES, S3, or Redis touched.

## Infrastructure

None. Three new Postgres tables + one Prisma migration. Migration runs through the existing `migrate-db` ECS one-off task before `deploy-app-stack`. No new AWS resources, no new secrets, no new env vars, no deploy-order changes, no cost delta.

## CI/CD

None. Existing `ci`, `migrate-db`, `deploy-app-stack`, `smoke` cover this PR. No Dockerfile changes.

## Documentation

- `progress.md` — new entry on merge.
- `docs/system-design.md` — extend the route list section. No topology change.
- `docs/endpoints.md` — add all new routes (`/api/orgs/*`, `/api/invitations/*`).
- `.claude/memory/project_overview.md` — revise two lines:
  - "Sign-up creates a personal organisation by default" → "Sign-up does not auto-create an org. Forks pick standard signup (`/api/auth/sign-up/email`) or team signup (`/api/orgs/sign-up`, composite)."
  - "A user's active org is part of session state" → "Active org is whatever's in the URL. No server-side active-org concept; SPA queries `Membership` for the list and routes accordingly."
- `.claude/skills/database/SKILL.md` — extend with Organisation/Membership/Invitation conventions: prefix registry (`org_`, `memb_`, `inv_`), cascade-on-org-delete, the partial-unique-index pattern for outstanding-invite-per-email, the "store hash never raw" rule for invite tokens.
- `.claude/skills/auth/SKILL.md` — note the team-signup composite pattern (`auth.api.signUpEmail` inside our own transaction for user + org + membership atomicity); document role helpers location.

No new runbook (no manual ops introduced).

## Out of scope (deferred — explicit follow-ups)

- **Soft-delete on Organisation** (30-day restore window) — its own ticket alongside the org-delete UI.
- **DB-level invariant** — a user with `staffRole != null` cannot be in any membership. Postgres `CHECK` constraint plus service-layer assertion. Own ticket.
- **`assertCan(membership, action)` / `packages/auth` extraction** — happens at the second consumer (worker). Today the role checks live as small helpers in `modules/organisations/permissions.ts`.
- **Stripe customer creation on org create + per-org subscription** — own billing ticket.
- **Email transport for invitations** (SES + react-email + `InvitationEmail` template) — own ticket. API shape today is forward-compatible (a worker consuming `invitation.created` from the event stream renders the email).
- **`apps/internal` org admin UI** (browse orgs, view memberships, comp grants) — own ticket; this PR is API-only.
- **`apps/web` SPA** (org settings, member management) — `apps/web` doesn't exist yet.
- **Bulk invite / CSV import.**
- **Per-invite custom expiry** (`?ttl=`) — single 7-day default for now.
- **Pretty slugs in URLs** — additive migration later (column + reserved-word checks + rename endpoint).
- **`User.lastVisitedOrganisationId`** — only if cross-device sticky-org becomes a real ask.
