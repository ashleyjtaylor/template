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
    // Which deployed AWS environment this process is running in. Distinct
    // from NODE_ENV: staging and production both run with NODE_ENV=production
    // (we want every prod optimisation on staging too), so NODE_ENV cannot
    // tell them apart. APP_ENV is what the SPA's env+SHA badge surfaces and
    // what future env-conditional logic (e.g. Stripe test vs live keys,
    // Mailpit vs SES, MinIO vs S3) should branch on. CDK injects
    // 'staging' / 'production' on the API container env in app-stack.ts;
    // local dev defaults to 'local'.
    APP_ENV: z
      .preprocess((v) => v || undefined, z.enum(['local', 'staging', 'production']))
      .default('local'),
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
    DB_NAME: z.string().default('template_dev'),
    // Signs better-auth session cookies. No default — production injects via
    // Secrets Manager (infra/cdk/lib/data-stack.ts), CI via vitest.config.ts,
    // local dev via apps/api/.env (see apps/api/.env.example).
    BETTER_AUTH_SECRET: z.string().min(32),
    // Canonical base URL better-auth uses to construct OAuth callbacks,
    // verification email links, password-reset URLs, and session-cookie
    // domains. Defaults to localhost so `pnpm dev` doesn't trip better-auth's
    // "Base URL could not be determined" warning. Production injects the
    // ALB DNS (eventually the real api.<domain>) via infra/cdk/lib/app-stack.ts.
    BETTER_AUTH_URL: z.string().url().default('http://localhost:3000')
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
