import { prisma } from '@template/db'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '@/app.js'
import {
  installStripeStub,
  signStripePayload,
  uninstallStripeStub
} from '../helpers/stripe-stub.js'

const ORIGIN = 'http://localhost:3000'

const uniqueEmail = (label: string) => `${label}-${crypto.randomUUID()}@example.com`

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

  const body = (await res.json()) as { organisation: { entityId: string } }

  return { orgId: body.organisation.entityId }
}

const subscriptionPayload = (
  orgId: string,
  overrides: Partial<{
    id: string
    status: string
    customer: string
    cancelAtPeriodEnd: boolean
    canceledAt: number | null
  }> = {}
) => ({
  id: overrides.id ?? `sub_test_${crypto.randomUUID()}`,
  object: 'subscription',
  customer: overrides.customer ?? `cus_test_${crypto.randomUUID()}`,
  status: overrides.status ?? 'active',
  cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
  canceled_at: overrides.canceledAt ?? null,
  metadata: { organisationId: orgId },
  items: {
    data: [
      {
        price: { id: 'price_test_pro', product: 'prod_test_pro' },
        current_period_start: 1700000000,
        current_period_end: 1702592000
      }
    ]
  }
})

const wrapEvent = (
  type: string,
  data: Record<string, unknown>,
  overrides: Partial<{ id: string }> = {}
) => ({
  id: overrides.id ?? `evt_test_${crypto.randomUUID()}`,
  object: 'event',
  type,
  data: { object: data }
})

const postWebhook = (
  app: ReturnType<typeof createApp>,
  event: Record<string, unknown>,
  options: { signature?: string } = {}
) => {
  const payload = JSON.stringify(event)
  const signature = options.signature ?? signStripePayload(payload)

  return app.request('/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature
    },
    body: payload
  })
}

beforeEach(() => {
  installStripeStub()
})

afterEach(() => {
  uninstallStripeStub()
})

// No global deleteMany — vitest runs files in parallel and wiping
// subscription / stripe_event mid-flight races with other tests'
// freshly-seeded rows. Each test uses unique orgIds (via signUp) and
// unique stripeSubscriptionId / event id values to avoid collisions.
afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/webhooks/stripe — signature verification', () => {
  it('returns 401 when the stripe-signature header is missing', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const res = await app.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })

    expect(res.status).toBe(401)
  })

  it('returns 401 when the signature does not verify', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const res = await postWebhook(app, wrapEvent('customer.subscription.created', {}), {
      signature: 't=1700000000,v1=deadbeef'
    })

    expect(res.status).toBe(401)
  })
})

describe('POST /api/webhooks/stripe — event handlers', () => {
  it('customer.subscription.created — UPSERTs a subscription row', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { orgId } = await signUp(app, uniqueEmail('webhook-sub-created'))
    const subId = `sub_test_${crypto.randomUUID()}`

    const event = wrapEvent(
      'customer.subscription.created',
      subscriptionPayload(orgId, { id: subId })
    )

    const res = await postWebhook(app, event)

    expect(res.status).toBe(200)

    const row = await prisma.subscription.findUniqueOrThrow({
      where: { organisationId: orgId }
    })

    expect(row.stripeSubscriptionId).toBe(subId)
    expect(row.status).toBe('active')
    expect(row.planKey).toBe('pro')
    expect(row.cancelAtPeriodEnd).toBe(false)
  })

  it('customer.subscription.updated — updates the existing row in place', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { orgId } = await signUp(app, uniqueEmail('webhook-sub-updated'))
    const subUpdateId = `sub_test_${crypto.randomUUID()}`

    await postWebhook(
      app,
      wrapEvent('customer.subscription.created', subscriptionPayload(orgId, { id: subUpdateId }))
    )

    const before = await prisma.subscription.findUniqueOrThrow({
      where: { organisationId: orgId }
    })

    const updated = await postWebhook(
      app,
      wrapEvent(
        'customer.subscription.updated',
        subscriptionPayload(orgId, {
          id: subUpdateId,
          status: 'past_due',
          cancelAtPeriodEnd: true
        })
      )
    )

    expect(updated.status).toBe(200)

    const after = await prisma.subscription.findUniqueOrThrow({
      where: { organisationId: orgId }
    })

    expect(after.entityId).toBe(before.entityId)
    expect(after.status).toBe('past_due')
    expect(after.cancelAtPeriodEnd).toBe(true)
  })

  it('customer.subscription.deleted — marks the subscription canceled', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { orgId } = await signUp(app, uniqueEmail('webhook-sub-deleted'))
    const subDeleteId = `sub_test_${crypto.randomUUID()}`

    await postWebhook(
      app,
      wrapEvent('customer.subscription.created', subscriptionPayload(orgId, { id: subDeleteId }))
    )

    const canceledAt = 1700100000
    const res = await postWebhook(
      app,
      wrapEvent(
        'customer.subscription.deleted',
        subscriptionPayload(orgId, {
          id: subDeleteId,
          status: 'canceled',
          canceledAt
        })
      )
    )

    expect(res.status).toBe(200)

    const row = await prisma.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: subDeleteId }
    })

    expect(row.status).toBe('canceled')
    expect(row.canceledAt?.getTime()).toBe(canceledAt * 1000)
  })

  it('checkout.session.completed — links the org to the Stripe customer id', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { orgId } = await signUp(app, uniqueEmail('webhook-checkout-completed'))

    const customerId = `cus_test_${crypto.randomUUID()}`
    const event = wrapEvent('checkout.session.completed', {
      id: `cs_test_${crypto.randomUUID()}`,
      object: 'checkout.session',
      client_reference_id: orgId,
      customer: customerId,
      metadata: { organisationId: orgId }
    })

    const res = await postWebhook(app, event)

    expect(res.status).toBe(200)

    const org = await prisma.organisation.findUniqueOrThrow({
      where: { entityId: orgId },
      select: { stripeCustomerId: true }
    })

    expect(org.stripeCustomerId).toBe(customerId)
  })

  it('replay — the same event.id twice is a no-op, response carries replay flag', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { orgId } = await signUp(app, uniqueEmail('webhook-replay'))
    const eventId = `evt_test_${crypto.randomUUID()}`

    const event = wrapEvent(
      'customer.subscription.created',
      subscriptionPayload(orgId, { id: `sub_test_${crypto.randomUUID()}` }),
      { id: eventId }
    )

    const first = await postWebhook(app, event)
    expect(first.status).toBe(200)

    const second = await postWebhook(app, event)
    expect(second.status).toBe(200)

    const body = (await second.json()) as { replay?: boolean }

    expect(body.replay).toBe(true)

    // The stripe_event row landed exactly once.
    const events = await prisma.stripeEvent.findMany({ where: { id: eventId } })

    expect(events).toHaveLength(1)
  })

  it('unknown event type — 200 + no-op, event still recorded in stripe_event', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const event = wrapEvent('invoice.payment_succeeded', { id: 'in_test_ignored' })

    const res = await postWebhook(app, event)

    expect(res.status).toBe(200)

    const row = await prisma.stripeEvent.findUnique({
      where: { id: event.id as string }
    })

    expect(row?.type).toBe('invoice.payment_succeeded')
  })
})
