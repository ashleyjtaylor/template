import type { Invitation, Membership } from '@prisma/client'
import { NotFoundError } from '@/lib/errors.js'
import type { AuthSession } from '@/middleware/require-session.js'
import type {
  CreateInvitationInput,
  ListInvitationsQuery
} from '@/modules/org-invitations/schemas.js'
import {
  acceptInvitation,
  createInvitation,
  getInvitationByToken,
  listInvitations,
  revokeInvitation
} from '@/modules/org-invitations/service.js'
import type { Role } from '@/modules/organisations/schemas.js'

const formatInvitation = (i: Invitation) => ({
  entityId: i.entityId,
  email: i.email,
  role: i.role,
  invitedByUserId: i.invitedByUserId,
  acceptedAt: i.acceptedAt,
  revokedAt: i.revokedAt,
  expiresAt: i.expiresAt,
  createdAt: i.createdAt
})

export const createInvitationController = async (
  orgId: string,
  input: CreateInvitationInput,
  session: AuthSession,
  membership: Membership
) => {
  const { invitation, rawToken } = await createInvitation(orgId, input.email, input.role, {
    id: session.userId,
    entityId: session.userEntityId,
    role: membership.role as Role
  })

  return {
    invitation: formatInvitation(invitation),
    link: `/accept-invite?token=${rawToken}`
  }
}

export const listInvitationsController = async (orgId: string, query: ListInvitationsQuery) => {
  const invitations = await listInvitations(orgId, query.status)

  return invitations.map((i) => ({
    invitation: formatInvitation(i),
    invitedBy: i.invitedBy
  }))
}

export const revokeInvitationController = async (
  orgId: string,
  invitationId: string,
  session: AuthSession
) => revokeInvitation(orgId, invitationId, session.userEntityId)

export const getInvitationController = async (token: string) => {
  const found = await getInvitationByToken(token)

  if (!found) throw new NotFoundError('Invitation not found')

  return {
    organisation: found.invitation.organisation,
    role: found.invitation.role,
    email: found.invitation.email,
    invitedBy: found.invitation.invitedBy,
    expiresAt: found.invitation.expiresAt,
    status: found.status
  }
}

export const acceptInvitationController = async (token: string, session: AuthSession) =>
  acceptInvitation(token, {
    id: session.userId,
    entityId: session.userEntityId,
    email: session.email
  })
