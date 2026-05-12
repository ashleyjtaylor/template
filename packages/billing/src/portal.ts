import { getStripeClient } from './client.js'
import { env } from './env.js'

export interface CreatePortalSessionInput {
  customerId: string
  // Optional override; defaults to `STRIPE_PORTAL_RETURN_URL`. Used when
  // the SPA wants to send the user back to a specific page (e.g. the
  // org's Settings → Billing tab) rather than the global return url.
  returnUrl?: string
}

// Mints a self-service portal session. Customer Portal lets users change
// their card, view invoices, cancel — everything we'd otherwise have to
// build into apps/web. URL is single-use; expires after ~3 minutes.
export async function createPortalSession(
  input: CreatePortalSessionInput
): Promise<{ url: string }> {
  const stripe = getStripeClient()

  const session = await stripe.billingPortal.sessions.create({
    customer: input.customerId,
    return_url: input.returnUrl ?? env.STRIPE_PORTAL_RETURN_URL
  })

  return { url: session.url }
}
