import { getStripeClient } from './client.js'
import { env } from './env.js'

export interface CreateCheckoutSessionInput {
  // The org we're subscribing. Recorded as Checkout client_reference_id
  // so the webhook handler can match the session back to the org when
  // `checkout.session.completed` fires.
  orgEntityId: string
  // If the org has previously subscribed, we already know the Stripe
  // customer id and pass it through so Stripe attaches the new
  // subscription to the same customer rather than creating a duplicate.
  customerId: string | undefined
  // First-checkout fallback — Stripe creates the customer during the
  // session. We supply the user's email so their dashboard receipt and
  // future invoices have a recognisable address; the value is also
  // pre-filled on the Checkout page.
  customerEmail: string | undefined
  // URLs to bounce the user back to. The web SPA appends them.
  successUrl: string
  cancelUrl: string
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput
): Promise<{ url: string }> {
  const stripe = getStripeClient()

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: env.STRIPE_PRICE_ID_PRO, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.orgEntityId,
    // `customer` and `customer_email` are mutually exclusive — Stripe
    // 400s if both are sent. Prefer the existing customer if present.
    ...(input.customerId
      ? { customer: input.customerId }
      : input.customerEmail
        ? { customer_email: input.customerEmail }
        : {}),
    // Carry the org through to the eventual `subscription.metadata` so
    // the webhook handler can still resolve the org if Checkout fires
    // through some non-standard path (e.g. Customer Portal upgrade).
    subscription_data: {
      metadata: { organisationId: input.orgEntityId }
    },
    metadata: { organisationId: input.orgEntityId }
  })

  if (!session.url) {
    throw new Error('Stripe Checkout session returned without a URL')
  }

  return { url: session.url }
}
