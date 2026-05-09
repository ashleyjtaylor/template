import type { MiddlewareHandler } from 'hono'
import { logger } from '@/lib/logger.js'

// Paths that should not generate one log line per request. ALB hits /health
// every 30s and monitoring polls /health/ready on a similar cadence; logging
// each probe drowns out real signal in CloudWatch.
const SKIP_PATHS = new Set<string>(['/health', '/health/ready'])

export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now()

    await next()

    if (SKIP_PATHS.has(c.req.path)) return

    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - start
      },
      'request'
    )
  }
}
