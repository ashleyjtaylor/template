import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app.js'
import { prisma } from '@/lib/db.js'

const ORIGIN = 'http://localhost:3000'

const uniqueEmail = (label: string) => `${label}-${crypto.randomUUID()}@example.com`

const cookieFrom = (res: Response) => res.headers.get('set-cookie') ?? ''

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

const signUpViaOrgs = (
  app: ReturnType<typeof createApp>,
  email: string,
  organisationName: string,
  password = 'abcd1234'
) =>
  app.request('/api/orgs/sign-up', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({
      email,
      password,
      firstname: 'Owner',
      lastname: 'User',
      organisationName
    })
  })

const createOrgFor = async (app: ReturnType<typeof createApp>, cookie: string, name: string) => {
  const res = await app.request('/api/orgs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
    body: JSON.stringify({ name })
  })

  expect(res.status).toBe(200)

  return (await res.json()) as {
    organisation: { entityId: string; name: string }
    membership: { entityId: string; role: string }
  }
}

interface SignedUp {
  cookie: string
  email: string
  user: { id: string; entityId: string }
}

const signUpAndAuth = async (
  app: ReturnType<typeof createApp>,
  label: string
): Promise<SignedUp> => {
  const email = uniqueEmail(label)
  const res = await signUp(app, email)
  const cookie = cookieFrom(res)
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, entityId: true }
  })

  return { cookie, email, user }
}

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/orgs/sign-up', () => {
  it('should create a user, organisation, and owner membership in one transaction', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const email = uniqueEmail('orgsignup-happy')

    const res = await signUpViaOrgs(app, email, 'Acme Corp')
    expect(res.status).toBe(200)

    const cookie = cookieFrom(res)
    expect(cookie).toContain('better-auth.session_token=')

    const body = (await res.json()) as {
      user: { entityId: string; email: string }
      organisation: { entityId: string; name: string }
      membership: { role: string }
    }

    expect(body.user.email).toBe(email)
    expect(body.organisation.entityId).toMatch(/^org_[0-9a-f-]{36}$/)
    expect(body.organisation.name).toBe('Acme Corp')
    expect(body.membership.role).toBe('owner')

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'organisation.created', resourceId: body.organisation.entityId }
    })
    expect(audit?.actorUserId).toBe(body.user.entityId)
  })

  it('should forward better-auth status when the email is already registered', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const email = uniqueEmail('orgsignup-dup')

    await signUpViaOrgs(app, email, 'First Org')
    const second = await signUpViaOrgs(app, email, 'Second Org')

    expect([409, 422]).toContain(second.status)
  })

  it('should return 400 when the body carries unexpected fields like inviteToken', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })

    const res = await app.request('/api/orgs/sign-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({
        email: uniqueEmail('orgsignup-strict'),
        password: 'abcd1234',
        firstname: 'A',
        lastname: 'B',
        organisationName: 'Org',
        inviteToken: 'should-be-rejected'
      })
    })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/orgs', () => {
  it('should create an additional org with the caller as owner', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie, user } = await signUpAndAuth(app, 'orgs-create')

    const result = await createOrgFor(app, cookie, 'Side Project')
    expect(result.organisation.entityId).toMatch(/^org_[0-9a-f-]{36}$/)
    expect(result.membership.role).toBe('owner')

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'organisation.created', resourceId: result.organisation.entityId }
    })
    expect(audit?.actorUserId).toBe(user.entityId)
  })

  it('should return 401 without a session', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })

    const res = await app.request('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ name: 'Anon Org' })
    })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/orgs', () => {
  it('should list every org the caller is a member of', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie } = await signUpAndAuth(app, 'orgs-list')

    await createOrgFor(app, cookie, 'Org A')
    await createOrgFor(app, cookie, 'Org B')

    const res = await app.request('/api/orgs', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)

    const body = (await res.json()) as Array<{
      organisation: { name: string }
      membership: { role: string }
    }>

    expect(body.map((o) => o.organisation.name).sort()).toEqual(['Org A', 'Org B'])
    expect(body.every((o) => o.membership.role === 'owner')).toBe(true)
  })
})

describe('GET /api/orgs/:orgId', () => {
  it('should return 200 for a member', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie } = await signUpAndAuth(app, 'orgs-get-member')
    const { organisation } = await createOrgFor(app, cookie, 'Visible Org')

    const res = await app.request(`/api/orgs/${organisation.entityId}`, {
      headers: { Cookie: cookie }
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { organisation: { name: string } }
    expect(body.organisation.name).toBe('Visible Org')
  })

  it('should return 404 for a non-member (no enumeration)', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie: ownerCookie } = await signUpAndAuth(app, 'orgs-get-owner')
    const { organisation } = await createOrgFor(app, ownerCookie, 'Private Org')

    const { cookie: outsiderCookie } = await signUpAndAuth(app, 'orgs-get-outsider')

    const res = await app.request(`/api/orgs/${organisation.entityId}`, {
      headers: { Cookie: outsiderCookie }
    })

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/orgs/:orgId', () => {
  it('should let an owner rename the org and write an audit row', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie, user } = await signUpAndAuth(app, 'orgs-patch-owner')
    const { organisation } = await createOrgFor(app, cookie, 'Old Name')

    const res = await app.request(`/api/orgs/${organisation.entityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({ name: 'New Name' })
    })
    expect(res.status).toBe(200)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'organisation.name_changed', resourceId: organisation.entityId }
    })
    expect(audit?.actorUserId).toBe(user.entityId)
    expect(audit?.details).toMatchObject({ before: 'Old Name', after: 'New Name' })
  })

  it('should return 403 for a member without admin role', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie: ownerCookie } = await signUpAndAuth(app, 'orgs-patch-owner-2')
    const { organisation } = await createOrgFor(app, ownerCookie, 'Owned')

    const memberSignup = await signUpAndAuth(app, 'orgs-patch-member')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: organisation.entityId,
        userId: memberSignup.user.id,
        role: 'member'
      }
    })

    const res = await app.request(`/api/orgs/${organisation.entityId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: memberSignup.cookie
      },
      body: JSON.stringify({ name: 'Hacked' })
    })

    expect(res.status).toBe(403)
  })
})

describe('GET /api/orgs/:orgId/members', () => {
  it('should list all memberships with user details', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie: ownerCookie } = await signUpAndAuth(app, 'members-list-owner')
    const { organisation } = await createOrgFor(app, ownerCookie, 'Team Org')

    const memberSignup = await signUpAndAuth(app, 'members-list-other')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: organisation.entityId,
        userId: memberSignup.user.id,
        role: 'member'
      }
    })

    const res = await app.request(`/api/orgs/${organisation.entityId}/members`, {
      headers: { Cookie: ownerCookie }
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as Array<{
      membership: { role: string }
      user: { entityId: string; email: string }
    }>

    expect(body.length).toBe(2)
    expect(body.map((m) => m.membership.role).sort()).toEqual(['member', 'owner'])
  })
})

describe('PATCH /api/orgs/:orgId/members/:userId', () => {
  it('should let an owner promote a member to admin and write an audit row', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie: ownerCookie, user: owner } = await signUpAndAuth(app, 'role-owner')
    const { organisation } = await createOrgFor(app, ownerCookie, 'Org')
    const target = await signUpAndAuth(app, 'role-target')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: organisation.entityId,
        userId: target.user.id,
        role: 'member'
      }
    })

    const res = await app.request(
      `/api/orgs/${organisation.entityId}/members/${target.user.entityId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: ownerCookie },
        body: JSON.stringify({ role: 'admin' })
      }
    )
    expect(res.status).toBe(200)

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'organisation.member.role_changed',
        resourceId: organisation.entityId
      },
      orderBy: { createdAt: 'desc' }
    })
    expect(audit?.actorUserId).toBe(owner.entityId)
    expect(audit?.details).toMatchObject({
      targetUserId: target.user.entityId,
      before: 'member',
      after: 'admin'
    })
  })

  it('should return 403 when an admin attempts to change roles', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie: ownerCookie } = await signUpAndAuth(app, 'role-owner-2')
    const { organisation } = await createOrgFor(app, ownerCookie, 'Org')

    const adminSignup = await signUpAndAuth(app, 'role-admin')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: organisation.entityId,
        userId: adminSignup.user.id,
        role: 'admin'
      }
    })

    const target = await signUpAndAuth(app, 'role-target-2')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: organisation.entityId,
        userId: target.user.id,
        role: 'member'
      }
    })

    const res = await app.request(
      `/api/orgs/${organisation.entityId}/members/${target.user.entityId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: adminSignup.cookie
        },
        body: JSON.stringify({ role: 'admin' })
      }
    )

    expect(res.status).toBe(403)
  })

  it('should return 409 when the only owner is being demoted', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie, user } = await signUpAndAuth(app, 'role-last-owner')
    const { organisation } = await createOrgFor(app, cookie, 'Org')

    const res = await app.request(`/api/orgs/${organisation.entityId}/members/${user.entityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({ role: 'member' })
    })
    expect(res.status).toBe(409)

    const body = (await res.json()) as { details?: { reason?: string } }
    expect(body.details?.reason).toBe('LastOwnerRequired')
  })
})

describe('DELETE /api/orgs/:orgId/members/:userId', () => {
  it('should let an admin remove a member', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie: ownerCookie } = await signUpAndAuth(app, 'remove-owner')
    const { organisation } = await createOrgFor(app, ownerCookie, 'Org')

    const adminSignup = await signUpAndAuth(app, 'remove-admin')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: organisation.entityId,
        userId: adminSignup.user.id,
        role: 'admin'
      }
    })

    const target = await signUpAndAuth(app, 'remove-target')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: organisation.entityId,
        userId: target.user.id,
        role: 'member'
      }
    })

    const res = await app.request(
      `/api/orgs/${organisation.entityId}/members/${target.user.entityId}`,
      { method: 'DELETE', headers: { Cookie: adminSignup.cookie } }
    )
    expect(res.status).toBe(204)

    const remaining = await prisma.membership.findMany({
      where: { organisationId: organisation.entityId }
    })
    expect(remaining.length).toBe(2)
  })

  it('should return 403 when an admin attempts to remove another admin', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie: ownerCookie } = await signUpAndAuth(app, 'remove-owner-2')
    const { organisation } = await createOrgFor(app, ownerCookie, 'Org')

    const a = await signUpAndAuth(app, 'remove-admin-a')
    const b = await signUpAndAuth(app, 'remove-admin-b')

    for (const u of [a, b]) {
      await prisma.membership.create({
        data: {
          entityId: `memb_${crypto.randomUUID()}`,
          organisationId: organisation.entityId,
          userId: u.user.id,
          role: 'admin'
        }
      })
    }

    const res = await app.request(`/api/orgs/${organisation.entityId}/members/${b.user.entityId}`, {
      method: 'DELETE',
      headers: { Cookie: a.cookie }
    })

    expect(res.status).toBe(403)
  })

  it('should return 409 when removing the only owner', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie, user } = await signUpAndAuth(app, 'remove-last-owner')
    const { organisation } = await createOrgFor(app, cookie, 'Org')

    const res = await app.request(`/api/orgs/${organisation.entityId}/members/${user.entityId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(409)
  })
})

describe('POST /api/orgs/:orgId/leave', () => {
  it('should let a member leave', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie: ownerCookie } = await signUpAndAuth(app, 'leave-owner')
    const { organisation } = await createOrgFor(app, ownerCookie, 'Org')

    const memberSignup = await signUpAndAuth(app, 'leave-member')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: organisation.entityId,
        userId: memberSignup.user.id,
        role: 'member'
      }
    })

    const res = await app.request(`/api/orgs/${organisation.entityId}/leave`, {
      method: 'POST',
      headers: { Cookie: memberSignup.cookie }
    })
    expect(res.status).toBe(204)

    const after = await prisma.membership.findUnique({
      where: {
        organisationId_userId: {
          organisationId: organisation.entityId,
          userId: memberSignup.user.id
        }
      }
    })
    expect(after).toBeNull()
  })

  it('should return 409 when the sole owner tries to leave', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie } = await signUpAndAuth(app, 'leave-last-owner')
    const { organisation } = await createOrgFor(app, cookie, 'Org')

    const res = await app.request(`/api/orgs/${organisation.entityId}/leave`, {
      method: 'POST',
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(409)
  })
})

describe('POST /api/orgs/:orgId/transfer-ownership', () => {
  it('should atomically promote target to owner and demote caller to admin', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie: ownerCookie, user: owner } = await signUpAndAuth(app, 'transfer-owner')
    const { organisation } = await createOrgFor(app, ownerCookie, 'Org')

    const target = await signUpAndAuth(app, 'transfer-target')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: organisation.entityId,
        userId: target.user.id,
        role: 'member'
      }
    })

    const res = await app.request(`/api/orgs/${organisation.entityId}/transfer-ownership`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: ownerCookie },
      body: JSON.stringify({ newOwnerUserId: target.user.entityId })
    })
    expect(res.status).toBe(200)

    const both = await prisma.membership.findMany({
      where: { organisationId: organisation.entityId }
    })

    const ownerRow = both.find((m) => m.userId === owner.id)
    const targetRow = both.find((m) => m.userId === target.user.id)
    expect(ownerRow?.role).toBe('admin')
    expect(targetRow?.role).toBe('owner')

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'organisation.ownership.transferred',
        resourceId: organisation.entityId
      }
    })
    expect(audit?.actorUserId).toBe(owner.entityId)
    expect(audit?.details).toMatchObject({ targetUserId: target.user.entityId })
  })

  it('should return 403 for a non-owner', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'development' })
    const { cookie: ownerCookie } = await signUpAndAuth(app, 'transfer-owner-2')
    const { organisation } = await createOrgFor(app, ownerCookie, 'Org')

    const adminSignup = await signUpAndAuth(app, 'transfer-admin')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: organisation.entityId,
        userId: adminSignup.user.id,
        role: 'admin'
      }
    })

    const target = await signUpAndAuth(app, 'transfer-target-2')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId: organisation.entityId,
        userId: target.user.id,
        role: 'member'
      }
    })

    const res = await app.request(`/api/orgs/${organisation.entityId}/transfer-ownership`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: adminSignup.cookie },
      body: JSON.stringify({ newOwnerUserId: target.user.entityId })
    })

    expect(res.status).toBe(403)
  })
})
