import { on } from '@template/events'
import { logger } from '@/lib/logger.js'

// Heartbeat subscriber. Logs at debug so it doesn't drown out real activity
// in normal log levels but is visible when LOG_LEVEL=debug during a
// liveness check.
on('worker.heartbeat', async (event) => {
  logger.debug({ ts: event.ts }, 'heartbeat')
})
