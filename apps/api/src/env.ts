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
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  CORS_ORIGINS: z.preprocess(csvToArray, z.array(z.string()).default([])),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),
  // Must stay <= the ECS task `stopTimeout` set in infra/cdk/lib/app-stack.ts.
  // ECS sends SIGKILL once stopTimeout elapses; we want to drain and exit
  // cleanly before that happens.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000)
})

export const env = schema.parse(process.env)
