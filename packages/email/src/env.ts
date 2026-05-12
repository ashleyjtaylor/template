import { z } from 'zod'

// APP_ENV picks the transport (local → Mailpit; otherwise SES if EMAIL_FROM
// is set, otherwise LogOnly). EMAIL_FROM is optional at the env layer — the
// transport selector decides what to do when it's missing.
const schema = z.object({
  APP_ENV: z
    .preprocess((v) => v || undefined, z.enum(['local', 'staging', 'production']))
    .default('local'),
  EMAIL_FROM: z.email().optional(),
  // Mailpit defaults match docker-compose.yml. Local-only.
  MAILPIT_HOST: z.string().default('localhost'),
  MAILPIT_PORT: z.coerce.number().int().positive().default(1025),
  // Pulled through here so the logger can read them via property access
  // (matches the apps' env-validation pattern; avoids index-signature noise).
  LOG_LEVEL: z.string().default('info'),
  GIT_SHA: z.string().default('unknown')
})

export const env = schema.parse(process.env)
