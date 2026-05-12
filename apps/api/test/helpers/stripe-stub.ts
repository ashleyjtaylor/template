import { resetStripeClient, setStripeClient } from '@template/billing'
import Stripe from 'stripe'

// Test-scoped Stripe stub. The route-level integration tests want to
// assert what we'd send Stripe without actually crossing the network,
// so we swap the cached client at the `@template/billing` boundary.
//
// The stub still owns a real `webhooks` namespace — `stripe.webhooks.
// constructEvent` is the production signature-verification code path
// and the webhook tests drive it directly. Only `checkout.sessions` and
// `billingPortal.sessions` are faked; everything else throws so it's
// obvious if a code path reaches an unstubbed Stripe surface.

export interface StripeStubRecord {
  checkoutSessions: Array<Parameters<Stripe['checkout']['sessions']['create']>[0]>
  portalSessions: Array<Parameters<Stripe['billingPortal']['sessions']['create']>[0]>
}

export interface StripeStubOptions {
  // Override what the stub returns from `checkout.sessions.create`. Default
  // is a fake hosted-checkout URL.
  checkoutUrl?: string
  portalUrl?: string
}

const STRIPE_API_KEY = 'sk_test_billing_integration'

export const installStripeStub = (options: StripeStubOptions = {}): StripeStubRecord => {
  const record: StripeStubRecord = { checkoutSessions: [], portalSessions: [] }

  // Construct a real Stripe instance to inherit its real `webhooks`
  // namespace (signing + verification utilities). Then replace the
  // network-touching surfaces with stubs that record calls.
  const real = new Stripe(STRIPE_API_KEY, { apiVersion: '2026-04-22.dahlia' })

  const stub = {
    webhooks: real.webhooks,
    checkout: {
      sessions: {
        create: async (params: Parameters<Stripe['checkout']['sessions']['create']>[0]) => {
          record.checkoutSessions.push(params)

          return {
            id: 'cs_test_stub',
            url: options.checkoutUrl ?? 'https://checkout.stripe.com/c/pay/test-fake'
          } as unknown as Stripe.Checkout.Session
        }
      }
    },
    billingPortal: {
      sessions: {
        create: async (params: Parameters<Stripe['billingPortal']['sessions']['create']>[0]) => {
          record.portalSessions.push(params)

          return {
            id: 'bps_test_stub',
            url: options.portalUrl ?? 'https://billing.stripe.com/p/session/test-fake'
          } as unknown as Stripe.BillingPortal.Session
        }
      }
    }
  } as unknown as Stripe

  setStripeClient(stub)

  return record
}

export const uninstallStripeStub = (): void => {
  resetStripeClient()
}

// Signs a Stripe webhook payload with the test webhook secret. Mirrors
// what Stripe does when posting events; the webhook handler runs the
// real `constructEvent` so signatures must verify properly.
export const signStripePayload = (
  payload: string,
  timestamp: number = Math.floor(Date.now() / 1000)
): string => {
  const real = new Stripe(STRIPE_API_KEY, { apiVersion: '2026-04-22.dahlia' })

  return real.webhooks.generateTestHeaderString({
    payload,
    secret: 'whsec_test_billing_integration',
    timestamp
  })
}
