import { afterEach, describe, expect, it } from 'vitest'
import { resetTransport, setTransport } from '../../src/transport-selector.js'
import type { EmailTransport, SendEmailParams, TransportResult } from '../../src/types.js'

class StubTransport implements EmailTransport {
  async send(_params: SendEmailParams & { from: string }): Promise<TransportResult> {
    return { messageId: 'stub' }
  }
}

afterEach(() => {
  resetTransport()
})

describe('transport-selector', () => {
  it('caches the transport across calls', async () => {
    const { getTransport } = await import('../../src/transport-selector.js')

    const first = getTransport()
    const second = getTransport()

    expect(first).toBe(second)
  })

  it('lets tests swap in a stub via setTransport', async () => {
    const stub = new StubTransport()
    setTransport(stub)

    const { getTransport } = await import('../../src/transport-selector.js')

    expect(getTransport()).toBe(stub)
  })

  it('resetTransport clears the cache so a fresh resolution can run', async () => {
    const stub = new StubTransport()
    setTransport(stub)
    resetTransport()

    const { getTransport } = await import('../../src/transport-selector.js')

    expect(getTransport()).not.toBe(stub)
  })
})
