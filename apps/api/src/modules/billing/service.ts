import {
  createCheckoutSession as createStripeCheckout,
  createPortalSession as createStripePortal,
  getOrgAccessState
} from '@template/billing'
import { prisma } from '@template/db'
import { ConflictError, NotFoundError } from '@template/errors'
import { env } from '@/env.js'

const webBaseUrl = () => env.WEB_BASE_URL.replace(/\/$/, '')

interface CheckoutSessionParams {
  orgEntityId: string
  callerEmail: string
}

export async function buildCheckoutSession({ orgEntityId, callerEmail }: CheckoutSessionParams) {
  const organisation = await prisma.organisation.findUnique({
    where: { entityId: orgEntityId },
    select: { stripeCustomerId: true, subscription: { select: { status: true } } }
  })

  if (!organisation) throw new NotFoundError('Organisation not found')

  // Block double-subscribing — the Customer Portal is the right place
  // to change plans on an existing subscription. Without this gate, a
  // user can land a second active subscription on Stripe's side and
  // we'd UPSERT-over the first one, losing the prior id silently.
  if (
    organisation.subscription &&
    (organisation.subscription.status === 'active' ||
      organisation.subscription.status === 'trialing' ||
      organisation.subscription.status === 'past_due')
  ) {
    throw new ConflictError('Organisation already has an active subscription', {
      reason: 'AlreadySubscribed'
    })
  }

  const successUrl = `${webBaseUrl()}/onboarding/success?orgId=${encodeURIComponent(orgEntityId)}&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${webBaseUrl()}/onboarding/subscribe?orgId=${encodeURIComponent(orgEntityId)}`

  return createStripeCheckout({
    orgEntityId,
    customerId: organisation.stripeCustomerId ?? undefined,
    customerEmail: organisation.stripeCustomerId ? undefined : callerEmail,
    successUrl,
    cancelUrl
  })
}

export async function buildPortalSession(orgEntityId: string) {
  const organisation = await prisma.organisation.findUnique({
    where: { entityId: orgEntityId },
    select: { stripeCustomerId: true }
  })

  if (!organisation) throw new NotFoundError('Organisation not found')

  if (!organisation.stripeCustomerId) {
    throw new ConflictError('Organisation has not subscribed yet', { reason: 'NoStripeCustomer' })
  }

  return createStripePortal({
    customerId: organisation.stripeCustomerId,
    returnUrl: `${webBaseUrl()}/orgs/${encodeURIComponent(orgEntityId)}/settings/billing`
  })
}

export async function readAccessState(orgEntityId: string) {
  return getOrgAccessState(orgEntityId)
}
