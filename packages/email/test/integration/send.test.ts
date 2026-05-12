import { prisma } from '@template/db'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sendEmail } from '../../src/send.js'
import { resetTransport, setTransport } from '../../src/transport-selector.js'
import type { EmailTransport, SendEmailParams, TransportResult } from '../../src/types.js'

// Integration tests for sendEmail's dedupe + sent_emails write semantics.
// Hits real Postgres (template_test) — Compose locally, service container
// in CI. The transport is stubbed so no SMTP / SES traffic is needed.

class RecordingTransport implements EmailTransport {
  calls: Array<SendEmailParams & { from: string }> = []
  messageId = 'msg-stub'

  async send(params: SendEmailParams & { from: string }): Promise<TransportResult> {
    this.calls.push(params)

    return { messageId: this.messageId }
  }
}

class FailingTransport implements EmailTransport {
  async send(_params: SendEmailParams & { from: string }): Promise<TransportResult> {
    throw new Error('upstream went boom')
  }
}

const cleanState = async () => {
  await prisma.sentEmail.deleteMany({})
}

beforeEach(async () => {
  await cleanState()
  resetTransport()
})

afterAll(async () => {
  await cleanState()
  resetTransport()
  await prisma.$disconnect()
})

const baseParams = (): SendEmailParams => ({
  to: 'recipient@example.com',
  subject: 'Hello',
  html: '<p>Hi</p>',
  text: 'Hi',
  dedupeKey: `test:${crypto.randomUUID()}`,
  template: 'invitation'
})

describe('sendEmail', () => {
  it('records a sent row with status=sent and messageId on success', async () => {
    const transport = new RecordingTransport()
    setTransport(transport)

    const params = baseParams()
    await sendEmail(params)

    const row = await prisma.sentEmail.findUnique({ where: { dedupeKey: params.dedupeKey } })

    expect(row?.status).toBe('sent')
    expect(row?.messageId).toBe('msg-stub')
    expect(row?.sentAt).not.toBeNull()
    expect(row?.recipient).toBe('recipient@example.com')
    expect(transport.calls).toHaveLength(1)
  })

  it('is idempotent — a second call with the same dedupeKey is a no-op', async () => {
    const transport = new RecordingTransport()
    setTransport(transport)

    const params = baseParams()
    await sendEmail(params)
    await sendEmail(params)

    expect(transport.calls).toHaveLength(1)

    const count = await prisma.sentEmail.count({ where: { dedupeKey: params.dedupeKey } })

    expect(count).toBe(1)
  })

  it('marks the row failed and rethrows when the transport throws', async () => {
    setTransport(new FailingTransport())

    const params = baseParams()

    await expect(sendEmail(params)).rejects.toThrow(/email send failed/)

    const row = await prisma.sentEmail.findUnique({ where: { dedupeKey: params.dedupeKey } })

    expect(row?.status).toBe('failed')
    expect(row?.lastError).toMatch(/upstream went boom/)
    expect(row?.sentAt).toBeNull()
  })

  it('retries a failed row in place — same entityId, status flips back to sent', async () => {
    setTransport(new FailingTransport())

    const params = baseParams()
    await expect(sendEmail(params)).rejects.toThrow()

    const failed = await prisma.sentEmail.findUniqueOrThrow({
      where: { dedupeKey: params.dedupeKey }
    })
    expect(failed.status).toBe('failed')

    setTransport(new RecordingTransport())
    await sendEmail(params)

    const after = await prisma.sentEmail.findUniqueOrThrow({
      where: { dedupeKey: params.dedupeKey }
    })

    expect(after.entityId).toBe(failed.entityId)
    expect(after.status).toBe('sent')
    expect(after.lastError).toBeNull()
  })

  it('rejects when dedupeKey is missing', async () => {
    setTransport(new RecordingTransport())

    const params = { ...baseParams(), dedupeKey: '' }

    await expect(sendEmail(params)).rejects.toThrow(/dedupeKey is required/)
  })
})
