import type { Invitation, Membership, Organisation } from '@prisma/client'
import { auth } from '@/lib/auth.js'
import { NotFoundError } from '@/lib/errors.js'
import type { AuthSession } from '@/middleware/require-session.js'
import type {
  ChangeRoleInput,
  CreateInvitationInput,
  CreateOrgInput,
  ListInvitationsQuery,
  OrgSignUpInput,
  Role,
  TransferOwnershipInput,
  UpdateOrgInput
} from '@/modules/organisations/schemas.js'
import {
  acceptInvitation,
  changeRole,
  createInvitation,
  createOrg,
  getInvitationByToken,
  getOrgById,
  leaveMember,
  listInvitations,
  listMembers,
  listMyOrgs,
  removeMember,
  revokeInvitation,
  transferOwnership,
  updateOrgName
} from '@/modules/organisations/service.js'

interface SignUpUser {
  id: string
  entityId: string
  email: string
  firstname: string
  lastname: string
}

export type OrgSignUpResult =
  | {
      kind: 'success'
      user: SignUpUser
      organisation: Organisation
      membership: Membership
      setCookieHeader: string | null
    }
  | { kind: 'passthrough'; response: Response }

export const orgSignUpController = async (
  input: OrgSignUpInput,
  headers: Headers
): Promise<OrgSignUpResult> => {
  const response = await auth.api.signUpEmail({
    body: {
      email: input.email,
      password: input.password,
      name: `${input.firstname} ${input.lastname}`,
      firstname: input.firstname,
      lastname: input.lastname
    } as never,
    headers,
    asResponse: true
  })

  if (!response.ok) {
    return { kind: 'passthrough', response }
  }

  const json = (await response.json()) as { user: SignUpUser }

  const result = await createOrg(input.organisationName, json.user.id, json.user.entityId)

  return {
    kind: 'success',
    user: json.user,
    organisation: result.organisation,
    membership: result.membership,
    setCookieHeader: response.headers.get('set-cookie')
  }
}

export const listMyOrgsController = async (session: AuthSession) => listMyOrgs(session.userId)

export const createOrgController = async (input: CreateOrgInput, session: AuthSession) =>
  createOrg(input.name, session.userId, session.userEntityId)

export const getOrgController = async (orgId: string, membership: Membership) => {
  const organisation = await getOrgById(orgId)

  if (!organisation) throw new NotFoundError('Organisation not found')

  return { organisation, membership }
}

export const updateOrgController = async (
  orgId: string,
  input: UpdateOrgInput,
  session: AuthSession
) => {
  const organisation = await updateOrgName(orgId, input.name, session.userEntityId)

  return { organisation }
}

export const leaveOrgController = async (orgId: string, session: AuthSession) =>
  leaveMember(orgId, session.userId, session.userEntityId)

export const transferOwnershipController = async (
  orgId: string,
  input: TransferOwnershipInput,
  session: AuthSession
) => {
  const result = await transferOwnership(orgId, input.newOwnerUserId, {
    id: session.userId,
    entityId: session.userEntityId
  })

  return { memberships: [result.newOwner, result.demoted] }
}

export const listMembersController = async (orgId: string) => listMembers(orgId)

export const changeRoleController = async (
  orgId: string,
  targetUserEntityId: string,
  input: ChangeRoleInput,
  session: AuthSession,
  membership: Membership
) => {
  const updated = await changeRole(orgId, targetUserEntityId, input.role, {
    entityId: session.userEntityId,
    role: membership.role as Role
  })

  return { membership: updated }
}

export const removeMemberController = async (
  orgId: string,
  targetUserEntityId: string,
  session: AuthSession,
  membership: Membership
) =>
  removeMember(orgId, targetUserEntityId, {
    entityId: session.userEntityId,
    role: membership.role as Role
  })

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
