import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      // Integration tests hit the local Compose Postgres (template_test
      // database) and Compose Redis. CI's service containers expose the
      // same endpoints with the same defaults.
      DB_NAME: 'template_test',
      REDIS_URL: 'redis://localhost:6379'
    }
  }
})
