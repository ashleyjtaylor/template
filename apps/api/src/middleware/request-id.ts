import { randomUUID } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { runWithContext } from '../lib/logger.js'

export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const id = `req_${randomUUID()}`
    c.header('X-Request-Id', id)
    await runWithContext({ requestId: id }, () => next())
  }
}
