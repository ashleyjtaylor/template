import { ValidationError } from '@template/errors'
import { z } from 'zod'

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50)
})

export type ListQuery = z.infer<typeof listQuerySchema>

// Cursor encodes (createdAt, entityId) so pagination is stable when new
// sends arrive at the head between fetches. Same shape as the audit-log
// cursor.
const cursorWireSchema = z.object({ createdAt: z.string(), entityId: z.string() })

export const encodeCursor = (createdAt: Date, entityId: string) =>
  Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), entityId }), 'utf8').toString(
    'base64url'
  )

export const decodeCursor = (s: string): { createdAt: Date; entityId: string } => {
  try {
    const parsed = cursorWireSchema.parse(JSON.parse(Buffer.from(s, 'base64url').toString('utf8')))

    return { createdAt: new Date(parsed.createdAt), entityId: parsed.entityId }
  } catch {
    throw new ValidationError('Invalid cursor')
  }
}
