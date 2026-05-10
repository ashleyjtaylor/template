import { afterEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db.js'
import { logger, runWithContext } from '@/lib/logger.js'
import { writeAudit } from '@/modules/audit-log/service.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('writeAudit', () => {
  it('should create an audit_log row with action, actor, resourceType, requestId, and details', async () => {
    const create = vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never)

    await runWithContext({ requestId: 'req_test_123' }, async () => {
      await writeAudit({
        action: 'user.signed_up',
        actorUserId: 'usr_abc',
        email: 'x@y.com',
        firstname: 'X',
        lastname: 'Y'
      })
    })

    expect(create).toHaveBeenCalledOnce()

    const arg = create.mock.calls[0]?.[0]

    expect(arg?.data).toMatchObject({
      action: 'user.signed_up',
      actorUserId: 'usr_abc',
      actorImpersonatorId: null,
      resourceType: 'user',
      resourceId: null,
      requestId: 'req_test_123',
      details: {
        action: 'user.signed_up',
        actorUserId: 'usr_abc',
        email: 'x@y.com',
        firstname: 'X',
        lastname: 'Y'
      }
    })
    expect(arg?.data.entityId).toMatch(/^aud_[0-9a-f-]{36}$/)
  })

  it('should infer resourceType from the action prefix', async () => {
    const create = vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never)

    await writeAudit({
      action: 'organisation.member.invited',
      actorUserId: 'usr_a',
      resourceId: 'org_b',
      email: 'c@d.com',
      role: 'admin'
    })

    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      resourceType: 'organisation',
      resourceId: 'org_b'
    })
  })

  it('should swallow Prisma errors and log via pino', async () => {
    vi.spyOn(prisma.auditLog, 'create').mockRejectedValue(new Error('db unavailable'))
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger)

    await expect(
      writeAudit({ action: 'user.logged_in', actorUserId: 'usr_abc' })
    ).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledOnce()

    const callArgs = errorSpy.mock.calls[0]

    expect(callArgs?.[0]).toMatchObject({ action: 'user.logged_in' })
    expect(callArgs?.[1]).toBe('audit write failed')
  })
})
