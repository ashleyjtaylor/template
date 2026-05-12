# Billing smoke test (manual playbook)

End-to-end walkthrough for verifying the Stripe billing surface before merging anything that touches `apps/api`'s billing module, `packages/billing`, or the `apps/web` paywall / onboarding routes. Tests use mocked Stripe SDK in CI; this runbook covers the real-Stripe path that no automated suite hits.

The playbook assumes a freshly-checked-out branch with the local Compose services running. It does not interact with any deployed environment.

## Prerequisites

- A Stripe test-mode account. The dashboard's **Test mode** toggle (top-right) must be on for every step below.
- Stripe CLI installed (`brew install stripe/stripe-cli/stripe`, then `stripe login` once to authorise).
- Local Compose up: `docker compose up -d`. Mailpit, Postgres, Redis must all be healthy.

## One-time Stripe test-mode setup

1. **Test API key**. Stripe dashboard → Developers → API keys → copy the **Secret key** (`sk_test_…`).
2. **Pro product**. Products → **Add product**. Name `Pro`. Pricing model: recurring, monthly, $20 USD (any amount works — Stripe just needs a price object). Save. Copy the price's `price_…` id.
3. **Webhook signing secret**. In a dedicated terminal:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   The CLI prints `Your webhook signing secret is whsec_…` — copy it. Leave this terminal running for the duration of the smoke; it forwards every test-mode event Stripe fires to your local API.

## Local env

Populate `apps/api/.env` with the four Stripe vars (placeholders exist in `.env.example`):

```
WEB_BASE_URL=http://localhost:5174
STRIPE_API_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_ID_PRO=price_…
STRIPE_PORTAL_RETURN_URL=http://localhost:5174
```

Restart `apps/api`'s dev server so the new env loads.

## Smoke path

1. **Sign up via `/signup` in the web SPA.** The `user.create` hook creates a Personal org. Confirm by hitting `/`'s Organisations card — one row.
2. **Click into the org from Home.** `OrgPaywallGate` fires → access-state returns `paywalled` → SPA redirects to `/onboarding/subscribe?orgId=<id>`.
3. **Click "Subscribe to Pro".** `POST /api/orgs/:orgId/billing/checkout-session` returns a Stripe-hosted URL → SPA does `window.location = url`.
4. **Complete Checkout in the Stripe tab.** Test card: `4242 4242 4242 4242`, any future expiry, any CVC, any postcode. Submit.
5. **Stripe redirects to `/onboarding/success?orgId=…&session_id=…`.** The page polls `access-state` every 1s. Within ~1-2s the `stripe listen` terminal prints:
   ```
   checkout.session.completed   [200 OK]
   customer.subscription.created [200 OK]
   ```
   `access-state` flips to `paid` → SPA navigates to `/orgs/:orgId/settings/people`.
6. **Verify DB state.**
   ```bash
   docker exec template-postgres psql -U postgres -d template_dev -c \
     "SELECT status, plan_key, current_period_end FROM subscription;"
   docker exec template-postgres psql -U postgres -d template_dev -c \
     "SELECT entity_id, stripe_customer_id FROM organisation WHERE stripe_customer_id IS NOT NULL;"
   ```
   The subscription row has `status=active`, `plan_key=pro`. The org has a non-null `stripe_customer_id`.
7. **Visit `/orgs/:orgId/settings/billing`.** Subscription card shows status badge "ACTIVE", renewal date, and "Manage in Stripe" button.
8. **Click "Manage in Stripe".** `POST /api/orgs/:orgId/billing/portal-session` returns a Customer Portal URL. Stripe portal opens. Try "Cancel plan". Confirm.
9. **Return to the web SPA.** The `stripe listen` terminal prints `customer.subscription.updated`. Within ~1s, `/orgs/:orgId/settings/billing` shows `cancelAtPeriodEnd: true`.

## Idempotency check (replay)

```bash
# In a third terminal, replay the last event:
stripe events resend <event_id>      # event id printed in the `stripe listen` output
```

`stripe listen` prints `[200 OK]` again. The DB is unchanged (the second `customer.subscription.updated` is a no-op because `stripe_event` already has the id).

## Failure modes to test

- **Bad signature**: temporarily set `STRIPE_WEBHOOK_SECRET=whsec_wrong` in `apps/api/.env`, restart API, send another event from the dashboard. The API returns 401; the `stripe_event` table is unchanged; the `stripe listen` terminal prints `[401 Unauthorized]`.
- **Unconfigured fork**: blank `STRIPE_API_KEY` in `apps/api/.env`, restart. `POST /api/orgs/:orgId/billing/checkout-session` returns 500 with `code: 'InternalError'` and `details.reason: 'BillingNotConfigured'`. `GET /api/orgs/:orgId/billing/access-state` still returns 200 (reads local DB only).
- **Already subscribed**: trigger Checkout twice in a row for the same org. The second request returns 409 `AlreadySubscribed` from `buildCheckoutSession`'s pre-check.

## What this does NOT exercise

- Per-seat sync (separate ticket — `org.seat_count_changed` event + worker handler).
- Comp grants (separate ticket — `comp_grants` table + internal-app UI).
- Conversion nudges (separate ticket — BullMQ scheduled jobs).
- The internal-app's billing actions (refunds, cancel-override, invoice history — separate ticket).
- Production-deploy of `template-${env}-stripe-secrets` and the per-fork price-id context flag — that's the deploy-runbook concern, not this one.
