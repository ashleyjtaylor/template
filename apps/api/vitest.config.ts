import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // Integration tests run against the local Compose Postgres
      // (template_test database) or, in CI, against the postgres service
      // container. Other DB_* vars use the env.ts defaults
      // (localhost:5432, postgres/postgres) which match Compose.
      DB_NAME: 'template_test'
    }
  }
})
