import { prisma } from '@template/db'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app.js'

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

interface SignedUp {
  cookie: string
  email: string
  user: { id: string; entityId: string }
}

const signUpAndAuth = async (
  app: ReturnType<typeof createApp>,
  label: string,
  emailOverride?: string
): Promise<SignedUp> => {
  const email = emailOverride ?? uniqueEmail(label)
  const res = await signUp(app, email)
  const cookie = cookieFrom(res)
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, entityId: true }
  })

  return { cookie, email, user }
}

const createOrgWithOwner = async (app: ReturnType<typeof createApp>, label: string) => {
  const owner = await signUpAndAuth(app, label)
  const res = await app.request('/api/orgs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: owner.cookie },
    body: JSON.stringify({ name: `${label} org` })
  })
  expect(res.status).toBe(200)

  const body = (await res.json()) as { organisation: { entityId: string } }

  return { owner, organisationId: body.organisation.entityId }
}

const inviteAs = (
  app: ReturnType<typeof createApp>,
  cookie: string,
  organisationId: string,
  email: string,
  role: 'admin' | 'member'
) =>
  app.request(`/api/orgs/${organisationId}/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
    body: JSON.stringify({ email, role })
  })

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/orgs/:orgId/invitations', () => {
  it('should let an owner create an invitation and return a one-time link', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'invite-create-happy')

    const inviteeEmail = uniqueEmail('invitee')
    const res = await inviteAs(app, owner.cookie, organisationId, inviteeEmail, 'member')
    expect(res.status).toBe(201)

    const body = (await res.json()) as {
      invitation: { entityId: string; email: string; role: string }
      link: string
    }

    expect(body.invitation.entityId).toMatch(/^inv_[0-9a-f-]{36}$/)
    expect(body.invitation.email).toBe(inviteeEmail)
    expect(body.invitation.role).toBe('member')
    expect(body.link).toMatch(/^\/accept-invite\?token=[A-Za-z0-9_-]{43}$/)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'organisation.member.invited', resourceId: organisationId }
    })
    expect(audit?.actorUserId).toBe(owner.user.entityId)

    // The transactional emit should have written an `invitation.created`
    // outbox row in the same transaction as the invitation insert. The
    // outbox publisher (worker) drains it asynchronously; we only assert
    // the row exists with the right shape here.
    const outbox = await prisma.outbox.findFirst({
      where: { topic: 'invitation.created' },
      orderBy: { createdAt: 'desc' }
    })
    expect(outbox?.entityId).toMatch(/^obx_/)
    expect(outbox?.targetQueue).toBe('internal')
    expect(outbox?.payload).toMatchObject({
      type: 'invitation.created',
      invitationId: body.invitation.entityId,
      organisationId,
      email: inviteeEmail,
      role: 'member'
    })
  })

  it('should let an admin invite a member', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'invite-admin-member')

    const adminSignup = await signUpAndAuth(app, 'invite-admin')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId,
        userId: adminSignup.user.id,
        role: 'admin'
      }
    })
    void owner

    const res = await inviteAs(
      app,
      adminSignup.cookie,
      organisationId,
      uniqueEmail('member'),
      'member'
    )

    expect(res.status).toBe(201)
  })

  it('should return 403 when an admin tries to invite an admin', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { organisationId } = await createOrgWithOwner(app, 'invite-admin-admin')

    const adminSignup = await signUpAndAuth(app, 'invite-admin-2')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId,
        userId: adminSignup.user.id,
        role: 'admin'
      }
    })

    const res = await inviteAs(
      app,
      adminSignup.cookie,
      organisationId,
      uniqueEmail('badrole'),
      'admin'
    )

    expect(res.status).toBe(403)
  })

  it('should return 409 when an outstanding invitation already exists for that email', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'invite-dup')

    const email = uniqueEmail('dup')
    const first = await inviteAs(app, owner.cookie, organisationId, email, 'member')
    expect(first.status).toBe(201)

    const second = await inviteAs(app, owner.cookie, organisationId, email, 'member')
    expect(second.status).toBe(409)

    const body = (await second.json()) as { details?: { reason?: string } }
    expect(body.details?.reason).toBe('OutstandingInvitationExists')
  })

  it('should return 403 when a member tries to invite anyone', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { organisationId } = await createOrgWithOwner(app, 'invite-member-forbidden')

    const memberSignup = await signUpAndAuth(app, 'invite-member')
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId,
        userId: memberSignup.user.id,
        role: 'member'
      }
    })

    const res = await inviteAs(
      app,
      memberSignup.cookie,
      organisationId,
      uniqueEmail('blocked'),
      'member'
    )

    expect(res.status).toBe(403)
  })
})

describe('GET /api/orgs/:orgId/invitations', () => {
  it('should default to pending only and never expose tokens', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'invite-list-default')

    await inviteAs(app, owner.cookie, organisationId, uniqueEmail('p1'), 'member')
    await inviteAs(app, owner.cookie, organisationId, uniqueEmail('p2'), 'member')

    const res = await app.request(`/api/orgs/${organisationId}/invitations`, {
      headers: { Cookie: owner.cookie }
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as Array<{
      invitation: Record<string, unknown>
      invitedBy: { entityId: string; email: string }
    }>

    expect(body.length).toBe(2)
    for (const row of body) {
      expect(row.invitation).not.toHaveProperty('tokenHash')
      expect(row.invitation).not.toHaveProperty('requestId')
      expect(row.invitedBy.entityId).toBe(owner.user.entityId)
    }
  })

  it('should include accepted/revoked/expired rows when status=all', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'invite-list-all')

    const create = await inviteAs(
      app,
      owner.cookie,
      organisationId,
      uniqueEmail('to-revoke'),
      'member'
    )
    const created = (await create.json()) as { invitation: { entityId: string } }
    await prisma.invitation.update({
      where: { entityId: created.invitation.entityId },
      data: { revokedAt: new Date() }
    })

    const pendingRes = await app.request(`/api/orgs/${organisationId}/invitations`, {
      headers: { Cookie: owner.cookie }
    })
    const pendingBody = (await pendingRes.json()) as Array<unknown>
    expect(pendingBody.length).toBe(0)

    const allRes = await app.request(`/api/orgs/${organisationId}/invitations?status=all`, {
      headers: { Cookie: owner.cookie }
    })
    const allBody = (await allRes.json()) as Array<unknown>
    expect(allBody.length).toBe(1)
  })
})

describe('DELETE /api/orgs/:orgId/invitations/:invitationId', () => {
  it('should revoke a pending invite and write an audit row', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'invite-revoke')

    const create = await inviteAs(
      app,
      owner.cookie,
      organisationId,
      uniqueEmail('to-revoke'),
      'member'
    )
    const created = (await create.json()) as { invitation: { entityId: string } }

    const res = await app.request(
      `/api/orgs/${organisationId}/invitations/${created.invitation.entityId}`,
      { method: 'DELETE', headers: { Cookie: owner.cookie } }
    )
    expect(res.status).toBe(204)

    const row = await prisma.invitation.findUnique({
      where: { entityId: created.invitation.entityId }
    })
    expect(row?.revokedAt).not.toBeNull()

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'organisation.invitation.revoked', resourceId: organisationId }
    })
    expect(audit?.actorUserId).toBe(owner.user.entityId)
  })
})

describe('GET /api/invitations/:token', () => {
  it('should return a public preview without revealing the token', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'invite-preview')

    const create = await inviteAs(
      app,
      owner.cookie,
      organisationId,
      uniqueEmail('preview'),
      'admin'
    )
    const body = (await create.json()) as { link: string }
    const token = new URL(body.link, ORIGIN).searchParams.get('token') ?? ''

    const res = await app.request(`/api/invitations/${token}`)
    expect(res.status).toBe(200)

    const preview = (await res.json()) as {
      organisation: { entityId: string; name: string }
      role: string
      email: string
      status: string
    }

    expect(preview.organisation.entityId).toBe(organisationId)
    expect(preview.role).toBe('admin')
    expect(preview.status).toBe('pending')
  })

  it('should return 404 for an unknown token', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })

    const res = await app.request('/api/invitations/not-a-real-token')

    expect(res.status).toBe(404)
  })
})

describe('POST /api/invitations/:token/accept', () => {
  const tokenFromCreateBody = (body: { link: string }) =>
    new URL(body.link, ORIGIN).searchParams.get('token') ?? ''

  it('should create a membership for a matching invitee and write an audit row', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'accept-happy')

    const inviteeEmail = uniqueEmail('happy-invitee')
    const create = await inviteAs(app, owner.cookie, organisationId, inviteeEmail, 'admin')
    const token = tokenFromCreateBody((await create.json()) as { link: string })

    const invitee = await signUpAndAuth(app, 'happy-invitee', inviteeEmail)

    const res = await app.request(`/api/invitations/${token}/accept`, {
      method: 'POST',
      headers: { Cookie: invitee.cookie }
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      organisation: { entityId: string }
      membership: { role: string }
      alreadyMember: boolean
    }
    expect(body.organisation.entityId).toBe(organisationId)
    expect(body.membership.role).toBe('admin')
    expect(body.alreadyMember).toBe(false)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'organisation.invitation.accepted', resourceId: organisationId }
    })
    expect(audit?.details).toMatchObject({ alreadyMember: false })
  })

  it('should return 403 when the invitee email does not match the session', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'accept-mismatch')

    const create = await inviteAs(
      app,
      owner.cookie,
      organisationId,
      uniqueEmail('intended'),
      'member'
    )
    const token = tokenFromCreateBody((await create.json()) as { link: string })

    const otherUser = await signUpAndAuth(app, 'mismatch-other')

    const res = await app.request(`/api/invitations/${token}/accept`, {
      method: 'POST',
      headers: { Cookie: otherUser.cookie }
    })
    expect(res.status).toBe(403)

    const body = (await res.json()) as { details?: { reason?: string } }
    expect(body.details?.reason).toBe('InvitationEmailMismatch')
  })

  it('should consume the invite without creating a duplicate membership when already a member', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'accept-already')

    const inviteeEmail = uniqueEmail('already')
    const invitee = await signUpAndAuth(app, 'already-invitee', inviteeEmail)
    await prisma.membership.create({
      data: {
        entityId: `memb_${crypto.randomUUID()}`,
        organisationId,
        userId: invitee.user.id,
        role: 'member'
      }
    })

    const create = await inviteAs(app, owner.cookie, organisationId, inviteeEmail, 'admin')
    const token = tokenFromCreateBody((await create.json()) as { link: string })

    const res = await app.request(`/api/invitations/${token}/accept`, {
      method: 'POST',
      headers: { Cookie: invitee.cookie }
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { alreadyMember: boolean }
    expect(body.alreadyMember).toBe(true)

    const memberships = await prisma.membership.findMany({
      where: { organisationId, userId: invitee.user.id }
    })
    expect(memberships.length).toBe(1)
    expect(memberships[0]?.role).toBe('member')

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'organisation.invitation.accepted', resourceId: organisationId }
    })
    expect(audit?.details).toMatchObject({ alreadyMember: true })
  })

  it('should return 409 for an expired invite', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'accept-expired')

    const inviteeEmail = uniqueEmail('expired-invitee')
    const create = await inviteAs(app, owner.cookie, organisationId, inviteeEmail, 'member')
    const created = (await create.json()) as { invitation: { entityId: string }; link: string }
    const token = tokenFromCreateBody(created)

    await prisma.invitation.update({
      where: { entityId: created.invitation.entityId },
      data: { expiresAt: new Date(Date.now() - 1000) }
    })

    const invitee = await signUpAndAuth(app, 'expired-invitee', inviteeEmail)

    const res = await app.request(`/api/invitations/${token}/accept`, {
      method: 'POST',
      headers: { Cookie: invitee.cookie }
    })
    expect(res.status).toBe(409)

    const body = (await res.json()) as { details?: { reason?: string } }
    expect(body.details?.reason).toBe('Expired')
  })

  it('should return 409 for a revoked invite', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'accept-revoked')

    const inviteeEmail = uniqueEmail('revoked-invitee')
    const create = await inviteAs(app, owner.cookie, organisationId, inviteeEmail, 'member')
    const created = (await create.json()) as { invitation: { entityId: string }; link: string }
    const token = tokenFromCreateBody(created)

    await prisma.invitation.update({
      where: { entityId: created.invitation.entityId },
      data: { revokedAt: new Date() }
    })

    const invitee = await signUpAndAuth(app, 'revoked-invitee', inviteeEmail)

    const res = await app.request(`/api/invitations/${token}/accept`, {
      method: 'POST',
      headers: { Cookie: invitee.cookie }
    })
    expect(res.status).toBe(409)

    const body = (await res.json()) as { details?: { reason?: string } }
    expect(body.details?.reason).toBe('AlreadyRevoked')
  })

  it('should return 401 without a session', async () => {
    const app = createApp({ gitSha: 'test', appEnv: 'local' })
    const { owner, organisationId } = await createOrgWithOwner(app, 'accept-unauth')

    const create = await inviteAs(
      app,
      owner.cookie,
      organisationId,
      uniqueEmail('unauth'),
      'member'
    )
    const token = tokenFromCreateBody((await create.json()) as { link: string })

    const res = await app.request(`/api/invitations/${token}/accept`, { method: 'POST' })

    expect(res.status).toBe(401)
  })
})
