import { describe, expect, it } from 'vitest'
import { generateInviteToken, hashToken } from '@/modules/organisations/tokens.js'

describe('generateInviteToken', () => {
  it('should produce a base64url string of ~43 characters from 32 random bytes', () => {
    const token = generateInviteToken()

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('should produce a different token on every call', () => {
    const a = generateInviteToken()
    const b = generateInviteToken()

    expect(a).not.toBe(b)
  })
})

describe('hashToken', () => {
  it('should produce the same sha256 hex for the same input', () => {
    const token = generateInviteToken()

    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('should produce different hashes for different inputs', () => {
    expect(hashToken(generateInviteToken())).not.toBe(hashToken(generateInviteToken()))
  })

  it('should produce a 64-character hex string', () => {
    expect(hashToken('any-input')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should not be reversible (hash differs from raw token)', () => {
    const token = generateInviteToken()

    expect(hashToken(token)).not.toBe(token)
  })
})
