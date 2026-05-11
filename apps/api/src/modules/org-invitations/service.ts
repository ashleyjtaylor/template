import type { Invitation, Prisma } from '@template/db'
import { prisma } from '@template/db'
import { ConflictError, ForbiddenError, NotFoundError } from '@template/errors'
import { emit } from '@template/events'
import { getRequestId } from '@/lib/logger.js'
import { writeAudit } from '@/modules/audit-log/service.js'
import { generateInviteToken, hashToken } from '@/modules/org-invitations/tokens.js'
import type { Role } from '@/modules/organisations/schemas.js'

const inviteEntityId = () => `inv_${crypto.randomUUID()}`

const memberEntityId = () => `memb_${crypto.randomUUID()}`

const INVITE_TTL_DAYS = 7

const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000

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
  const requestId = getRequestId() ?? null

  // Transactionally commit the invitation row + an outbox entry for the
  // `invitation.created` event. The outbox publisher picks it up after commit
  // and enqueues to the destination queue (the email PR's subscriber sends
  // the invite email; today's subscriber is a logger).
  const invitation = await prisma.$transaction(async (tx) => {
    const inv = await tx.invitation.create({
      data: {
        entityId: inviteEntityId(),
        organisationId: orgId,
        email: lower,
        role,
        tokenHash: tokenHashValue,
        invitedByUserId: actor.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        requestId
      }
    })

    await emit(
      {
        type: 'invitation.created',
        invitationId: inv.entityId,
        organisationId: orgId,
        email: lower,
        role
      },
      { tx, requestId }
    )

    return inv
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
