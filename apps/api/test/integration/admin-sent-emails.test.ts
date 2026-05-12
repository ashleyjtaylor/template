import { prisma } from '@template/db'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
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

const seedSentEmail = (
  overrides: Partial<Parameters<typeof prisma.sentEmail.create>[0]['data']> = {}
) =>
  prisma.sentEmail.create({
    data: {
      entityId: `sem_${crypto.randomUUID()}`,
      dedupeKey: `test:${crypto.randomUUID()}`,
      recipient: 'someone@example.com',
      template: 'invitation',
      subject: 'You have been invited',
      html: '<p>Click here</p>',
      text: 'Click here',
      status: 'sent',
      sentAt: new Date(),
      messageId: 'msg-stub',
      ...overrides
    }
  })

beforeEach(async () => {
  await prisma.sentEmail.deleteMany({})
})

afterAll(async () => {
  await prisma.sentEmail.deleteMany({})
  await prisma.$disconnect()
})

describe('GET /api/admin/sent-emails', () => {
  it('returns 200 with rows for staff', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const signupRes = await signUpAsStaff(app, uniqueEmail('staff-list'))
    const cookie = cookieFrom(signupRes)

    await seedSentEmail()
    await seedSentEmail()

    const res = await app.request('/api/admin/sent-emails', { headers: { Cookie: cookie } })

    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      rows: Array<{ entityId: string; status: string; html?: string }>
      nextCursor: string | null
    }

    expect(body.rows.length).toBeGreaterThanOrEqual(2)
    // List view trims the HTML body — only detail returns it.
    expect(body.rows.every((r) => !('html' in r))).toBe(true)
    expect(body).toHaveProperty('nextCursor')
  })

  it('returns 401 with no session', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const res = await app.request('/api/admin/sent-emails')

    expect(res.status).toBe(401)
  })

  it('returns 403 when authed but staffRole is null', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const signupRes = await signUp(app, uniqueEmail('non-staff-list'))
    const cookie = cookieFrom(signupRes)

    const res = await app.request('/api/admin/sent-emails', { headers: { Cookie: cookie } })

    expect(res.status).toBe(403)
  })

  it('paginates via cursor without overlap', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const signupRes = await signUpAsStaff(app, uniqueEmail('paginate'))
    const cookie = cookieFrom(signupRes)

    const baseTime = Date.now()
    for (let i = 0; i < 4; i++) {
      await seedSentEmail({ createdAt: new Date(baseTime - i * 1000) })
    }

    const first = await app.request('/api/admin/sent-emails?limit=2', {
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
      `/api/admin/sent-emails?limit=2&cursor=${firstBody.nextCursor}`,
      { headers: { Cookie: cookie } }
    )

    const secondBody = (await second.json()) as {
      rows: Array<{ entityId: string }>
      nextCursor: string | null
    }

    expect(secondBody.rows.length).toBeGreaterThan(0)

    const firstIds = new Set(firstBody.rows.map((r) => r.entityId))

    for (const r of secondBody.rows) expect(firstIds.has(r.entityId)).toBe(false)
  })
})

describe('GET /api/admin/sent-emails/:entityId', () => {
  it('returns 200 with the full row (including html) for staff', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const signupRes = await signUpAsStaff(app, uniqueEmail('staff-detail'))
    const cookie = cookieFrom(signupRes)

    const row = await seedSentEmail({ html: '<p>Detail body</p>' })

    const res = await app.request(`/api/admin/sent-emails/${row.entityId}`, {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)

    const body = (await res.json()) as { entityId: string; html: string; dedupeKey: string }

    expect(body.entityId).toBe(row.entityId)
    expect(body.html).toBe('<p>Detail body</p>')
    expect(body.dedupeKey).toBe(row.dedupeKey)
  })

  it('returns 404 for an unknown entityId', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const signupRes = await signUpAsStaff(app, uniqueEmail('detail-404'))
    const cookie = cookieFrom(signupRes)

    const res = await app.request(`/api/admin/sent-emails/sem_${crypto.randomUUID()}`, {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(404)
  })

  it('returns 403 for non-staff on the detail endpoint', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const signupRes = await signUp(app, uniqueEmail('non-staff-detail'))
    const cookie = cookieFrom(signupRes)

    const row = await seedSentEmail()

    const res = await app.request(`/api/admin/sent-emails/${row.entityId}`, {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(403)
  })
})
