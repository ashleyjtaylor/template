import { z } from 'zod'

// Stripe env vars. The API + worker containers receive these from
// Secrets Manager (api key + webhook secret) and CDK-injected env
// (price id, portal return url). Local dev pulls them from
// apps/api/.env per the local-dev runbook.
const schema = z.object({
  STRIPE_API_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_ID_PRO: z.string().min(1),
  STRIPE_PORTAL_RETURN_URL: z.string().url()
})

export const env = schema.parse(process.env)
