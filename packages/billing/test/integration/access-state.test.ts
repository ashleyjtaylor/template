import { prisma } from '@template/db'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getOrgAccessState } from '../../src/access-state.js'
import type { SubscriptionStatus } from '../../src/types.js'

const newOrg = async () =>
  prisma.organisation.create({
    data: { entityId: `org_${crypto.randomUUID()}`, name: 'Test Org' }
  })

const seedSubscription = (orgId: string, status: SubscriptionStatus) =>
  prisma.subscription.create({
    data: {
      entityId: `sub_${crypto.randomUUID()}`,
      organisationId: orgId,
      stripeSubscriptionId: `sub_test_${crypto.randomUUID()}`,
      stripeCustomerId: `cus_test_${crypto.randomUUID()}`,
      stripePriceId: 'price_test',
      planKey: 'pro',
      status,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false
    }
  })

beforeEach(async () => {
  // Test isolation — every case starts from an empty subscription
  // table. The org rows linger across tests but are scoped per-case via
  // unique entityIds.
  await prisma.subscription.deleteMany({})
})

afterAll(async () => {
  await prisma.subscription.deleteMany({})
  await prisma.$disconnect()
})

describe('getOrgAccessState', () => {
  it('returns paywalled when no subscription exists', async () => {
    const org = await newOrg()

    const result = await getOrgAccessState(org.entityId)

    expect(result.state).toBe('paywalled')
    expect(result.subscription).toBeUndefined()
  })

  it('returns paid for status=active and surfaces subscription details', async () => {
    const org = await newOrg()
    await seedSubscription(org.entityId, 'active')

    const result = await getOrgAccessState(org.entityId)

    expect(result.state).toBe('paid')
    expect(result.subscription?.planKey).toBe('pro')
    expect(result.subscription?.status).toBe('active')
    expect(result.subscription?.cancelAtPeriodEnd).toBe(false)
  })

  it('returns paid for status=trialing', async () => {
    const org = await newOrg()
    await seedSubscription(org.entityId, 'trialing')

    expect((await getOrgAccessState(org.entityId)).state).toBe('paid')
  })

  it('returns past_due — access granted while Stripe Smart Retries the card', async () => {
    const org = await newOrg()
    await seedSubscription(org.entityId, 'past_due')

    const result = await getOrgAccessState(org.entityId)

    expect(result.state).toBe('past_due')
    expect(result.subscription?.status).toBe('past_due')
  })

  it.each([
    'canceled',
    'incomplete',
    'incomplete_expired',
    'unpaid'
  ] satisfies SubscriptionStatus[])('returns paywalled for status=%s', async (status) => {
    const org = await newOrg()
    await seedSubscription(org.entityId, status)

    const result = await getOrgAccessState(org.entityId)

    expect(result.state).toBe('paywalled')
    expect(result.subscription).toBeUndefined()
  })
})
