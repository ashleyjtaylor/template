import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GIT_SHA: z.preprocess((v) => v || undefined, z.string().default('unknown')),
  // Which deployed AWS environment this process is running in. Same values
  // and semantics as apps/api/src/env.ts — see the comment there for why
  // this is distinct from NODE_ENV.
  APP_ENV: z
    .preprocess((v) => v || undefined, z.enum(['local', 'staging', 'production']))
    .default('local'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  // Must stay <= the ECS task `stopTimeout` set in infra/cdk/lib/app-stack.ts.
  // ECS sends SIGKILL once stopTimeout elapses; we want to close BullMQ Workers
  // (draining in-flight jobs) before that happens.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  // Per-queue BullMQ Worker concurrency. Forks tune these per-feature.
  WORKER_QUEUE_INTERNAL_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WORKER_QUEUE_SCHEDULES_CONCURRENCY: z.coerce.number().int().positive().default(3),
  WORKER_QUEUE_EMAILS_CONCURRENCY: z.coerce.number().int().positive().default(5),
  // How often the outbox publisher ticks (ms). Lower = tighter latency on
  // transactional events; higher = less DB churn.
  OUTBOX_PUBLISHER_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  // Base URL of the customer-facing SPA (apps/web). Used by subscribers to
  // build absolute links in emails (e.g. accept-invite URL). CDK injects
  // the WebSpaUrl in deployed envs; local default matches apps/web's vite
  // dev port.
  WEB_BASE_URL: z.url().default('http://localhost:5174')
})

export const env = schema.parse(process.env)
