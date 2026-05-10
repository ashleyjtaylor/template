import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app.js'
import { prisma } from '@/lib/db.js'

// Integration tests for the better-auth-mounted /api/auth/* routes against a real
// Postgres (Compose locally, postgres service container in CI). Each test uses
// a fresh email so no per-test DB cleanup is needed.

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

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/auth/sign-up/email', () => {
  it('should create a user with a usr_-prefixed entityId and set a session cookie', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const email = uniqueEmail('signup-happy')

    const res = await signUp(app, email)

    expect(res.status).toBe(200)
    expect(cookieFrom(res)).toContain('better-auth.session_token=')

    const requestId = res.headers.get('x-request-id')
    expect(requestId).toMatch(/^req_[0-9a-f-]{36}$/)

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { sessions: true, accounts: true }
    })

    expect(user.entityId).toMatch(/^usr_[0-9a-f-]{36}$/)
    expect(user.firstname).toBe('Test')
    expect(user.lastname).toBe('User')
    expect(user.requestId).toBe(requestId)
    expect(user.sessions[0]?.requestId).toBe(requestId)
    expect(user.accounts[0]?.requestId).toBe(requestId)

    const audits = await prisma.auditLog.findMany({
      where: { actorUserId: user.entityId },
      orderBy: { createdAt: 'asc' }
    })

    expect(audits.map((a) => a.action)).toEqual(['user.signed_up', 'user.logged_in'])
    expect(audits[0]?.requestId).toBe(requestId)
    expect(audits[0]?.entityId).toMatch(/^aud_[0-9a-f-]{36}$/)
    expect(audits[0]?.details).toMatchObject({
      action: 'user.signed_up',
      email,
      firstname: 'Test',
      lastname: 'User'
    })
    expect(audits[1]?.requestId).toBe(requestId)
  })

  it('should return 422 when the email is already registered', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const email = uniqueEmail('signup-dup')

    const first = await signUp(app, email)
    expect(first.status).toBe(200)

    const second = await signUp(app, email)
    expect(second.status).toBe(422)
  })

  it('should return 400 when the password is shorter than 8 chars', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const email = uniqueEmail('signup-weak')

    const res = await signUp(app, email, 'short')

    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/sign-in/email', () => {
  it('should sign in an existing user and set a session cookie', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const email = uniqueEmail('signin-happy')
    await signUp(app, email)

    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email, password: 'abcd1234' })
    })

    expect(res.status).toBe(200)
    expect(cookieFrom(res)).toContain('better-auth.session_token=')

    const requestId = res.headers.get('x-request-id')
    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    const loginAudits = await prisma.auditLog.findMany({
      where: { actorUserId: user.entityId, action: 'user.logged_in' },
      orderBy: { createdAt: 'asc' }
    })

    expect(loginAudits).toHaveLength(2)
    expect(loginAudits[1]?.requestId).toBe(requestId)
  })

  it('should return 401 on wrong password', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const email = uniqueEmail('signin-wrong')
    await signUp(app, email)

    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email, password: 'WRONG-pwd' })
    })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/auth/get-session', () => {
  it('should return the user and session when called with a valid cookie', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const email = uniqueEmail('session-cookie')
    const signupRes = await signUp(app, email)
    const cookie = cookieFrom(signupRes)

    const res = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { email: string }; session: { token: string } }
    expect(body.user.email).toBe(email)
    expect(body.session.token).toBeTruthy()
  })

  it('should return null when called without a cookie', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })

    const res = await app.request('/api/auth/get-session')

    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })
})

describe('POST /api/auth/sign-out', () => {
  it('should delete the session and cause subsequent get-session to return null', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const email = uniqueEmail('signout')
    const signupRes = await signUp(app, email)
    const cookie = cookieFrom(signupRes)

    const res = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(200)

    const after = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })
    expect(after.status).toBe(200)
    expect(await after.json()).toBeNull()

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    const audits = await prisma.auditLog.findMany({
      where: { actorUserId: user.entityId },
      orderBy: { createdAt: 'asc' }
    })

    expect(audits.map((a) => a.action)).toEqual([
      'user.signed_up',
      'user.logged_in',
      'user.logged_out'
    ])
    expect(audits[2]?.requestId).toBe(res.headers.get('x-request-id'))
  })
})
