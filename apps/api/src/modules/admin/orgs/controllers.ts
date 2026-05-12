import { NotFoundError } from '@template/errors'
import { decodeCursor, encodeCursor, type ListQuery } from './schemas.js'
import { getOrgBillingDetail, listAdminOrgs } from './service.js'

export async function listAdminOrgsController(query: ListQuery) {
  const cursorParsed = query.cursor ? decodeCursor(query.cursor) : null
  const fetched = await listAdminOrgs(cursorParsed, query.limit, query.search)

  const hasMore = fetched.length > query.limit
  const trimmed = hasMore ? fetched.slice(0, query.limit) : fetched

  const last = trimmed[trimmed.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.entityId) : null

  return {
    rows: trimmed.map((o) => ({
      entityId: o.entityId,
      name: o.name,
      createdAt: o.createdAt.toISOString(),
      ownerEmail: o.ownerEmail,
      memberCount: o.memberCount,
      stripeCustomerId: o.stripeCustomerId,
      subscription: o.subscription
    })),
    nextCursor
  }
}

export async function getOrgBillingDetailController(orgEntityId: string) {
  const org = await getOrgBillingDetail(orgEntityId)

  if (!org) throw new NotFoundError('Organisation not found')

  return {
    organisation: {
      entityId: org.entityId,
      name: org.name,
      createdAt: org.createdAt.toISOString(),
      stripeCustomerId: org.stripeCustomerId
    },
    subscription: org.subscription
      ? {
          entityId: org.subscription.entityId,
          stripeSubscriptionId: org.subscription.stripeSubscriptionId,
          stripeCustomerId: org.subscription.stripeCustomerId,
          stripePriceId: org.subscription.stripePriceId,
          planKey: org.subscription.planKey,
          status: org.subscription.status,
          currentPeriodStart: org.subscription.currentPeriodStart.toISOString(),
          currentPeriodEnd: org.subscription.currentPeriodEnd.toISOString(),
          cancelAtPeriodEnd: org.subscription.cancelAtPeriodEnd,
          canceledAt: org.subscription.canceledAt?.toISOString() ?? null,
          createdAt: org.subscription.createdAt.toISOString(),
          updatedAt: org.subscription.updatedAt.toISOString()
        }
      : null,
    members: org.memberships.map((m) => ({
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
      user: {
        entityId: m.user.entityId,
        email: m.user.email,
        firstname: m.user.firstname,
        lastname: m.user.lastname
      }
    }))
  }
}
