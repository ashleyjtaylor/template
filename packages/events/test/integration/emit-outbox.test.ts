import { prisma } from '@template/db'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  closeQueues,
  disconnectRedis,
  emit,
  getQueue,
  publishOutbox,
  QueueName
} from '../../src/index.js'

// Integration tests for the emit → outbox / emit → enqueue paths. Hits real
// Postgres (template_test) and real Redis (Compose locally / service
// container in CI). Each test cleans state before running.

const cleanState = async () => {
  await prisma.outbox.deleteMany({})
  // Drain the queues we assert on and remove any failed/completed jobs we
  // left behind. BullMQ Queue.drain() removes waiting + delayed jobs.
  for (const name of [QueueName.internal, QueueName.emails]) {
    const queue = getQueue(name)
    await queue.drain()
    await queue.clean(0, 1000, 'completed')
    await queue.clean(0, 1000, 'failed')
  }
}

beforeEach(cleanState)

afterAll(async () => {
  await cleanState()
  await closeQueues()
  await disconnectRedis()
  await prisma.$disconnect()
})

describe('emit() without tx', () => {
  it('enqueues directly to the event type’s target queue and writes no outbox row', async () => {
    await emit({
      type: 'invitation.created',
      invitationId: 'inv_test1',
      organisationId: 'org_test1',
      email: 'a@example.com',
      role: 'member',
      rawToken: 'test-raw-token'
    })

    const outboxCount = await prisma.outbox.count()
    expect(outboxCount).toBe(0)

    const emails = getQueue(QueueName.emails)
    const waiting = await emails.getWaitingCount()
    expect(waiting).toBe(1)
  })
})

describe('emit() with tx', () => {
  it('writes an outbox row inside the transaction and enqueues nothing', async () => {
    await prisma.$transaction(async (tx) => {
      await emit(
        {
          type: 'invitation.created',
          invitationId: 'inv_test2',
          organisationId: 'org_test2',
          email: 'b@example.com',
          role: 'admin',
          rawToken: 'test-raw-token'
        },
        { tx, requestId: 'req_test2' }
      )
    })

    const rows = await prisma.outbox.findMany()
    expect(rows).toHaveLength(1)

    const [row] = rows

    expect(row?.topic).toBe('invitation.created')
    expect(row?.targetQueue).toBe(QueueName.emails)
    expect(row?.processedAt).toBeNull()
    expect(row?.requestId).toBe('req_test2')
    expect(row?.entityId).toMatch(/^obx_/)

    const emails = getQueue(QueueName.emails)
    expect(await emails.getWaitingCount()).toBe(0)
  })

  it('rolls the outbox row back if the surrounding transaction fails', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await emit(
          {
            type: 'invitation.created',
            invitationId: 'inv_rollback',
            organisationId: 'org_rollback',
            email: 'c@example.com',
            role: 'member',
            rawToken: 'test-raw-token'
          },
          { tx }
        )

        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')

    expect(await prisma.outbox.count()).toBe(0)
  })
})

describe('publishOutbox()', () => {
  it('drains unprocessed rows to their target queues and marks them processed', async () => {
    await prisma.$transaction(async (tx) => {
      await emit(
        {
          type: 'invitation.created',
          invitationId: 'inv_pub1',
          organisationId: 'org_pub1',
          email: 'd@example.com',
          role: 'member',
          rawToken: 'test-raw-token'
        },
        { tx }
      )
    })

    const result = await publishOutbox()

    expect(result).toEqual({ published: 1, failed: 0 })

    const rows = await prisma.outbox.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.processedAt).not.toBeNull()

    const emails = getQueue(QueueName.emails)
    expect(await emails.getWaitingCount()).toBe(1)
  })

  it('is idempotent — running again does not re-enqueue already-processed rows', async () => {
    await prisma.$transaction(async (tx) => {
      await emit(
        {
          type: 'invitation.created',
          invitationId: 'inv_idem',
          organisationId: 'org_idem',
          email: 'e@example.com',
          role: 'member',
          rawToken: 'test-raw-token'
        },
        { tx }
      )
    })

    const first = await publishOutbox()
    const second = await publishOutbox()

    expect(first).toEqual({ published: 1, failed: 0 })
    expect(second).toEqual({ published: 0, failed: 0 })

    const emails = getQueue(QueueName.emails)
    expect(await emails.getWaitingCount()).toBe(1)
  })
})
