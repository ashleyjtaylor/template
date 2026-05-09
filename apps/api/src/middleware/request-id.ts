import { randomUUID } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { runWithContext } from '@/lib/logger.js'

export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const id = `req_${randomUUID()}`

    await runWithContext({ requestId: id }, () => next())

    // Set on the outgoing response, not via `c.header()` which only flows for
    // Hono-built responses. Handler-returned Response objects (e.g. better-auth
    // at /auth/*) replace c.res entirely, so a pre-flight c.header() call
    // would be discarded.
    c.res.headers.set('X-Request-Id', id)
  }
}
