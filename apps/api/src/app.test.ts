import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { NotFoundError } from './lib/errors.js'
import { logger } from './lib/logger.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /health', () => {
  it('returns 200 with status ok, the configured version, and numeric uptime', async () => {
    const app = createApp({ gitSha: 'test-sha' })

    const res = await app.request('/health')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'ok',
      version: 'test-sha',
      uptime: expect.any(Number)
    })
  })

  it('echoes whatever gitSha the factory is given', async () => {
    const app = createApp({ gitSha: 'unknown' })

    const res = await app.request('/health')
    const body = (await res.json()) as { version: string }

    expect(body.version).toBe('unknown')
  })
})

describe('error handling', () => {
  it('formats HttpError subclasses with the right status and code', async () => {
    const app = createApp({ gitSha: 'test' })
    app.get('/test/not-found', () => {
      throw new NotFoundError('user missing')
    })

    const res = await app.request('/test/not-found')

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      code: 'NotFoundError',
      message: 'user missing'
    })
  })

  it('scrubs unhandled error messages and returns 500', async () => {
    const app = createApp({ gitSha: 'test' })
    app.get('/test/boom', () => {
      throw new Error('secret database url leak')
    })
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger)

    const res = await app.request('/test/boom')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      code: 'InternalError',
      message: 'Internal server error'
    })
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('request id', () => {
  it('sets X-Request-Id on every response', async () => {
    const app = createApp({ gitSha: 'test' })
    const res = await app.request('/health')
    const id = res.headers.get('x-request-id')
    expect(id).toMatch(/^[0-9a-f-]{36}$/i)
  })
})

describe('security headers', () => {
  it('sets sane defaults on every response', async () => {
    const app = createApp({ gitSha: 'test' })
    const res = await app.request('/health')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBeTruthy()
  })
})

describe('cors', () => {
  it('allows preflight from a configured origin', async () => {
    const app = createApp({
      gitSha: 'test',
      corsOrigins: ['https://app.example.com']
    })

    const res = await app.request('/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'GET'
      }
    })

    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
  })

  it('omits CORS headers from disallowed origins', async () => {
    const app = createApp({
      gitSha: 'test',
      corsOrigins: ['https://app.example.com']
    })

    const res = await app.request('/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'GET'
      }
    })

    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('body limit', () => {
  it('rejects oversized bodies with 413', async () => {
    const app = createApp({ gitSha: 'test', bodyLimitBytes: 100 })
    app.post('/test/echo', (c) => c.json({ ok: true }))

    const body = 'x'.repeat(200)
    const res = await app.request('/test/echo', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': String(body.length)
      }
    })

    expect(res.status).toBe(413)
    const json = (await res.json()) as { code: string }
    expect(json.code).toBe('PayloadTooLarge')
  })
})

describe('request logger', () => {
  it('does not log /health requests', async () => {
    const app = createApp({ gitSha: 'test' })
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger)

    await app.request('/health')

    const requestCalls = infoSpy.mock.calls.filter((args) => args[1] === 'request')
    expect(requestCalls).toHaveLength(0)
  })

  it('logs non-/health requests with method, path, status, duration', async () => {
    const app = createApp({ gitSha: 'test' })
    app.get('/test/anything', (c) => c.json({}))
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger)

    await app.request('/test/anything')

    const requestLog = infoSpy.mock.calls.find((args) => args[1] === 'request')
    expect(requestLog).toBeDefined()
    expect(requestLog?.[0]).toMatchObject({
      method: 'GET',
      path: '/test/anything',
      status: 200,
      durationMs: expect.any(Number)
    })
  })
})
