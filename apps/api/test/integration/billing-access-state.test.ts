import { prisma } from '@template/db'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app.js'

const ORIGIN = 'http://localhost:3000'

const uniqueEmail = (label: string) => `${label}-${crypto.randomUUID()}@example.com`

const cookieFrom = (res: Response) => res.headers.get('set-cookie') ?? ''

const signUp = async (
  app: ReturnType<typeof createApp>,
  email: string
): Promise<{ cookie: string; orgId: string }> => {
  const res = await app.request('/api/orgs/sign-up', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({
      email,
      password: 'abcd1234',
      firstname: 'Test',
      lastname: 'User'
    })
  })

  expect(res.status).toBe(200)

  const body = (await res.json()) as { organisation: { entityId: string } }

  return { cookie: cookieFrom(res), orgId: body.organisation.entityId }
}

const seedSubscription = (
  orgId: string,
  status: string,
  overrides: Partial<{ cancelAtPeriodEnd: boolean }> = {}
) =>
  prisma.subscription.create({
    data: {
      entityId: `sub_${crypto.randomUUID()}`,
      organisationId: orgId,
      stripeSubscriptionId: `sub_test_${crypto.randomUUID()}`,
      stripeCustomerId: `cus_test_${crypto.randomUUID()}`,
      stripePriceId: 'price_test_pro',
      planKey: 'pro',
      status,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false
    }
  })

// No global `deleteMany` between tests — each test creates a fresh org
// via signUp, so subscription rows have a unique organisationId per
// test. Wiping the table globally would race with parallel test files
// (vitest runs files in parallel) that seeded their own rows seconds
// earlier and not yet asserted.
afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/orgs/:orgId/billing/access-state', () => {
  it('returns 401 without a session', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const res = await app.request('/api/orgs/org_does_not_matter/billing/access-state')

    expect(res.status).toBe(401)
  })

  it("returns 404 when the caller isn't a member of the org", async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie } = await signUp(app, uniqueEmail('access-non-member'))

    // A separate org the caller doesn't belong to (created via signUp's
    // auto-create with a different user) is fine — but the simplest case
    // is just a non-existent orgId. 404 is what the API returns for both.
    const res = await app.request(`/api/orgs/org_${crypto.randomUUID()}/billing/access-state`, {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(404)
  })

  it('returns paywalled when no subscription row exists', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie, orgId } = await signUp(app, uniqueEmail('access-paywalled'))

    const res = await app.request(`/api/orgs/${orgId}/billing/access-state`, {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)

    const body = (await res.json()) as { state: string; subscription?: unknown }

    expect(body.state).toBe('paywalled')
    expect(body.subscription).toBeUndefined()
  })

  it('returns paid + subscription detail for an active subscription', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie, orgId } = await signUp(app, uniqueEmail('access-paid'))

    await seedSubscription(orgId, 'active', { cancelAtPeriodEnd: true })

    const res = await app.request(`/api/orgs/${orgId}/billing/access-state`, {
      headers: { Cookie: cookie }
    })

    const body = (await res.json()) as {
      state: string
      subscription: { planKey: string; status: string; cancelAtPeriodEnd: boolean }
    }

    expect(body.state).toBe('paid')
    expect(body.subscription.planKey).toBe('pro')
    expect(body.subscription.status).toBe('active')
    expect(body.subscription.cancelAtPeriodEnd).toBe(true)
  })

  it('returns paid for trialing', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie, orgId } = await signUp(app, uniqueEmail('access-trialing'))

    await seedSubscription(orgId, 'trialing')

    const res = await app.request(`/api/orgs/${orgId}/billing/access-state`, {
      headers: { Cookie: cookie }
    })

    const body = (await res.json()) as { state: string }

    expect(body.state).toBe('paid')
  })

  it('returns past_due — access still granted while Stripe Smart Retries the card', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie, orgId } = await signUp(app, uniqueEmail('access-past-due'))

    await seedSubscription(orgId, 'past_due')

    const res = await app.request(`/api/orgs/${orgId}/billing/access-state`, {
      headers: { Cookie: cookie }
    })

    const body = (await res.json()) as { state: string }

    expect(body.state).toBe('past_due')
  })

  it.each([
    'canceled',
    'incomplete',
    'incomplete_expired',
    'unpaid'
  ])('returns paywalled for status=%s', async (status) => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie, orgId } = await signUp(app, uniqueEmail(`access-${status}`))

    await seedSubscription(orgId, status)

    const res = await app.request(`/api/orgs/${orgId}/billing/access-state`, {
      headers: { Cookie: cookie }
    })

    const body = (await res.json()) as { state: string; subscription?: unknown }

    expect(body.state).toBe('paywalled')
    expect(body.subscription).toBeUndefined()
  })
})
