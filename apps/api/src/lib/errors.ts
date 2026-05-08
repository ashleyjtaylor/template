export interface ErrorWire {
  code: string
  message: string
  details?: unknown
}

export abstract class HttpError extends Error {
  abstract readonly status: number
  readonly details?: unknown

  constructor(message: string, details?: unknown) {
    super(message)
    this.name = this.constructor.name
    this.details = details
  }

  get code(): string {
    return this.name
  }
}

export class ValidationError extends HttpError {
  readonly status = 400
}

export class UnauthorizedError extends HttpError {
  readonly status = 401
}

export class ForbiddenError extends HttpError {
  readonly status = 403
}

export class NotFoundError extends HttpError {
  readonly status = 404
}

export class ConflictError extends HttpError {
  readonly status = 409
}

export class InternalError extends HttpError {
  readonly status = 500
}

export function formatError(err: HttpError): ErrorWire {
  return err.details === undefined
    ? { code: err.code, message: err.message }
    : { code: err.code, message: err.message, details: err.details }
}
