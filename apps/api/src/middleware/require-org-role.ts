import type { Membership } from '@prisma/client'
import { ForbiddenError, NotFoundError } from '@template/errors'
import { createMiddleware } from 'hono/factory'
import { type AuthSession, getAuthSession } from '@/middleware/require-session.js'
import type { Role } from '@/modules/organisations/schemas.js'
import { getMembership } from '@/modules/organisations/service.js'

export interface OrgVariables {
  authSession: AuthSession
  orgMembership: Membership
}

// 404 collapses "org doesn't exist" with "caller isn't a member" so non-members
// can't enumerate orgs. 403 only fires after we've confirmed membership.
const loadMembership = async (orgId: string, userId: string): Promise<Membership> => {
  const membership = await getMembership(orgId, userId)

  if (!membership) throw new NotFoundError('Organisation not found')

  return membership
}

const requireRole = (allowed: readonly Role[]) =>
  createMiddleware<{ Variables: OrgVariables }>(async (c, next) => {
    const session = await getAuthSession(c.req.raw.headers)
    const orgId = c.req.param('orgId')

    if (!orgId) throw new NotFoundError('Organisation not found')

    const membership = await loadMembership(orgId, session.userId)

    if (!(allowed as readonly string[]).includes(membership.role)) {
      throw new ForbiddenError('Insufficient role', { reason: 'InsufficientRole' })
    }

    c.set('authSession', session)
    c.set('orgMembership', membership)

    await next()
  })

export const requireMember = requireRole(['owner', 'admin', 'member'])
export const requireAdmin = requireRole(['owner', 'admin'])
export const requireOwner = requireRole(['owner'])
