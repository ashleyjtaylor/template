import { prisma } from '@template/db'
import type { Handler } from 'hono'
import { logger } from '@/lib/logger.js'

const PROBE_TIMEOUT_MS = 2_000

export const healthReady: Handler = async (c) => {
  // Race the DB probe against a 2s timeout. The setTimeout is unref'd so it
  // doesn't keep the process alive once the probe wins.
  const timeout = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), PROBE_TIMEOUT_MS).unref()
  })

  try {
    const result = await Promise.race([prisma.user.findFirst(), timeout])

    if (result === 'timeout') {
      logger.warn({ timeoutMs: PROBE_TIMEOUT_MS }, 'health/ready: db probe timed out')

      return c.json({ status: 'unavailable', checks: { db: 'down' } }, 503)
    }

    return c.json({ status: 'ok', checks: { db: 'ok' } }, 200)
  } catch (err) {
    logger.warn({ err }, 'health/ready: db probe failed')

    return c.json({ status: 'unavailable', checks: { db: 'down' } }, 503)
  }
}
