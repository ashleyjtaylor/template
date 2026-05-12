import { prisma } from '@template/db'
import type { AccessStateResult, SubscriptionStatus } from './types.js'

// Single resolver for org-level paywall logic. Reads the `subscription`
// mirror row (UPSERTed by the Stripe webhook handler) and maps Stripe's
// status enum to our three-state `AccessState`.
//
// `active` and `trialing` → paid. `past_due` keeps access while Stripe
// Smart Retries the card. Everything else (canceled / incomplete /
// unpaid) and "no row at all" → paywalled.
export async function getOrgAccessState(orgId: string): Promise<AccessStateResult> {
  const sub = await prisma.subscription.findUnique({
    where: { organisationId: orgId }
  })

  if (!sub) return { state: 'paywalled' }

  const status = sub.status as SubscriptionStatus
  const state =
    status === 'active' || status === 'trialing'
      ? 'paid'
      : status === 'past_due'
        ? 'past_due'
        : 'paywalled'

  if (state === 'paywalled') {
    return { state }
  }

  return {
    state,
    subscription: {
      planKey: sub.planKey,
      status,
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd
    }
  }
}
