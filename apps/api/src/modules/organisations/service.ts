import type { Membership, Organisation, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db.js'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors.js'
import { getRequestId } from '@/lib/logger.js'
import { writeAudit } from '@/modules/audit-log/service.js'
import type { Role } from '@/modules/organisations/schemas.js'

const orgEntityId = () => `org_${crypto.randomUUID()}`

const memberEntityId = () => `memb_${crypto.randomUUID()}`

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
