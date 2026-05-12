import { z } from 'zod'

const csvToArray = (v: unknown) =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : v

const schema = z.object({
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
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  CORS_ORIGINS: z.preprocess(csvToArray, z.array(z.string()).default([])),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),
  // Must stay <= the ECS task `stopTimeout` set in infra/cdk/lib/app-stack.ts.
  // ECS sends SIGKILL once stopTimeout elapses; we want to drain and exit
  // cleanly before that happens.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  // Signs better-auth session cookies. No default — production injects via
  // Secrets Manager (infra/cdk/lib/data-stack.ts), CI via vitest.config.ts,
  // local dev via apps/api/.env (see apps/api/.env.example).
  BETTER_AUTH_SECRET: z.string().min(32),
  // Canonical base URL better-auth uses to construct OAuth callbacks,
  // verification email links, password-reset URLs, and session-cookie
  // domains. Defaults to localhost so `pnpm dev` doesn't trip better-auth's
  // "Base URL could not be determined" warning. Production injects the
  // ALB DNS (eventually the real api.<domain>) via infra/cdk/lib/app-stack.ts.
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  // Public URL of the web SPA — used by the billing module to build
  // Stripe Checkout `success_url` / `cancel_url` and Customer Portal
  // `return_url`. Local dev defaults to apps/web's standard vite port;
  // deployed envs inject the CloudFront URL via app-stack.ts.
  WEB_BASE_URL: z.string().url().default('http://localhost:5174')
})

// DB_* env vars and the DATABASE_URL composition live in packages/db. Apps
// just need to set DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME in
// process.env; `@template/db` reads them and composes the URL.
export const env = schema.parse(process.env)
