import { z } from 'zod'

// List view doesn't need the full HTML body — it's only loaded by the
// detail route (sentEmailDetailSchema).
export const sentEmailRowSchema = z.object({
  entityId: z.string(),
  requestId: z.string().nullable(),
  recipient: z.string(),
  template: z.string(),
  subject: z.string(),
  status: z.string(),
  lastError: z.string().nullable(),
  messageId: z.string().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable()
})

export type SentEmailRow = z.infer<typeof sentEmailRowSchema>

export const sentEmailListSchema = z.object({
  rows: z.array(sentEmailRowSchema),
  nextCursor: z.string().nullable()
})

export type SentEmailList = z.infer<typeof sentEmailListSchema>

export const sentEmailDetailSchema = sentEmailRowSchema.extend({
  dedupeKey: z.string(),
  html: z.string(),
  text: z.string().nullable()
})

export type SentEmailDetail = z.infer<typeof sentEmailDetailSchema>
