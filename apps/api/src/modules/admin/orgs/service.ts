import { type Prisma, prisma } from '@template/db'

export interface OrgCursor {
  createdAt: Date
  entityId: string
}

// Admin org list. Returns one row per organisation with the bits staff
// actually look at: name, owner email (for "who is this?"), member
// count, and the current subscription's `status` + `planKey` so the row
// can render a billing-status badge without a second lookup.
export async function listAdminOrgs(
  cursor: OrgCursor | null,
  limit: number,
  search: string | undefined
) {
  const where: Prisma.OrganisationWhereInput = cursor
    ? {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, entityId: { lt: cursor.entityId } }
        ]
      }
    : {}

  if (search) where.name = { contains: search, mode: 'insensitive' }

  const orgs = await prisma.organisation.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { entityId: 'desc' }],
    take: limit + 1,
    select: {
      entityId: true,
      name: true,
      createdAt: true,
      stripeCustomerId: true,
      subscription: {
        select: { status: true, planKey: true, cancelAtPeriodEnd: true }
      },
      memberships: {
        select: { role: true, user: { select: { email: true } } }
      }
    }
  })

  return orgs.map((o) => {
    const owner = o.memberships.find((m) => m.role === 'owner')

    return {
      entityId: o.entityId,
      name: o.name,
      createdAt: o.createdAt,
      ownerEmail: owner?.user.email ?? null,
      memberCount: o.memberships.length,
      stripeCustomerId: o.stripeCustomerId,
      subscription: o.subscription
        ? {
            status: o.subscription.status,
            planKey: o.subscription.planKey,
            cancelAtPeriodEnd: o.subscription.cancelAtPeriodEnd
          }
        : null
    }
  })
}

// Admin billing detail. Returns the org + its single subscription row
// (if any) + the Stripe customer id, so the panel can render the
// summary card + "View in Stripe" deeplink in one fetch.
export async function getOrgBillingDetail(orgEntityId: string) {
  return prisma.organisation.findUnique({
    where: { entityId: orgEntityId },
    include: {
      subscription: true,
      memberships: {
        select: {
          role: true,
          createdAt: true,
          user: { select: { entityId: true, email: true, firstname: true, lastname: true } }
        },
        orderBy: { createdAt: 'asc' }
      }
    }
  })
}
