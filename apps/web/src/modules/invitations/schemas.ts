import { z } from 'zod'

export const invitationPreviewSchema = z.object({
  organisation: z.object({
    entityId: z.string(),
    name: z.string()
  }),
  role: z.enum(['admin', 'member']),
  email: z.string(),
  invitedBy: z.object({
    firstname: z.string(),
    lastname: z.string()
  }),
  expiresAt: z.string(),
  status: z.enum(['pending', 'accepted', 'revoked', 'expired'])
})

export type InvitationPreview = z.infer<typeof invitationPreviewSchema>

export const acceptInvitationResponseSchema = z.object({
  organisation: z.object({
    entityId: z.string(),
    name: z.string()
  }),
  membership: z.object({
    entityId: z.string(),
    role: z.string()
  }),
  alreadyMember: z.boolean()
})

export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>
