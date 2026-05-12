# 15 — Stripe billing foundation (Checkout → paywall → access)

## Goal

A signed-in user can pay for their organisation via Stripe Checkout, and access to org-scoped surfaces in `apps/web` is gated by an active subscription. Establishes the spine — Customer creation, Checkout session minting, webhook ingestion, paywall route guard, Customer Portal entry point — without seat sync, comp grants, conversion nudges, multi-plan pricing UI, or any internal-app billing actions. Each of those is a separate, well-scoped follow-up ticket.

## Product flow

```
sign up                              create user + personal org (one txn, owner role)
  ↓
auto-redirect to /                   Home shows OrganisationsCard with one entry
  ↓
click into org                       /orgs/:orgId/* → OrgPaywallGate fires
  ↓
paywalled                            redirect to /onboarding/subscribe?orgId=<id>
  ↓
click Subscribe                      POST /api/orgs/:orgId/billing/checkout-session
                                     → window.location = stripe-hosted URL
  ↓
Stripe Checkout completes            redirect to /onboarding/success?orgId=...&session_id=...
  ↓
success page polls access-state      webhook lands → subscription row → state flips to paid
  ↓
navigate to /orgs/:orgId/...         OrgPaywallGate now allows; user is in
```

Self-service: a new Settings → Billing tab in `/orgs/:orgId/settings/billing` shows the current subscription summary plus a "Manage in Stripe" button → mints a Customer Portal session → Stripe handles change-card / cancel / view-invoices.

## Acceptance criteria

- A solo `/signup` lands a user with a Personal organisation (`"${firstname}'s workspace"`) atomically — no orphan users.
- A user clicking into a paywalled org is redirected to `/onboarding/subscribe?orgId=...`. Clicking Subscribe sends them to Stripe Checkout (test mode locally).
- Completing Checkout test-mode lands them on `/onboarding/success`, which polls and then routes them into the org once the `customer.subscription.created` webhook arrives.
- `GET /api/orgs/:orgId/billing/access-state` returns `paid` for an active subscription, `past_due` for a Stripe-Smart-Retries-running subscription, `paywalled` otherwise. `past_due` still grants access (no MVP banner).
- Re-firing the same `customer.subscription.created` webhook is a no-op — exactly one `subscription` row exists.
- The `/orgs/:orgId/settings/billing` tab shows status and an active "Manage in Stripe" button for admins/owners; the button mints a Portal session and redirects there.
- `pnpm exec biome ci && pnpm typecheck --force && pnpm build && pnpm test` are all green.

## Personal-org bootstrap (prerequisite)

Solo signup at `/signup` (better-auth's `/api/auth/sign-up/email`) currently creates only a user row. Extend it via a `user.create.after` databaseHook so the same write also lands:

- An `Organisation` named `"${firstname}'s workspace"` (entityId `org_…`, requestId carried through the AsyncLocalStorage context).
- A `Membership` row linking the new user as `owner`.

All inside one Prisma transaction. The existing `/team-signup` flow (POST `/api/orgs/sign-up`) already creates `{ user, organisation, membership }` atomically and is unchanged.

One-off backfill: any existing user without a membership gets a personal org created in the migration's accompanying data step. Today in the dev DB that's `staff@test.com`.

## Data model

### `Organisation` — one new column

- `stripeCustomerId String? @unique` — populated on `checkout.session.completed` (Stripe creates the customer during Checkout, we don't pre-create).

### `Subscription` — new model

```
entityId             String   @id              // sub_<uuid>
organisationId       String   @unique          // FK → Organisation, ON DELETE CASCADE
stripeSubscriptionId String   @unique
stripeCustomerId     String                    // denormalised, indexed
stripePriceId        String
planKey              String                    // 'pro' for MVP
status               String                    // Stripe values: active|trialing|past_due|canceled|incomplete|incomplete_expired|unpaid
currentPeriodStart   DateTime
currentPeriodEnd     DateTime
cancelAtPeriodEnd    Boolean  @default(false)
canceledAt           DateTime?
createdAt            DateTime @default(now())
updatedAt            DateTime @updatedAt
requestId            String?
```

One row per org. UPSERT pattern: `customer.subscription.*` events update the existing row in place. Re-subscribing after cancel rotates `stripeSubscriptionId` on the same row. Indexed on `status` for "find all paid orgs" diagnostic queries.

### `StripeEvent` — new model (idempotency anchor)

```
id           String   @id            // Stripe's event id, e.g. evt_…
type         String                  // e.g. customer.subscription.updated
processedAt  DateTime @default(now())
```

Webhook handler inserts before processing; uniqueness on `id` short-circuits replays. Indexed on `(type, processedAt desc)`. Payload deliberately not stored — Stripe's dashboard is the authoritative archive; storing it just bloats rows.

## API design

| Method | Path | Auth | Body / Returns |
|---|---|---|---|
| `POST` | `/api/orgs/:orgId/billing/checkout-session` | session + org-admin or owner | Body `{}`. Returns `{ url }`. SPA does `window.location = url`. |
| `POST` | `/api/orgs/:orgId/billing/portal-session` | session + org-admin or owner | Body `{}`. Returns `{ url }`. |
| `GET` | `/api/orgs/:orgId/billing/access-state` | session + org-member | Returns `{ state: 'paid' \| 'past_due' \| 'paywalled', subscription?: { planKey, status, currentPeriodEnd, cancelAtPeriodEnd } }`. |
| `POST` | `/api/webhooks/stripe` | none (raw-body signature via `STRIPE_WEBHOOK_SECRET`) | Returns `{ received: true }` on success. 401 on bad signature. Idempotent via `stripe_event.id`. |

### Events handled (MVP)

- `customer.subscription.created` — UPSERT `subscription` row.
- `customer.subscription.updated` — same path.
- `customer.subscription.deleted` — set `status='canceled'`, `canceledAt = now()`.
- `checkout.session.completed` — set `organisation.stripeCustomerId` if not yet set.
- Anything else: respond 200, no-op. Logged at debug.

## Packages

### New: `packages/billing`

```
src/
  index.ts                   // exports
  env.ts                     // STRIPE_* env validation
  client.ts                  // getStripeClient() singleton
  access-state.ts            // getOrgAccessState(orgId) → 'paid' | 'past_due' | 'paywalled'
  checkout.ts                // createCheckoutSession({ orgId, planKey })
  portal.ts                  // createPortalSession({ customerId, returnUrl })
  entitlements.ts            // entitlementsForPlan(planKey) — single Pro entry
  types.ts
```

The only place outside `apps/api/src/modules/webhooks` that imports `stripe`. Consumed today by the api; future seat sync (worker) + internal billing actions (api/internal) sit on the same surface.

## Web app changes

- `apps/web/src/routes/onboarding.subscribe.tsx` — Pro plan card, Subscribe button. Reads `orgId` from search.
- `apps/web/src/routes/onboarding.success.tsx` — polls `access-state`, then navigates.
- `apps/web/src/routes/orgs.$orgId.tsx` — new parent route mounting `OrgPaywallGate`; existing People page becomes its child.
- `apps/web/src/routes/orgs.$orgId.settings.billing.tsx` — Billing tab; subscription summary + "Manage in Stripe" button.
- `apps/web/src/components/OrgPaywallGate.tsx` — reads access-state for the URL's `:orgId`, renders children when paid/past_due, redirects to onboarding when paywalled.
- `apps/web/src/modules/billing/` — `api.ts` (TanStack Query hooks: `useAccessState`, `useCreateCheckoutSession`, `useCreatePortalSession`), `schemas.ts`.

## Error handling

| Error | Source | Surface |
|---|---|---|
| 401 (no session) | any | AuthGate → /login (existing) |
| 403 (admin/owner required) | checkout-session, portal-session | toast: "Only admins and owners can manage billing." |
| 404 (org not found / non-member) | all org-scoped | full-page block (existing pattern from People page) |
| 502 Bad Gateway (Stripe unreachable) | checkout-session, portal-session | toast: "Could not reach Stripe. Try again." Logged at error. |
| Webhook signature mismatch | /api/webhooks/stripe | 401, logged at error. Handler never runs. |
| Webhook handler exception | /api/webhooks/stripe | 500, logged at error. Stripe retries (built-in exponential backoff). |
| Checkout success race | /onboarding/success | poll 1s × 10s; fall back to "still processing" panel with a manual refresh button. |

## Infrastructure

- New CDK Secrets Manager entry `template-${env}-stripe-secrets` (sibling to `template-${env}-app-secrets`) with `apiKey` + `webhookSecret`.
- Injected on api + worker containers as `STRIPE_API_KEY` + `STRIPE_WEBHOOK_SECRET`.
- Non-secret env on api + worker: `STRIPE_PRICE_ID_PRO`, `STRIPE_PORTAL_RETURN_URL`.
- No ALB / CloudFront / security-group changes (CloudFront already forwards `/api/*` to ALB without caching).
- No new ECS service.

## Local dev

- `docs/runbooks/local-dev.md` gains a Stripe section: install Stripe CLI, `stripe login`, `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, populate `apps/api/.env` with `STRIPE_API_KEY=sk_test_…`, `STRIPE_WEBHOOK_SECRET=whsec_…`, `STRIPE_PRICE_ID_PRO=price_…`.
- `apps/api/.env.example` lists each var with a placeholder value.
- `docs/runbooks/billing-smoke.md` (new) — the manual playbook to run pre-merge.

## Testing plan

- **Unit (`packages/billing`)** — `getOrgAccessState` table-driven across each Stripe status × no-sub case → expected state; `entitlementsForPlan` lookup.
- **Integration (`apps/api`)** — all four routes, Stripe SDK mocked at the `getStripeClient()` boundary. Webhook tests sign canned payloads with the test secret. Cases per route: 401 / 403 / 404 / happy path; webhook adds idempotent replay + bad signature + each event type.
- **No new UI tests** this PR — same rationale as ticket 14.
- **Manual smoke** before merging: full Checkout flow in Stripe test mode via `stripe listen`. Documented in `docs/runbooks/billing-smoke.md`.

## CI/CD

- No new GitHub Actions jobs. The integration tests mock Stripe; CI does not need real Stripe credentials.
- Renovate tracks the `stripe` Node SDK like any other dep.

## Documentation updates landed in this PR

- `docs/tickets/15-stripe-billing-foundation.md` (this file, first commit on the branch).
- `docs/runbooks/local-dev.md` — Stripe local-dev section.
- `docs/runbooks/billing-smoke.md` — new manual-smoke playbook.
- `docs/endpoints.md` — `/api/orgs/:orgId/billing/*` rows + `/api/webhooks/stripe` row.
- `docs/system-design.md` — Stripe integration block, new Secrets Manager entry.
- `.claude/memory/project_overview.md` — flip "designed" notes to "deployed" where appropriate.

## Out of scope (deferred to later tickets)

- Per-seat sync via `org.seat_count_changed` outbox events.
- Comp grants (`comp_grants` table + internal-app comp UI).
- Conversion nudge schedules (1h / 24h / 3d).
- Internal-app billing actions: refunds, cancellation override, invoice history.
- Multi-plan pricing page.
- `past_due` UI banner.
- Tax / VAT beyond enabling Stripe Tax in the dashboard.
- `invoices` mirror table (only needed when internal-app invoice history surfaces).
