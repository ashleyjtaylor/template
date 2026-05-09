import { setImmediate as setImmediatePromise } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { getRequestId, runWithContext } from '@/lib/logger.js'

describe('runWithContext / getRequestId', () => {
  it('should return the seeded request ID inside the callback', () => {
    runWithContext({ requestId: 'abc' }, () => {
      expect(getRequestId()).toBe('abc')
    })
  })

  it('should return undefined outside any context', () => {
    expect(getRequestId()).toBeUndefined()
  })

  it('should preserve the request ID across awaits', async () => {
    await runWithContext({ requestId: 'xyz' }, async () => {
      await setImmediatePromise()

      expect(getRequestId()).toBe('xyz')
    })
  })

  it('should isolate contexts between concurrent runs', async () => {
    const a = runWithContext({ requestId: 'a' }, async () => {
      await setImmediatePromise()
      return getRequestId()
    })
    const b = runWithContext({ requestId: 'b' }, async () => {
      await setImmediatePromise()
      return getRequestId()
    })

    await expect(Promise.all([a, b])).resolves.toEqual(['a', 'b'])
  })
})
