import { z } from 'zod'

export const roleSchema = z.enum(['owner', 'admin', 'member'])
export type Role = z.infer<typeof roleSchema>

export const inviteRoleSchema = z.enum(['admin', 'member'])
export type InviteRole = z.infer<typeof inviteRoleSchema>

// GET /api/orgs
export const myOrgsSchema = z.array(
  z.object({
    organisation: z.object({
      entityId: z.string(),
      name: z.string()
    }),
    membership: z.object({
      role: roleSchema,
      createdAt: z.string()
    })
  })
)
export type MyOrgs = z.infer<typeof myOrgsSchema>

// GET /api/orgs/:orgId/members
export const memberRowSchema = z.object({
  membership: z.object({
    entityId: z.string(),
    organisationId: z.string(),
    userId: z.string(),
    role: roleSchema,
    createdAt: z.string()
  }),
  user: z.object({
    entityId: z.string(),
    email: z.string(),
    firstname: z.string(),
    lastname: z.string()
  })
})
export const memberListSchema = z.array(memberRowSchema)
export type MemberRow = z.infer<typeof memberRowSchema>

// GET /api/orgs/:orgId/invitations
export const invitationRowSchema = z.object({
  invitation: z.object({
    entityId: z.string(),
    email: z.string(),
    role: inviteRoleSchema,
    invitedByUserId: z.string(),
    acceptedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    expiresAt: z.string(),
    createdAt: z.string()
  }),
  invitedBy: z.object({
    entityId: z.string(),
    email: z.string(),
    firstname: z.string(),
    lastname: z.string()
  })
})
export const invitationListSchema = z.array(invitationRowSchema)
export type InvitationRow = z.infer<typeof invitationRowSchema>
