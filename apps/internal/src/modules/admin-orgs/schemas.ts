import { z } from 'zod'

const subscriptionSummarySchema = z
  .object({
    status: z.string(),
    planKey: z.string(),
    cancelAtPeriodEnd: z.boolean()
  })
  .nullable()

export const orgRowSchema = z.object({
  entityId: z.string(),
  name: z.string(),
  createdAt: z.string(),
  ownerEmail: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  stripeCustomerId: z.string().nullable(),
  subscription: subscriptionSummarySchema
})
export type OrgRow = z.infer<typeof orgRowSchema>

export const orgListSchema = z.object({
  rows: z.array(orgRowSchema),
  nextCursor: z.string().nullable()
})
export type OrgList = z.infer<typeof orgListSchema>

export const orgBillingDetailSchema = z.object({
  organisation: z.object({
    entityId: z.string(),
    name: z.string(),
    createdAt: z.string(),
    stripeCustomerId: z.string().nullable()
  }),
  subscription: z
    .object({
      entityId: z.string(),
      stripeSubscriptionId: z.string(),
      stripeCustomerId: z.string(),
      stripePriceId: z.string(),
      planKey: z.string(),
      status: z.string(),
      currentPeriodStart: z.string(),
      currentPeriodEnd: z.string(),
      cancelAtPeriodEnd: z.boolean(),
      canceledAt: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string()
    })
    .nullable(),
  members: z.array(
    z.object({
      role: z.string(),
      joinedAt: z.string(),
      user: z.object({
        entityId: z.string(),
        email: z.string(),
        firstname: z.string(),
        lastname: z.string()
      })
    })
  )
})
export type OrgBillingDetail = z.infer<typeof orgBillingDetailSchema>
