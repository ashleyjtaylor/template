import { prisma } from '@template/db'
import { NotFoundError } from '@template/errors'
import type { AuthSession } from '@/middleware/require-session.js'
import { buildCheckoutSession, buildPortalSession, readAccessState } from './service.js'

export const createCheckoutSessionController = async (
  orgEntityId: string,
  session: AuthSession
) => {
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

export const createPortalSessionController = async (orgEntityId: string) =>
  buildPortalSession(orgEntityId)

export const getAccessStateController = async (orgEntityId: string) => readAccessState(orgEntityId)
