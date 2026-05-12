import { NotFoundError } from '@template/errors'
import { decodeCursor, encodeCursor, type ListQuery } from './schemas.js'
import { getSentEmailById, listSentEmails } from './service.js'

export async function listSentEmailsController(query: ListQuery) {
  const cursorParsed = query.cursor ? decodeCursor(query.cursor) : null
  const fetched = await listSentEmails(cursorParsed, query.limit)

  const hasMore = fetched.length > query.limit
  const trimmed = hasMore ? fetched.slice(0, query.limit) : fetched

  const last = trimmed[trimmed.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.entityId) : null

  return {
    rows: trimmed.map((r) => ({
      entityId: r.entityId,
      requestId: r.requestId,
      recipient: r.recipient,
      template: r.template,
      subject: r.subject,
      status: r.status,
      lastError: r.lastError,
      messageId: r.messageId,
      createdAt: r.createdAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null
    })),
    nextCursor
  }
}

export async function getSentEmailController(entityId: string) {
  const row = await getSentEmailById(entityId)

  if (!row) throw new NotFoundError('Sent email not found')

  return {
    entityId: row.entityId,
    requestId: row.requestId,
    dedupeKey: row.dedupeKey,
    recipient: row.recipient,
    template: row.template,
    subject: row.subject,
    html: row.html,
    text: row.text,
    status: row.status,
    lastError: row.lastError,
    messageId: row.messageId,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null
  }
}
