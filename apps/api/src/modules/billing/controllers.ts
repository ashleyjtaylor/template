import { isBillingConfigured } from '@template/billing'
import { prisma } from '@template/db'
import { InternalError, NotFoundError } from '@template/errors'
import type { AuthSession } from '@/middleware/require-session.js'
import { buildCheckoutSession, buildPortalSession, readAccessState } from './service.js'

// Forks that haven't wired Stripe yet get a clear "billing not
// configured" 503 from Checkout / Portal routes — better than a cryptic
// 500 from Stripe rejecting an empty API key. `access-state` deliberately
// skips this guard because the resolver only reads our own DB.
const requireBillingConfigured = () => {
  if (!isBillingConfigured()) {
    throw new InternalError('Billing is not configured for this environment', {
      reason: 'BillingNotConfigured'
    })
  }
}

export const createCheckoutSessionController = async (
  orgEntityId: string,
  session: AuthSession
) => {
  requireBillingConfigured()

  // Caller's email seeds Stripe Checkout when the org has no
  // `stripeCustomerId` yet (first subscription). better-auth doesn't
  // expose the email on the auth session shape, so fetch it from the
  // user row.
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true }
  })

  if (!user) throw new NotFoundError('User not found')

  return buildCheckoutSession({ orgEntityId, callerEmail: user.email })
}

export const createPortalSessionController = async (orgEntityId: string) => {
  requireBillingConfigured()

  return buildPortalSession(orgEntityId)
}

export const getAccessStateController = async (orgEntityId: string) => readAccessState(orgEntityId)
