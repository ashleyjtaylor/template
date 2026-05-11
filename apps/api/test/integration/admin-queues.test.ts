import { prisma } from '@template/db'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app.js'

const ORIGIN = 'http://localhost:3000'

const uniqueEmail = (label: string) => `${label}-${crypto.randomUUID()}@example.com`

const signUp = (app: ReturnType<typeof createApp>, email: string) =>
  app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({
      email,
      password: 'abcd1234',
      firstname: 'Test',
      lastname: 'User',
      name: 'Test User'
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

describe('GET /api/admin/queues', () => {
  it('should return 401 with no session', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const res = await app.request('/api/admin/queues/')

    expect(res.status).toBe(401)
  })

  it('should return 403 when authed but staffRole is null', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('admin-queues-403')
    const signupRes = await signUp(app, email)
    const cookie = cookieFrom(signupRes)

    const res = await app.request('/api/admin/queues/', { headers: { Cookie: cookie } })

    expect(res.status).toBe(403)
  })

  it('should let a staff session through to Bull Board', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('admin-queues-staff')
    const signupRes = await signUpAsStaff(app, email)
    const cookie = cookieFrom(signupRes)

    const res = await app.request('/api/admin/queues/', { headers: { Cookie: cookie } })

    // The point of this test is the auth gate, not Bull Board's own routing.
    // requireStaff would throw 401 / 403 if the session didn't pass — anything
    // else means the gate let us through to the Bull Board plugin.
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})
