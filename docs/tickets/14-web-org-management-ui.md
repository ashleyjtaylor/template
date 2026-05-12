# 14 — Web org management UI (members + invitations)

## Goal

Build the `apps/web` UI for org owners and admins to manage their team: list members, change roles, remove members, leave the org, transfer ownership, send / list / revoke invitations. Every backend route is already built and tested in ticket 10 (organisations foundation) + ticket 11 (web foundation) + ticket 13 (invitation email). This ticket is purely the SPA surface plus a UserMenu entry point.

## Acceptance criteria

- A signed-in user with at least one org sees a "Settings" item in the UserMenu dropdown. Clicking it lands on `/orgs/<first-orgId>/settings/people`.
- The People page renders two stacked sections: **Members** (list of `{ membership, user }` rows) and **Invitations** (form + list of pending invitations).
- Members section:
  - Inline role-change via row action menu (owners see member / admin / owner; admins see member / admin; promoting to `owner` is the transfer-ownership flow). Selecting a new role calls `PATCH /api/orgs/:orgId/members/:userEntityId` and toasts on success.
  - Remove / Leave / Promote-to-owner each open a **confirm modal** before firing the corresponding API call. Caller's own row shows "Leave" instead of "Remove".
- Invitations section:
  - Form at the top: single email input + role dropdown (member / admin) + Send. On success the form clears and the new row appears in the pending list (cache invalidation).
  - Each pending row shows email, role, invited-by (name), expires, and a Revoke button that opens a confirm modal.
- Specific API errors render with helpful messages:
  - `400` validation → inline under the email field ("Enter a valid email").
  - `409 OutstandingInvitationExists` → inline under the email field ("An invitation for this email is already pending").
  - `409 LastOwnerRequired` → toast ("Promote another owner before leaving / demoting").
  - `403 InsufficientRole` on a mutation → toast ("You do not have permission to do this") — the route load itself returns full-page 403 for non-members.
- Page-level states: `401` (handled by the existing `AuthGate` → redirect to `/login`), `403` non-member full-page block, `404` org-not-found full-page block, loading skeletons while queries resolve, generic toast on unexpected 5xx.
- `pnpm lint && pnpm typecheck && pnpm build` are green. No new tests this PR (manual smoke verifies the flow end-to-end).

## Data model

No schema changes. All required tables (`Membership`, `Invitation`, `User`, `Organisation`) shipped in ticket 10.

## API design

No new routes. The full surface this UI consumes already exists:

- `GET /api/orgs` (list user's orgs — used to resolve the first-org redirect from the UserMenu)
- `GET /api/orgs/:orgId/members` → `[{ membership, user: { entityId, email, firstname, lastname } }]`
- `PATCH /api/orgs/:orgId/members/:userEntityId` (owner-only; payload `{ role }`)
- `DELETE /api/orgs/:orgId/members/:userEntityId` (admin / owner; rules enforced server-side)
- `POST /api/orgs/:orgId/leave`
- `POST /api/orgs/:orgId/transfer-ownership` (owner-only; payload `{ newOwnerUserId }`)
- `GET /api/orgs/:orgId/invitations`
- `POST /api/orgs/:orgId/invitations` (admin / owner; payload `{ email, role }`)
- `DELETE /api/orgs/:orgId/invitations/:invitationId`

## Web app changes

New file route `apps/web/src/routes/orgs.$orgId.settings.people.tsx` → `/orgs/:orgId/settings/people`. The dotted segments match TanStack file-based routing conventions for parameterised + nested paths.

New module `apps/web/src/modules/org-management/`:

```
modules/org-management/
  api.ts        # TanStack Query hooks (queries + mutations + invalidation)
  schemas.ts    # Zod schemas for response shapes + parse helpers
  utils.ts      # role label + relative-date formatters (if not already in another shared util)
  components/
    MembersSection.tsx
    MemberRow.tsx
    RoleMenu.tsx
    LeaveDialog.tsx
    RemoveMemberDialog.tsx
    TransferOwnershipDialog.tsx
    InvitationsSection.tsx
    InviteForm.tsx
    InvitationRow.tsx
    RevokeInvitationDialog.tsx
```

Hooks exported from `api.ts`:

- `useMembers(orgId)` — `GET /api/orgs/:orgId/members`
- `useInvitations(orgId, status: 'pending')`
- `useCreateInvitation(orgId)` — mutation, invalidates the invitations list
- `useRevokeInvitation(orgId)` — mutation, invalidates the invitations list
- `useChangeRole(orgId)` — mutation, invalidates the members list
- `useRemoveMember(orgId)` — mutation, invalidates the members list
- `useLeaveOrg(orgId)` — mutation, on success navigates to `/` and invalidates `useSession` + `GET /api/orgs`
- `useTransferOwnership(orgId)` — mutation, invalidates the members list

UserMenu addition: `apps/web/src/components/layout/UserMenu.tsx` gains a "Settings" item above "Sign out". Click handler reads the cached `GET /api/orgs` data (a query the session module already prefetches at app boot; if not, add a sibling `useMyOrgs` hook and prefetch it from `__root.tsx` after auth resolves) and navigates to `/orgs/<orgs[0].organisation.entityId>/settings/people`.

## Error handling

| Error | Source | UI surface |
|---|---|---|
| 400 ValidationError (`/invitations` POST) | invite form | Inline under the email field |
| 401 anywhere | any | `AuthGate` redirects to `/login` (existing behaviour) |
| 403 InsufficientRole on route load | `useMembers` / `useInvitations` | Full-page "Not authorised" block |
| 403 on a row mutation | mutations | Toast "You do not have permission to do this" |
| 404 (`orgId` user is not a member of) | route load | Full-page "Organisation not found" block |
| 409 OutstandingInvitationExists | `useCreateInvitation` | Inline under the email field |
| 409 LastOwnerRequired | role change / remove / leave | Toast with the specific message; confirm modal closes |
| 5xx / network | any | Toast "Something went wrong"; queries auto-retry per the global TanStack Query defaults |

## Integration points

None new. The `invitation.created` BullMQ event already wired in ticket 13 will fire on `POST /api/orgs/:orgId/invitations` — the worker renders + sends the email via Mailpit (local) or SES (deployed). The UI does not need to know any of that; it only consumes the new HTTP 201.

## Testing plan

No new test files this PR. Rationale: every endpoint this UI consumes is exercised by `apps/api/test/integration/org-invitations.test.ts` and `apps/api/test/integration/organisations.test.ts` — happy path + each error class is already locked in. The SPA layer is query-and-render; the highest-value test coverage for it is end-to-end (browser drives the SPA against the live API), which is a meaningful infra investment (Playwright + CI job) better justified across multiple SPAs than in this single ticket.

**Manual smoke checklist** before merging:

1. Sign up user A; create an org `Test Co`; observe the People page renders with one row (A).
2. Sign up user B in a separate browser; sign back in as A; invite B (`member`). Toast confirms, row appears in pending list, email lands in Mailpit at `http://localhost:8025`.
3. Click the Mailpit link as B; complete `/accept-invite`; observe B becomes a member.
4. As A, change B's role to `admin` via the inline menu; toast confirms; refresh — role persists.
5. As A, try to demote yourself to `admin` (only-owner case) — confirm modal triggers, API returns 409, toast surfaces the message.
6. Sign up user C, invite as `member`, then transfer ownership to C. A becomes admin; C is owner.
7. Sign in as A, leave the org via the dialog. Page navigates to `/`. Re-list orgs — `Test Co` no longer appears for A.
8. Sign in as C, send an invite to a malformed email (`not-an-email`). Form shows inline 400. Send to B's existing email (already a member) — 409 surfaces inline.
9. Send a valid invite, then immediately revoke it. Pending list updates without reload.

## System design / infrastructure

No changes. UI-only ticket.

## CI / CD

No changes. Existing `build-web-app` job catches build regressions on PR.

## Out of scope (deferred to later tickets)

- Org switcher in the sidebar / UserMenu (multi-org users currently always see their first org's settings page).
- Creating additional orgs from inside the app, renaming the current org, deleting an org.
- Future settings sub-pages (`/settings/billing`, `/settings/branding`, `/settings/integrations`) — the `/settings/...` parent path earns its keep once these arrive.
- UI component tests (React Testing Library) and E2E tests (Playwright) — deferred until a second SPA shares the harness.
- Staff invitation UI in `apps/internal` — separate feature with its own data model (no `staff_invitations` table exists yet).
