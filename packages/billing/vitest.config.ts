import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      // Integration tests hit the local Compose Postgres (template_test
      // database). CI's service container exposes the same endpoint with
      // the same defaults.
      DB_NAME: 'template_test',
      // packages/billing's env validator requires these — supply harmless
      // fakes so the module loads under test. Tests that exercise the
      // Stripe SDK mock at the client boundary; they never reach the API.
      STRIPE_API_KEY: 'sk_test_billing_unit_tests',
      STRIPE_WEBHOOK_SECRET: 'whsec_billing_unit_tests',
      STRIPE_PRICE_ID_PRO: 'price_billing_unit_tests',
      STRIPE_PORTAL_RETURN_URL: 'http://localhost:5174'
    }
  }
})
