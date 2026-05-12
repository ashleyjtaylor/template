import { prisma } from '@template/db'

export interface SentEmailCursor {
  createdAt: Date
  entityId: string
}

export async function listSentEmails(cursor: SentEmailCursor | null, limit: number) {
  const where = cursor
    ? {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, entityId: { lt: cursor.entityId } }
        ]
      }
    : {}

  return prisma.sentEmail.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { entityId: 'desc' }],
    take: limit + 1,
    // List view doesn't need the full HTML body — that's only loaded by
    // the detail route. Keep the list response small.
    select: {
      entityId: true,
      requestId: true,
      recipient: true,
      template: true,
      subject: true,
      status: true,
      lastError: true,
      messageId: true,
      createdAt: true,
      sentAt: true
    }
  })
}

export async function getSentEmailById(entityId: string) {
  return prisma.sentEmail.findUnique({ where: { entityId } })
}
