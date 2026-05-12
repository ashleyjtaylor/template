import { z } from 'zod'

// Stripe env vars. The API + worker containers receive these from
// Secrets Manager (api key + webhook secret) and CDK-injected env
// (price id, portal return url). Local dev pulls them from
// apps/api/.env per the local-dev runbook.
//
// Why each field tolerates an empty default: this is a fork-opt-in
// surface. A freshly-bootstrapped staging that hasn't been wired to a
// real Stripe account should still boot — billing routes return a
// clear 503 ('billing not configured') at request time rather than
// crashing the whole API on startup.
const schema = z.object({
  STRIPE_API_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_ID_PRO: z.string().default(''),
  STRIPE_PORTAL_RETURN_URL: z.string().default('http://localhost:5174')
})

export const env = schema.parse(process.env)

// True iff a fork has configured the Stripe credentials. The webhook
// handler + Checkout/Portal routes call this before touching Stripe so
// the user gets a clear 503 instead of a cryptic Stripe error.
export function isBillingConfigured(): boolean {
  return (
    env.STRIPE_API_KEY.length > 0 &&
    env.STRIPE_WEBHOOK_SECRET.length > 0 &&
    env.STRIPE_PRICE_ID_PRO.length > 0
  )
}
