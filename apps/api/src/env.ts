import { z } from 'zod'

const csvToArray = (v: unknown) =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : v

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    GIT_SHA: z.preprocess((v) => v || undefined, z.string().default('unknown')),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    CORS_ORIGINS: z.preprocess(csvToArray, z.array(z.string()).default([])),
    BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),
    // Must stay <= the ECS task `stopTimeout` set in infra/cdk/lib/app-stack.ts.
    // ECS sends SIGKILL once stopTimeout elapses; we want to drain and exit
    // cleanly before that happens.
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
    // DB connection — defaults match docker-compose.yml at the repo root so
    // local dev works without any further env wiring. Production overrides
    // all five via secrets injected by infra/cdk/lib/app-stack.ts.
    DB_HOST: z.string().default('localhost'),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_USER: z.string().default('postgres'),
    DB_PASSWORD: z.string().default('postgres'),
    DB_NAME: z.string().default('template_dev')
  })
  // URL composition is duplicated in apps/api/prisma.config.ts (the Prisma
  // CLI's config file, which can't import from src/). Keep the two in sync
  // if you change either side.
  .transform((parsed) => {
    // RDS Postgres has `rds.force_ssl=1`; the connection is rejected without
    // TLS. Local Postgres (Compose, CI service container) doesn't speak SSL
    // — gate on the host name so we only opt in for RDS endpoints. Anchor
    // the suffix match to a subdomain boundary (`.rds.amazonaws.com`) so a
    // host like `evilrds.amazonaws.com` doesn't accidentally pass.
    const normalizedHost = parsed.DB_HOST.trim().toLowerCase()
    const isRds =
      normalizedHost === 'rds.amazonaws.com' || normalizedHost.endsWith('.rds.amazonaws.com')
    const sslSuffix = isRds ? '?sslmode=require' : ''

    return {
      ...parsed,
      DATABASE_URL: `postgresql://${parsed.DB_USER}:${encodeURIComponent(parsed.DB_PASSWORD)}@${parsed.DB_HOST}:${parsed.DB_PORT}/${parsed.DB_NAME}${sslSuffix}`
    }
  })

export const env = schema.parse(process.env)
