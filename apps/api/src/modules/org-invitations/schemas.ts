import { z } from 'zod'

export const inviteRoleSchema = z.enum(['admin', 'member'])

export type InviteRole = z.infer<typeof inviteRoleSchema>

export const createInvitationSchema = z
  .object({
    email: z.email().toLowerCase(),
    role: inviteRoleSchema
  })
  .strict()

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>

export const listInvitationsQuerySchema = z.object({
  status: z.enum(['pending', 'all']).default('pending')
})

export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>
