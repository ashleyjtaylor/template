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

    const res = await app.request('/api/admin/queues')

    expect(res.status).toBe(401)
  })

  it('should return 403 when authed but staffRole is null', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('admin-queues-403')
    const signupRes = await signUp(app, email)
    const cookie = cookieFrom(signupRes)

    const res = await app.request('/api/admin/queues', { headers: { Cookie: cookie } })

    expect(res.status).toBe(403)
  })

  it('should serve the Bull Board dashboard to a staff session', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('admin-queues-staff')
    const signupRes = await signUpAsStaff(app, email)
    const cookie = cookieFrom(signupRes)

    const res = await app.request('/api/admin/queues', { headers: { Cookie: cookie } })
    const html = await res.text()

    expect(res.status).toBe(200)
    // Bull Board's entry handler renders HTML that injects a <base href> for
    // the dashboard root + the React mount node.
    expect(html).toContain('<base href="/api/admin/queues/"')
    expect(html).toContain('id="root"')
  })

  it('should 301-redirect a trailing-slash request to the canonical no-slash URL', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('admin-queues-trail')
    const signupRes = await signUpAsStaff(app, email)
    const cookie = cookieFrom(signupRes)

    // Hono treats `/path` and `/path/` as distinct routes by default — without
    // trimTrailingSlash() this would 404. The middleware redirects on 404 so
    // operators pasting the trailing-slash variant get a smooth experience.
    const res = await app.request('/api/admin/queues/', {
      headers: { Cookie: cookie },
      redirect: 'manual'
    })

    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toMatch(/\/api\/admin\/queues$/)
  })

  it('should serve the queues JSON API to a staff session', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const email = uniqueEmail('admin-queues-api')
    const signupRes = await signUpAsStaff(app, email)
    const cookie = cookieFrom(signupRes)

    const res = await app.request('/api/admin/queues/api/queues', { headers: { Cookie: cookie } })
    const body = (await res.json()) as { queues: Array<{ name: string }> }

    expect(res.status).toBe(200)
    expect(body.queues.map((q) => q.name).sort()).toEqual([
      'emails',
      'internal',
      'outbox-publisher',
      'schedules'
    ])
  })
})
