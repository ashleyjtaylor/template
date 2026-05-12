import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true
  },
  test: {
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // Integration tests run against the local Compose Postgres
      // (template_test database) or, in CI, against the postgres service
      // container. Other DB_* vars use the env.ts defaults
      // (localhost:5432, postgres/postgres) which match Compose.
      DB_NAME: 'template_test',
      BETTER_AUTH_SECRET: 'test-secret-32-chars-minimum-aaaa',
      // Stripe — deterministic placeholders. The Stripe SDK is stubbed
      // at the `getStripeClient()` boundary for the route tests; the
      // webhook tests use these values to drive the real
      // `webhooks.constructEvent` signature verification path.
      STRIPE_API_KEY: 'sk_test_billing_integration',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_billing_integration',
      STRIPE_PRICE_ID_PRO: 'price_test_pro',
      STRIPE_PORTAL_RETURN_URL: 'http://localhost:5174',
      WEB_BASE_URL: 'http://localhost:5174'
    }
  }
})
