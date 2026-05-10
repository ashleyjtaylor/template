import { z } from 'zod'

// Wire shape returned by GET /api/auth/get-session — null when there is no
// valid cookie, otherwise { user, session }. Keep the user fields aligned
// with what apps/internal actually consumes (sidebar UserMenu + auth gate);
// add fields here as new surfaces need them rather than mirroring the full
// better-auth schema.
export const sessionUserSchema = z.object({
  entityId: z.string(),
  email: z.string(),
  name: z.string(),
  staffRole: z.enum(['support', 'engineer', 'admin']).nullable()
})

export type SessionUser = z.infer<typeof sessionUserSchema>

export const sessionSchema = z
  .object({
    user: sessionUserSchema,
    session: z.object({ entityId: z.string() })
  })
  .nullable()

export type Session = z.infer<typeof sessionSchema>
