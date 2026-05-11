import { prisma } from '@template/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('GET /health/ready', () => {
  it('should return 200 with checks.db ok when the probe succeeds', async () => {
    vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null)
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const res = await app.request('/health/ready')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'ok',
      checks: { db: 'ok' }
    })
  })

  it('should return 503 with checks.db down when the probe throws', async () => {
    vi.spyOn(prisma.user, 'findFirst').mockRejectedValue(new Error('connection refused'))
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const res = await app.request('/health/ready')

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      status: 'unavailable',
      checks: { db: 'down' }
    })
  })

  it('should return 503 when the probe takes longer than the timeout', async () => {
    vi.useFakeTimers()
    vi.spyOn(prisma.user, 'findFirst').mockReturnValue(
      new Promise(() => {}) as unknown as ReturnType<typeof prisma.user.findFirst>
    )
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const resPromise = app.request('/health/ready')
    await vi.advanceTimersByTimeAsync(2_000)
    const res = await resPromise

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      status: 'unavailable',
      checks: { db: 'down' }
    })
  })
})
