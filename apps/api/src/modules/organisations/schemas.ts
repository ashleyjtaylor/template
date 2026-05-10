import { z } from 'zod'

export const organisationNameSchema = z.string().trim().min(1).max(80)

export const roleSchema = z.enum(['owner', 'admin', 'member'])

export type Role = z.infer<typeof roleSchema>

export const inviteRoleSchema = z.enum(['admin', 'member'])

export type InviteRole = z.infer<typeof inviteRoleSchema>

export const orgSignUpSchema = z
  .object({
    email: z.email(),
    password: z.string().min(8),
    firstname: z.string().trim().min(1),
    lastname: z.string().trim().min(1),
    organisationName: organisationNameSchema
  })
  .strict()

export type OrgSignUpInput = z.infer<typeof orgSignUpSchema>

export const createOrgSchema = z.object({ name: organisationNameSchema }).strict()

export type CreateOrgInput = z.infer<typeof createOrgSchema>

export const updateOrgSchema = z.object({ name: organisationNameSchema }).strict()

export type UpdateOrgInput = z.infer<typeof updateOrgSchema>

export const changeRoleSchema = z.object({ role: roleSchema }).strict()

export type ChangeRoleInput = z.infer<typeof changeRoleSchema>

export const transferOwnershipSchema = z.object({ newOwnerUserId: z.string().min(1) }).strict()

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>

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
