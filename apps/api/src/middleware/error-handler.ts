import { formatError, HttpError } from '@template/errors'
import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { logger } from '@/lib/logger.js'

// Maps a non-typed framework error (HTTPException from middleware like
// bodyLimit or cors) to one of the canonical wire codes used by our HttpError
// subclasses, so the response shape is consistent regardless of source.
const STATUS_TO_CODE: Record<number, string> = {
  400: 'ValidationError',
  401: 'UnauthorizedError',
  403: 'ForbiddenError',
  404: 'NotFoundError',
  409: 'ConflictError',
  413: 'PayloadTooLarge'
}

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) {
    // Cast: HttpError.status is `number` so errors.ts stays decoupled from
    // Hono's status-code union. We constrain valid values via the subclass
    // literals (400, 401, ...), so this is safe at runtime.
    return c.json(formatError(err), err.status as ContentfulStatusCode)
  }

  if (err instanceof HTTPException) {
    const code = STATUS_TO_CODE[err.status] ?? 'InternalError'

    return c.json({ code, message: err.message }, err.status as ContentfulStatusCode)
  }

  logger.error({ err }, 'unhandled error')

  return c.json({ code: 'InternalError', message: 'Internal server error' }, 500)
}
