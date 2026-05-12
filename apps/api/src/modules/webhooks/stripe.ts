import { billingEnv, getStripeClient } from '@template/billing'
import { prisma } from '@template/db'
import { Hono } from 'hono'
import type Stripe from 'stripe'
import { logger } from '@/lib/logger.js'

const log = logger.child({ module: 'webhooks/stripe' })

export const stripeWebhookRoutes = new Hono()

// Raw-body signature verification. `c.req.text()` returns the body as-is,
// which is what Stripe's `constructEvent` needs to verify the
// `Stripe-Signature` header. Don't .json() or you'll re-serialize the
// payload and break the HMAC.
//
// Idempotency via `stripe_event` insert. Stripe retries failed deliveries
// with exponential backoff, so the same event arrives multiple times in
// the wild. The unique-id insert short-circuits replays without us
// needing to think about ordering or partial commits.
stripeWebhookRoutes.post('/stripe', async (c) => {
  const signature = c.req.header('stripe-signature')

  if (!signature) {
    log.warn('webhook received with no signature header')

    return c.json({ error: 'Missing signature' }, 401)
  }

  const body = await c.req.text()
  const stripe = getStripeClient()

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, billingEnv.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'signature verification failed'
    )

    return c.json({ error: 'Invalid signature' }, 401)
  }

  // Idempotency anchor — `id` uniqueness short-circuits replays. Catch
  // the conflict and treat as no-op (200 so Stripe stops retrying).
  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } })
  } catch (err) {
    const code = (err as { code?: string }).code

    if (code === 'P2002') {
      log.debug({ eventId: event.id, type: event.type }, 'webhook replay ignored')

      return c.json({ received: true, replay: true })
    }

    throw err
  }

  try {
    await dispatchEvent(event)

    return c.json({ received: true })
  } catch (err) {
    // Roll back the idempotency row so Stripe's retry will be processed
    // rather than treated as a replay. Then re-throw so the 500 surfaces.
    await prisma.stripeEvent.delete({ where: { id: event.id } }).catch(() => undefined)

    log.error(
      {
        err: err instanceof Error ? err.message : String(err),
        eventId: event.id,
        type: event.type
      },
      'webhook handler failed'
    )

    throw err
  }
})

async function dispatchEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
      break

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await upsertSubscription(event.data.object as Stripe.Subscription)
      break

    case 'customer.subscription.deleted':
      await markSubscriptionCanceled(event.data.object as Stripe.Subscription)
      break

    default:
      log.debug({ type: event.type, eventId: event.id }, 'webhook ignored — no handler')
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const orgEntityId = session.client_reference_id ?? session.metadata?.['organisationId']

  if (!orgEntityId || typeof session.customer !== 'string') {
    log.warn(
      {
        sessionId: session.id,
        hasOrg: Boolean(orgEntityId),
        hasCustomer: Boolean(session.customer)
      },
      'checkout.session.completed missing org or customer — skipping customer link'
    )

    return
  }

  await prisma.organisation.update({
    where: { entityId: orgEntityId },
    data: { stripeCustomerId: session.customer }
  })
}

async function upsertSubscription(sub: Stripe.Subscription): Promise<void> {
  const orgEntityId = sub.metadata?.['organisationId']

  if (!orgEntityId) {
    log.warn(
      { subId: sub.id },
      'subscription event missing organisationId metadata — cannot upsert'
    )

    return
  }

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  const item = sub.items.data[0]

  if (!item) {
    log.warn({ subId: sub.id }, 'subscription has no items — cannot upsert')

    return
  }

  const planKey =
    (typeof item.price.product === 'object' &&
    item.price.product &&
    'metadata' in item.price.product
      ? (item.price.product.metadata?.['planKey'] as string | undefined)
      : undefined) ?? 'pro'

  // Stripe Subscription period fields can be sourced from either the
  // subscription itself or its first item; the item is the canonical
  // path in newer API versions and falls back to the subscription
  // for older payloads.
  const periodStart =
    (item as { current_period_start?: number }).current_period_start ??
    (sub as unknown as { current_period_start?: number }).current_period_start
  const periodEnd =
    (item as { current_period_end?: number }).current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end

  if (!periodStart || !periodEnd) {
    log.warn({ subId: sub.id }, 'subscription missing period bounds — cannot upsert')

    return
  }

  await prisma.subscription.upsert({
    where: { organisationId: orgEntityId },
    create: {
      entityId: `sub_${crypto.randomUUID()}`,
      organisationId: orgEntityId,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: customerId,
      stripePriceId: item.price.id,
      planKey,
      status: sub.status,
      currentPeriodStart: new Date(periodStart * 1000),
      currentPeriodEnd: new Date(periodEnd * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null
    },
    update: {
      stripeSubscriptionId: sub.id,
      stripeCustomerId: customerId,
      stripePriceId: item.price.id,
      planKey,
      status: sub.status,
      currentPeriodStart: new Date(periodStart * 1000),
      currentPeriodEnd: new Date(periodEnd * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null
    }
  })
}

async function markSubscriptionCanceled(sub: Stripe.Subscription): Promise<void> {
  await prisma.subscription
    .update({
      where: { stripeSubscriptionId: sub.id },
      data: {
        status: 'canceled',
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date()
      }
    })
    .catch((err: { code?: string }) => {
      if (err.code === 'P2025') {
        log.warn({ subId: sub.id }, 'cancel webhook for unknown subscription')

        return
      }

      throw err
    })
}
