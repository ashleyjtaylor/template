import { logger } from './logger.js'

export interface ShutdownOptions {
  timeoutMs: number
}

// Structural type so this works with both node:http's Server and whatever
// @hono/node-server's `serve()` returns (HttpServer | Http2Server | ...).
export interface ClosableServer {
  close(callback?: (err?: Error) => void): void
}

export function registerShutdown(
  server: ClosableServer,
  { timeoutMs }: ShutdownOptions
): () => void {
  let shuttingDown = false

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true

    logger.info({ signal, timeoutMs }, 'shutdown: draining in-flight requests')

    const force = setTimeout(() => {
      logger.warn({ timeoutMs }, 'shutdown: drain timed out, exiting')
      process.exit(0)
    }, timeoutMs)
    force.unref()

    server.close((err) => {
      clearTimeout(force)
      if (err) {
        logger.error({ err }, 'shutdown: server.close errored, exiting non-zero')
        process.exit(1)
      }
      logger.info('shutdown: drain complete')
      process.exit(0)
    })
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  return () => {
    process.off('SIGTERM', shutdown)
    process.off('SIGINT', shutdown)
  }
}
