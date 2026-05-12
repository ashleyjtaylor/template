import { prisma } from '@template/db'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createApp } from '@/app.js'
import { installStripeStub, uninstallStripeStub } from '../helpers/stripe-stub.js'

const ORIGIN = 'http://localhost:3000'

const uniqueEmail = (label: string) => `${label}-${crypto.randomUUID()}@example.com`

const cookieFrom = (res: Response) => res.headers.get('set-cookie') ?? ''

const signUp = async (app: ReturnType<typeof createApp>, email: string) => {
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

  return { cookie: cookieFrom(res), orgId: body.organisation.entityId, userId: body.user.id }
}

afterEach(() => {
  uninstallStripeStub()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/orgs/:orgId/billing/portal-session', () => {
  it('returns 401 without a session', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const res = await app.request('/api/orgs/org_x/billing/portal-session', { method: 'POST' })

    expect(res.status).toBe(401)
  })

  it("returns 404 when the caller isn't a member of the org", async () => {
    installStripeStub()
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie } = await signUp(app, uniqueEmail('portal-non-member'))

    const res = await app.request(`/api/orgs/org_${crypto.randomUUID()}/billing/portal-session`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN }
    })

    expect(res.status).toBe(404)
  })

  it('returns 403 when the caller is a member but not admin/owner', async () => {
    installStripeStub()
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { orgId } = await signUp(app, uniqueEmail('portal-owner'))

    const member = await signUp(app, uniqueEmail('portal-member'))
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: orgId,
        userId: member.userId,
        role: 'member'
      }
    })

    const res = await app.request(`/api/orgs/${orgId}/billing/portal-session`, {
      method: 'POST',
      headers: { Cookie: member.cookie, Origin: ORIGIN }
    })

    expect(res.status).toBe(403)
  })

  it('returns 409 NoStripeCustomer when the org has not subscribed yet', async () => {
    installStripeStub()
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie, orgId } = await signUp(app, uniqueEmail('portal-no-customer'))

    const res = await app.request(`/api/orgs/${orgId}/billing/portal-session`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    expect(res.status).toBe(409)

    const body = (await res.json()) as { details?: { reason?: string } }

    expect(body.details?.reason).toBe('NoStripeCustomer')
  })

  it('returns 200 with the stubbed portal URL on happy path; forwards customer + return URL', async () => {
    const record = installStripeStub({ portalUrl: 'https://billing.stripe.com/p/session/happy' })
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { cookie, orgId } = await signUp(app, uniqueEmail('portal-happy'))

    const customerId = `cus_test_${crypto.randomUUID()}`
    await prisma.organisation.update({
      where: { entityId: orgId },
      data: { stripeCustomerId: customerId }
    })

    const res = await app.request(`/api/orgs/${orgId}/billing/portal-session`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    expect(res.status).toBe(200)

    const body = (await res.json()) as { url: string }

    expect(body.url).toBe('https://billing.stripe.com/p/session/happy')
    expect(record.portalSessions).toHaveLength(1)

    const [params] = record.portalSessions

    expect(params?.customer).toBe(customerId)
    expect(params?.return_url).toContain(`/orgs/${encodeURIComponent(orgId)}/settings/billing`)
  })
})
