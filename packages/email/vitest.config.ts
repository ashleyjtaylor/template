import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      // Integration tests hit the local Compose Postgres (template_test
      // database). CI's service container exposes the same endpoint with
      // the same defaults. Other DB_* vars use packages/db env defaults.
      DB_NAME: 'template_test'
    }
  }
})
