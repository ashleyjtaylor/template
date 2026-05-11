import { z } from 'zod'

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    // DB connection — defaults match docker-compose.yml at the repo root so
    // local dev works without any further env wiring. Production overrides
    // all five via secrets injected by infra/cdk/lib/app-stack.ts.
    DB_HOST: z.string().default('localhost'),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_USER: z.string().default('postgres'),
    DB_PASSWORD: z.string().default('postgres'),
    DB_NAME: z.string().default('template_dev')
  })
  // URL composition is duplicated in prisma.config.ts (the Prisma CLI's
  // config file, which ships to /prod where it can't import from src/).
  // Keep the two in sync if you change either side.
  .transform((parsed) => {
    // RDS Postgres has `rds.force_ssl=1`; the connection is rejected without
    // TLS. Local Postgres (Compose, CI service container) doesn't speak SSL
    // — gate on the host name so we only opt in for RDS endpoints. Anchor
    // the suffix match to a subdomain boundary (`.rds.amazonaws.com`) so a
    // host like `evilrds.amazonaws.com` doesn't accidentally pass.
    //
    // `uselibpqcompat=true` is required because pg-connection-string (under
    // @prisma/adapter-pg) currently interprets `sslmode=require` as
    // `verify-full` — RDS's Amazon CA isn't in Node's default trust store,
    // so verification fails. libpq semantics give us "encrypt, don't
    // validate" which is the historical/expected meaning of `require`.
    // When we ship the RDS CA bundle, switch to `sslmode=verify-full`.
    const normalizedHost = parsed.DB_HOST.trim().toLowerCase()
    const isRds =
      normalizedHost === 'rds.amazonaws.com' || normalizedHost.endsWith('.rds.amazonaws.com')
    const sslSuffix = isRds ? '?sslmode=require&uselibpqcompat=true' : ''

    return {
      ...parsed,
      DATABASE_URL: `postgresql://${parsed.DB_USER}:${encodeURIComponent(parsed.DB_PASSWORD)}@${parsed.DB_HOST}:${parsed.DB_PORT}/${parsed.DB_NAME}${sslSuffix}`
    }
  })

export const env = schema.parse(process.env)
