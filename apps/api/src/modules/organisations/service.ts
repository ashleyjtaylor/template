import type { Invitation, Membership, Organisation, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db.js'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors.js'
import { getRequestId } from '@/lib/logger.js'
import { writeAudit } from '@/modules/audit-log/service.js'
import type { Role } from '@/modules/organisations/schemas.js'
import { generateInviteToken, hashToken } from '@/modules/organisations/tokens.js'

const orgEntityId = () => `org_${crypto.randomUUID()}`

const memberEntityId = () => `memb_${crypto.randomUUID()}`

const inviteEntityId = () => `inv_${crypto.randomUUID()}`

const INVITE_TTL_DAYS = 7

const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000

export interface MembershipSnapshot {
  userId: string
  role: Role
}

export interface RoleMutation {
  userId: string
  nextRole: Role | null
}

export const wouldStillHaveOwner = (
  memberships: readonly MembershipSnapshot[],
  mutations: readonly RoleMutation[]
): boolean => {
  const byUser = new Map(mutations.map((m) => [m.userId, m.nextRole]))

  return memberships.some((m) => {
    if (byUser.has(m.userId)) {
      return byUser.get(m.userId) === 'owner'
    }

    return m.role === 'owner'
  })
}

const assertLastOwner = async (
  tx: Prisma.TransactionClient,
  orgId: string,
  mutations: readonly RoleMutation[]
) => {
  const memberships = await tx.membership.findMany({
    where: { organisationId: orgId },
    select: { userId: true, role: true }
  })

  const snapshot = memberships.map((m) => ({ userId: m.userId, role: m.role as Role }))

  if (!wouldStillHaveOwner(snapshot, mutations)) {
    throw new ConflictError('At least one owner is required', { reason: 'LastOwnerRequired' })
  }
}

const findUserByEntityId = async (entityId: string) => {
  const user = await prisma.user.findUnique({
    where: { entityId },
    select: { id: true, entityId: true, email: true, firstname: true, lastname: true }
  })

  if (!user) throw new NotFoundError('User not found')

  return user
}

export const getMembership = async (orgId: string, userId: string): Promise<Membership | null> =>
  prisma.membership.findUnique({
    where: { organisationId_userId: { organisationId: orgId, userId } }
  })

export const getOrgById = async (orgId: string): Promise<Organisation | null> =>
  prisma.organisation.findUnique({ where: { entityId: orgId } })

export const listMyOrgs = async (userId: string) => {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { organisation: true },
    orderBy: { createdAt: 'desc' }
  })

  return memberships.map((m) => ({
    organisation: m.organisation,
    membership: { role: m.role, createdAt: m.createdAt }
  }))
}

export const getOrgWithMembership = async (orgId: string, userId: string) => {
  const membership = await getMembership(orgId, userId)

  if (!membership) return null

  const organisation = await prisma.organisation.findUnique({ where: { entityId: orgId } })

  if (!organisation) return null

  return { organisation, membership }
}

const insertOrgWithOwner = async (
  tx: Prisma.TransactionClient,
  name: string,
  ownerUserId: string
): Promise<{ organisation: Organisation; membership: Membership }> => {
  const requestId = getRequestId() ?? null

  const organisation = await tx.organisation.create({
    data: {
      entityId: orgEntityId(),
      name: name.trim(),
      requestId
    }
  })

  const membership = await tx.membership.create({
    data: {
      entityId: memberEntityId(),
      organisationId: organisation.entityId,
      userId: ownerUserId,
      role: 'owner',
      requestId
    }
  })

  return { organisation, membership }
}

export const createOrg = async (name: string, ownerUserId: string, actorEntityId: string) => {
  const result = await prisma.$transaction((tx) => insertOrgWithOwner(tx, name, ownerUserId))

  await writeAudit({
    action: 'organisation.created',
    actorUserId: actorEntityId,
    resourceId: result.organisation.entityId,
    name: result.organisation.name
  })

  return result
}

export const updateOrgName = async (orgId: string, newName: string, actorEntityId: string) => {
  const before = await prisma.organisation.findUnique({ where: { entityId: orgId } })

  if (!before) throw new NotFoundError('Organisation not found')

  const trimmed = newName.trim()

  if (trimmed === before.name) return before

  const updated = await prisma.organisation.update({
    where: { entityId: orgId },
    data: { name: trimmed }
  })

  await writeAudit({
    action: 'organisation.name_changed',
    actorUserId: actorEntityId,
    resourceId: orgId,
    before: before.name,
    after: updated.name
  })

  return updated
}

export const listMembers = async (orgId: string) => {
  const memberships = await prisma.membership.findMany({
    where: { organisationId: orgId },
    include: {
      user: {
        select: { entityId: true, email: true, firstname: true, lastname: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  })

  return memberships.map((m) => ({ membership: m, user: m.user }))
}

export const changeRole = async (
  orgId: string,
  targetUserEntityId: string,
  newRole: Role,
  actor: { entityId: string; role: Role }
) => {
  if (actor.role !== 'owner') {
    throw new ForbiddenError('Only an owner can change roles', { reason: 'InsufficientRole' })
  }

  const targetUser = await findUserByEntityId(targetUserEntityId)

  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.membership.findUnique({
      where: { organisationId_userId: { organisationId: orgId, userId: targetUser.id } }
    })

    if (!target) throw new NotFoundError('Member not found')

    if (target.role === newRole) {
      return { membership: target, before: target.role as Role, changed: false }
    }

    await assertLastOwner(tx, orgId, [{ userId: targetUser.id, nextRole: newRole }])

    const updated = await tx.membership.update({
      where: { organisationId_userId: { organisationId: orgId, userId: targetUser.id } },
      data: { role: newRole }
    })

    return { membership: updated, before: target.role as Role, changed: true }
  })

  if (result.changed) {
    await writeAudit({
      action: 'organisation.member.role_changed',
      actorUserId: actor.entityId,
      resourceId: orgId,
      targetUserId: targetUser.entityId,
      before: result.before,
      after: newRole
    })
  }

  return result.membership
}

export const removeMember = async (
  orgId: string,
  targetUserEntityId: string,
  actor: { entityId: string; role: Role }
) => {
  const targetUser = await findUserByEntityId(targetUserEntityId)

  await prisma.$transaction(async (tx) => {
    const target = await tx.membership.findUnique({
      where: { organisationId_userId: { organisationId: orgId, userId: targetUser.id } }
    })

    if (!target) throw new NotFoundError('Member not found')

    if (target.role !== 'member' && actor.role !== 'owner') {
      throw new ForbiddenError('Only an owner can remove an admin or owner', {
        reason: 'InsufficientRole'
      })
    }

    await assertLastOwner(tx, orgId, [{ userId: targetUser.id, nextRole: null }])

    await tx.membership.delete({
      where: { organisationId_userId: { organisationId: orgId, userId: targetUser.id } }
    })
  })

  await writeAudit({
    action: 'organisation.member.removed',
    actorUserId: actor.entityId,
    resourceId: orgId,
    targetUserId: targetUser.entityId
  })
}

export const leaveMember = async (orgId: string, callerUserId: string, callerEntityId: string) => {
  await prisma.$transaction(async (tx) => {
    const membership = await tx.membership.findUnique({
      where: { organisationId_userId: { organisationId: orgId, userId: callerUserId } }
    })

    if (!membership) throw new NotFoundError('Membership not found')

    await assertLastOwner(tx, orgId, [{ userId: callerUserId, nextRole: null }])

    await tx.membership.delete({
      where: { organisationId_userId: { organisationId: orgId, userId: callerUserId } }
    })
  })

  await writeAudit({
    action: 'organisation.member.left',
    actorUserId: callerEntityId,
    resourceId: orgId
  })
}

export const transferOwnership = async (
  orgId: string,
  newOwnerUserEntityId: string,
  caller: { id: string; entityId: string }
) => {
  const newOwnerUser = await findUserByEntityId(newOwnerUserEntityId)

  if (newOwnerUser.id === caller.id) {
    throw new ConflictError('Cannot transfer ownership to yourself', {
      reason: 'InvalidTransferTarget'
    })
  }

  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.membership.findUnique({
      where: { organisationId_userId: { organisationId: orgId, userId: newOwnerUser.id } }
    })

    if (!target) throw new NotFoundError('Member not found')

    const newOwner = await tx.membership.update({
      where: { organisationId_userId: { organisationId: orgId, userId: newOwnerUser.id } },
      data: { role: 'owner' }
    })

    const demoted = await tx.membership.update({
      where: { organisationId_userId: { organisationId: orgId, userId: caller.id } },
      data: { role: 'admin' }
    })

    return { newOwner, demoted }
  })

  await writeAudit({
    action: 'organisation.ownership.transferred',
    actorUserId: caller.entityId,
    resourceId: orgId,
    targetUserId: newOwnerUser.entityId
  })

  return result
}

export const createInvitation = async (
  orgId: string,
  email: string,
  role: 'admin' | 'member',
  actor: { id: string; entityId: string; role: Role }
): Promise<{ invitation: Invitation; rawToken: string }> => {
  if (role === 'admin' && actor.role !== 'owner') {
    throw new ForbiddenError('Only an owner can invite an admin', { reason: 'InsufficientRole' })
  }

  const lower = email.toLowerCase()

  const existing = await prisma.invitation.findFirst({
    where: { organisationId: orgId, email: lower, acceptedAt: null, revokedAt: null }
  })

  if (existing) {
    throw new ConflictError('An outstanding invitation already exists for that email', {
      reason: 'OutstandingInvitationExists'
    })
  }

  const rawToken = generateInviteToken()
  const tokenHashValue = hashToken(rawToken)

  const invitation = await prisma.invitation.create({
    data: {
      entityId: inviteEntityId(),
      organisationId: orgId,
      email: lower,
      role,
      tokenHash: tokenHashValue,
      invitedByUserId: actor.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      requestId: getRequestId() ?? null
    }
  })

  await writeAudit({
    action: 'organisation.member.invited',
    actorUserId: actor.entityId,
    resourceId: orgId,
    email: lower,
    role,
    invitationId: invitation.entityId
  })

  return { invitation, rawToken }
}

export const listInvitations = async (orgId: string, status: 'pending' | 'all') => {
  const where: Prisma.InvitationWhereInput = { organisationId: orgId }

  if (status === 'pending') {
    where.acceptedAt = null
    where.revokedAt = null
    where.expiresAt = { gt: new Date() }
  }

  return prisma.invitation.findMany({
    where,
    include: {
      invitedBy: {
        select: { entityId: true, email: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  })
}

export const revokeInvitation = async (
  orgId: string,
  invitationId: string,
  actorEntityId: string
) => {
  const invitation = await prisma.invitation.findUnique({
    where: { entityId: invitationId }
  })

  if (!invitation || invitation.organisationId !== orgId) {
    throw new NotFoundError('Invitation not found')
  }

  if (invitation.acceptedAt) {
    throw new ConflictError('Invitation already accepted', { reason: 'AlreadyAccepted' })
  }

  if (invitation.revokedAt) {
    throw new ConflictError('Invitation already revoked', { reason: 'AlreadyRevoked' })
  }

  await prisma.invitation.update({
    where: { entityId: invitationId },
    data: { revokedAt: new Date() }
  })

  await writeAudit({
    action: 'organisation.invitation.revoked',
    actorUserId: actorEntityId,
    resourceId: orgId,
    invitationId
  })
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

const invitationStatus = (i: Invitation): InvitationStatus => {
  if (i.acceptedAt) return 'accepted'

  if (i.revokedAt) return 'revoked'

  if (i.expiresAt.getTime() <= Date.now()) return 'expired'

  return 'pending'
}

export const getInvitationByToken = async (rawToken: string) => {
  const tokenHashValue = hashToken(rawToken)

  const invitation = await prisma.invitation.findFirst({
    where: { tokenHash: tokenHashValue },
    include: {
      organisation: { select: { entityId: true, name: true } },
      invitedBy: { select: { firstname: true, lastname: true } }
    }
  })

  if (!invitation) return null

  return { invitation, status: invitationStatus(invitation) }
}

export const acceptInvitation = async (
  rawToken: string,
  caller: { id: string; entityId: string; email: string }
) => {
  const found = await getInvitationByToken(rawToken)

  if (!found) throw new NotFoundError('Invitation not found')

  const { invitation, status } = found

  if (status === 'accepted') {
    throw new ConflictError('Invitation already accepted', { reason: 'AlreadyAccepted' })
  }

  if (status === 'revoked') {
    throw new ConflictError('Invitation already revoked', { reason: 'AlreadyRevoked' })
  }

  if (status === 'expired') {
    throw new ConflictError('Invitation expired', { reason: 'Expired' })
  }

  if (invitation.email.toLowerCase() !== caller.email.toLowerCase()) {
    throw new ForbiddenError('Invitation email does not match your account', {
      reason: 'InvitationEmailMismatch'
    })
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.invitation.update({
      where: { entityId: invitation.entityId },
      data: { acceptedAt: new Date(), acceptedByUserId: caller.id }
    })

    const existing = await tx.membership.findUnique({
      where: {
        organisationId_userId: { organisationId: invitation.organisationId, userId: caller.id }
      }
    })

    if (existing) {
      return { alreadyMember: true as const, membership: existing }
    }

    const membership = await tx.membership.create({
      data: {
        entityId: memberEntityId(),
        organisationId: invitation.organisationId,
        userId: caller.id,
        role: invitation.role,
        requestId: getRequestId() ?? null
      }
    })

    return { alreadyMember: false as const, membership }
  })

  const organisation = await prisma.organisation.findUnique({
    where: { entityId: invitation.organisationId }
  })

  if (!organisation) throw new NotFoundError('Organisation not found')

  await writeAudit({
    action: 'organisation.invitation.accepted',
    actorUserId: caller.entityId,
    resourceId: invitation.organisationId,
    invitationId: invitation.entityId,
    alreadyMember: result.alreadyMember
  })

  return { organisation, membership: result.membership, alreadyMember: result.alreadyMember }
}
