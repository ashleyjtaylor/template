import { prisma } from '@template/db'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app.js'

const ORIGIN = 'http://localhost:3000'

const uniqueEmail = (label: string) => `${label}-${crypto.randomUUID()}@example.com`

const signUp = (
  app: ReturnType<typeof createApp>,
  email: string,
  password = 'abcd1234',
  firstname = 'Test',
  lastname = 'User'
) =>
  app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({
      email,
      password,
      firstname,
      lastname,
      name: `${firstname} ${lastname}`
    })
  })

const cookieFrom = (res: Response) => res.headers.get('set-cookie') ?? ''

const signUpAsStaff = async (app: ReturnType<typeof createApp>, email: string) => {
  const res = await signUp(app, email)
  await prisma.user.update({ where: { email }, data: { staffRole: 'admin' } })

  return res
}

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/audit-log', () => {
  it('should return 200 with rows and a nextCursor for staff', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('audit-list-staff')
    const signupRes = await signUpAsStaff(app, email)
    const cookie = cookieFrom(signupRes)
    const requestId = signupRes.headers.get('x-request-id')

    const res = await app.request(`/api/audit-log?requestId=${requestId}`, {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      rows: Array<{ action: string; requestId: string }>
      nextCursor: string | null
    }

    expect(body.rows.length).toBeGreaterThan(0)
    expect(body.rows.every((r) => r.requestId === requestId)).toBe(true)
    expect(body).toHaveProperty('nextCursor')
  })

  it('should return 401 with no session', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const res = await app.request('/api/audit-log')

    expect(res.status).toBe(401)
  })

  it('should return 403 when authed but staffRole is null', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('audit-403')
    const signupRes = await signUp(app, email)
    const cookie = cookieFrom(signupRes)

    const res = await app.request('/api/audit-log', { headers: { Cookie: cookie } })

    expect(res.status).toBe(403)
  })

  it('should narrow results when filtered by action', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('audit-filter')
    const signupRes = await signUpAsStaff(app, email)
    const cookie = cookieFrom(signupRes)
    const requestId = signupRes.headers.get('x-request-id')

    const res = await app.request(`/api/audit-log?action=user.signed_up&requestId=${requestId}`, {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)

    const body = (await res.json()) as { rows: Array<{ action: string }> }

    expect(body.rows.length).toBeGreaterThan(0)
    expect(body.rows.every((r) => r.action === 'user.signed_up')).toBe(true)
  })

  it('should paginate via cursor without overlap', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('audit-cursor')
    const signupRes = await signUpAsStaff(app, email)
    const cookie = cookieFrom(signupRes)

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })

    // Create 4 dummy rows under a unique action so we can isolate the test data.
    const action = `test.cursor.${crypto.randomUUID()}`
    const baseTime = Date.now()
    for (let i = 0; i < 4; i++) {
      await prisma.auditLog.create({
        data: {
          entityId: `aud_${crypto.randomUUID()}`,
          action,
          actorUserId: user.entityId,
          createdAt: new Date(baseTime - i * 1000),
          details: { action, idx: i }
        }
      })
    }

    const first = await app.request(`/api/audit-log?action=${action}&limit=2`, {
      headers: { Cookie: cookie }
    })

    expect(first.status).toBe(200)

    const firstBody = (await first.json()) as {
      rows: Array<{ entityId: string }>
      nextCursor: string | null
    }

    expect(firstBody.rows).toHaveLength(2)
    expect(firstBody.nextCursor).not.toBeNull()

    const second = await app.request(
      `/api/audit-log?action=${action}&limit=2&cursor=${firstBody.nextCursor}`,
      { headers: { Cookie: cookie } }
    )

    const secondBody = (await second.json()) as {
      rows: Array<{ entityId: string }>
      nextCursor: string | null
    }

    expect(secondBody.rows).toHaveLength(2)

    const firstIds = new Set(firstBody.rows.map((r) => r.entityId))
    const secondIds = new Set(secondBody.rows.map((r) => r.entityId))

    for (const id of secondIds) expect(firstIds.has(id)).toBe(false)
  })
})

describe('GET /api/audit-log/:entityId', () => {
  it('should return 200 with the matching row for staff', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('audit-detail')
    const signupRes = await signUpAsStaff(app, email)
    const cookie = cookieFrom(signupRes)

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actorUserId: user.entityId, action: 'user.signed_up' }
    })

    const res = await app.request(`/api/audit-log/${row.entityId}`, { headers: { Cookie: cookie } })

    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      entityId: string
      action: string
      actorUser: { email: string } | null
    }

    expect(body.entityId).toBe(row.entityId)
    expect(body.action).toBe('user.signed_up')
    expect(body.actorUser?.email).toBe(email)
  })

  it('should return 404 for a missing entityId', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('audit-detail-404')
    const signupRes = await signUpAsStaff(app, email)
    const cookie = cookieFrom(signupRes)

    const res = await app.request(`/api/audit-log/aud_${crypto.randomUUID()}`, {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(404)
  })
})

describe('GET /api/audit-log/actions', () => {
  it('should return sorted unique action strings', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('audit-actions')
    const signupRes = await signUpAsStaff(app, email)
    const cookie = cookieFrom(signupRes)

    const res = await app.request('/api/audit-log/actions', { headers: { Cookie: cookie } })

    expect(res.status).toBe(200)

    const body = (await res.json()) as { actions: string[] }

    expect(body.actions).toContain('user.signed_up')
    expect(body.actions).toEqual([...body.actions].sort())
  })
})
