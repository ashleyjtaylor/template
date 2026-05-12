// Stripe subscription status enum, narrowed to the values Stripe sends.
// Imported into `getOrgAccessState` + the `subscription` row reader.
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'

// What the org-level paywall logic resolves to.
//
// - `paid` — `active` or `trialing` subscription. App grants access.
// - `past_due` — Stripe Smart Retries running. Access still granted
//   (per design); UI banner is a follow-up ticket.
// - `paywalled` — no subscription, or one in a terminal/incomplete
//   state. SPA redirects to /onboarding/subscribe.
export type AccessState = 'paid' | 'past_due' | 'paywalled'

export interface AccessStateResult {
  state: AccessState
  subscription?: {
    planKey: string
    status: SubscriptionStatus
    currentPeriodEnd: string
    cancelAtPeriodEnd: boolean
  }
}

// Per-plan capabilities. Kept inline for the MVP; graduates to its own
// package when a second plan + meaningful entitlement variance ships.
export interface Entitlements {
  // Soft cap. Enforced lazily in seat-sync logic; the spine PR does not
  // enforce yet (deferred to the per-seat sync ticket).
  seats: number
  features: ReadonlySet<string>
}
