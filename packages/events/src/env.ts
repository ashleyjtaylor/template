import { z } from 'zod'

// Redis connection. Local dev: defaults to redis://localhost:6379 (no TLS,
// no AUTH — matches docker-compose.yml). Deployed envs set
// REDIS_HOST + REDIS_PORT + REDIS_AUTH_TOKEN (from Secrets Manager) and we
// compose a rediss:// URL with TLS. Setting REDIS_URL directly overrides the
// composition — useful when forks want a custom managed Redis URL.
const schema = z
  .object({
    REDIS_URL: z.string().optional(),
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_AUTH_TOKEN: z.string().optional()
  })
  .transform((parsed) => {
    if (parsed.REDIS_URL) return { ...parsed, REDIS_URL: parsed.REDIS_URL }
    const url = parsed.REDIS_AUTH_TOKEN
      ? `rediss://default:${encodeURIComponent(parsed.REDIS_AUTH_TOKEN)}@${parsed.REDIS_HOST}:${parsed.REDIS_PORT}`
      : `redis://${parsed.REDIS_HOST}:${parsed.REDIS_PORT}`

    return { ...parsed, REDIS_URL: url }
  })

export const env = schema.parse(process.env)
