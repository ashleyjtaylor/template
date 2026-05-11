import { describe, expect, it } from 'vitest'
import {
  ConflictError,
  ForbiddenError,
  formatError,
  type HttpError,
  InternalError,
  NotFoundError,
  UnauthorizedError,
  ValidationError
} from '../../src/index.js'

describe('HttpError subclasses', () => {
  it.each<[new (msg: string) => HttpError, number, string]>([
    [ValidationError, 400, 'ValidationError'],
    [UnauthorizedError, 401, 'UnauthorizedError'],
    [ForbiddenError, 403, 'ForbiddenError'],
    [NotFoundError, 404, 'NotFoundError'],
    [ConflictError, 409, 'ConflictError'],
    [InternalError, 500, 'InternalError']
  ])('should expose status %d and code "%s" on %o', (Cls, status, code) => {
    const err = new Cls('boom')

    expect(err.status).toBe(status)
    expect(err.code).toBe(code)
    expect(err.message).toBe('boom')
  })
})

describe('formatError', () => {
  it('should omit details when undefined', () => {
    const err = new NotFoundError('missing')

    expect(formatError(err)).toEqual({ code: 'NotFoundError', message: 'missing' })
  })

  it('should include details when provided', () => {
    const err = new ValidationError('bad input', { field: 'email' })

    expect(formatError(err)).toEqual({
      code: 'ValidationError',
      message: 'bad input',
      details: { field: 'email' }
    })
  })
})
