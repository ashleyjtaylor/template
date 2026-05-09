import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app.js'
import { prisma } from '@/lib/db.js'

// Integration test: connects to a real Postgres (local Docker Compose or the
// postgres service container in CI) with the Prisma migration applied. Asserts
// /health/ready completes the full DB round-trip end-to-end.

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /health/ready (integration)', () => {
  it('should return 200 against a real Postgres with migrations applied', async () => {
    const app = createApp({ gitSha: 'test' })

    const res = await app.request('/health/ready')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'ok',
      checks: { db: 'ok' }
    })
  })
})
