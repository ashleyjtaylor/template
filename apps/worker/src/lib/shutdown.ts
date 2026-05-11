import { logger } from '@/lib/logger.js'

type BeforeExit = () => Promise<void> | void

export interface ShutdownOptions {
  timeoutMs: number
  // Each hook runs in order during shutdown. Failures are logged but don't
  // block exit. Use for closing BullMQ Workers, queues, Redis, Prisma — in
  // that order so in-flight jobs drain before their connections close.
  beforeExit: BeforeExit[]
}

export function registerShutdown({ timeoutMs, beforeExit }: ShutdownOptions): () => void {
  let shuttingDown = false

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return

    shuttingDown = true

    logger.info({ signal, timeoutMs }, 'shutdown: starting')

    const force = setTimeout(() => {
      logger.warn({ timeoutMs }, 'shutdown: timeout exceeded, forcing exit')

      process.exit(0)
    }, timeoutMs)

    force.unref()

    for (const hook of beforeExit) {
      try {
        await hook()
      } catch (err) {
        logger.error({ err }, 'shutdown: hook failed')
      }
    }

    clearTimeout(force)
    logger.info('shutdown: complete')

    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  return () => {
    process.off('SIGTERM', shutdown)
    process.off('SIGINT', shutdown)
  }
}
