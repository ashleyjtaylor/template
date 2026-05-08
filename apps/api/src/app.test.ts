import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'

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
