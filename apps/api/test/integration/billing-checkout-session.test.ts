import { prisma } from '@template/db'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createApp } from '@/app.js'
import { installStripeStub, uninstallStripeStub } from '../helpers/stripe-stub.js'

const ORIGIN = 'http://localhost:3000'

const uniqueEmail = (label: string) => `${label}-${crypto.randomUUID()}@example.com`

const cookieFrom = (res: Response) => res.headers.get('set-cookie') ?? ''

interface SignUpResult {
  cookie: string
  orgId: string
  email: string
  userId: string
}

const signUp = async (app: ReturnType<typeof createApp>, email: string): Promise<SignUpResult> => {
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

  const body = (await res.json()) as {
    organisation: { entityId: string }
    user: { id: string }
  }

  return { cookie: cookieFrom(res), orgId: body.organisation.entityId, email, userId: body.user.id }
}

afterEach(() => {
  uninstallStripeStub()
})

// No global deleteMany — vitest runs files in parallel and wiping
// subscription / stripe_event mid-flight races with other tests'
// freshly-seeded rows. Each test creates a unique org via signUp.
afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/orgs/:orgId/billing/checkout-session', () => {
  it('returns 401 without a session', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const res = await app.request('/api/orgs/org_x/billing/checkout-session', { method: 'POST' })

    expect(res.status).toBe(401)
  })

  it("returns 404 when the caller isn't a member of the org", async () => {
    installStripeStub()
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie } = await signUp(app, uniqueEmail('checkout-non-member'))

    const res = await app.request(`/api/orgs/org_${crypto.randomUUID()}/billing/checkout-session`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN }
    })

    expect(res.status).toBe(404)
  })

  it('returns 403 when the caller is a member but not admin/owner', async () => {
    installStripeStub()
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { orgId, userId } = await signUp(app, uniqueEmail('checkout-owner'))

    // Add a second user as a plain member of the same org and call from
    // their cookie.
    const member = await signUp(app, uniqueEmail('checkout-member'))
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: orgId,
        userId: member.userId,
        role: 'member'
      }
    })
    void userId

    const res = await app.request(`/api/orgs/${orgId}/billing/checkout-session`, {
      method: 'POST',
      headers: { Cookie: member.cookie, Origin: ORIGIN }
    })

    expect(res.status).toBe(403)
  })

  it('returns 200 with the stubbed checkout URL on happy path; forwards org id + caller email', async () => {
    const record = installStripeStub({ checkoutUrl: 'https://checkout.stripe.com/c/pay/happy' })
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie, orgId, email } = await signUp(app, uniqueEmail('checkout-happy'))

    const res = await app.request(`/api/orgs/${orgId}/billing/checkout-session`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    expect(res.status).toBe(200)

    const body = (await res.json()) as { url: string }

    expect(body.url).toBe('https://checkout.stripe.com/c/pay/happy')
    expect(record.checkoutSessions).toHaveLength(1)

    const [params] = record.checkoutSessions

    expect(params?.client_reference_id).toBe(orgId)
    expect(params?.customer_email).toBe(email)
    expect(params?.customer).toBeUndefined()
    expect(params?.line_items?.[0]?.price).toBe('price_test_pro')
    expect(params?.success_url).toContain(`orgId=${encodeURIComponent(orgId)}`)
  })

  it('passes `customer` instead of `customer_email` when the org already has a Stripe customer id', async () => {
    const record = installStripeStub()
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie, orgId } = await signUp(app, uniqueEmail('checkout-existing-customer'))

    const customerId = `cus_test_${crypto.randomUUID()}`
    await prisma.organisation.update({
      where: { entityId: orgId },
      data: { stripeCustomerId: customerId }
    })

    const res = await app.request(`/api/orgs/${orgId}/billing/checkout-session`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    expect(res.status).toBe(200)
    expect(record.checkoutSessions).toHaveLength(1)

    const [params] = record.checkoutSessions

    expect(params?.customer).toBe(customerId)
    expect(params?.customer_email).toBeUndefined()
  })

  it('returns 409 AlreadySubscribed when the org has an active subscription', async () => {
    installStripeStub()
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie, orgId } = await signUp(app, uniqueEmail('checkout-already-subscribed'))

    await prisma.subscription.create({
      data: {
        entityId: `sub_${crypto.randomUUID()}`,
        organisationId: orgId,
        stripeSubscriptionId: `sub_test_${crypto.randomUUID()}`,
        stripeCustomerId: `cus_test_${crypto.randomUUID()}`,
        stripePriceId: 'price_test_pro',
        planKey: 'pro',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false
      }
    })

    const res = await app.request(`/api/orgs/${orgId}/billing/checkout-session`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    expect(res.status).toBe(409)

    const body = (await res.json()) as { details?: { reason?: string } }

    expect(body.details?.reason).toBe('AlreadySubscribed')
  })
})
