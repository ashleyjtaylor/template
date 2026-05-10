import { describe, expect, it } from 'vitest'
import { wouldStillHaveOwner } from '@/modules/organisations/service.js'

const owner = { userId: 'u_owner', role: 'owner' as const }
const admin = { userId: 'u_admin', role: 'admin' as const }
const member = { userId: 'u_member', role: 'member' as const }

describe('wouldStillHaveOwner', () => {
  it('should return true when an unrelated mutation leaves the existing owner intact', () => {
    expect(
      wouldStillHaveOwner([owner, admin, member], [{ userId: 'u_admin', nextRole: 'member' }])
    ).toBe(true)
  })

  it('should return false when the only owner is being demoted', () => {
    expect(wouldStillHaveOwner([owner, member], [{ userId: 'u_owner', nextRole: 'member' }])).toBe(
      false
    )
  })

  it('should return false when the only owner is being removed', () => {
    expect(wouldStillHaveOwner([owner, member], [{ userId: 'u_owner', nextRole: null }])).toBe(
      false
    )
  })

  it('should return true when one of two owners is being demoted', () => {
    const otherOwner = { userId: 'u_owner2', role: 'owner' as const }

    expect(
      wouldStillHaveOwner([owner, otherOwner, member], [{ userId: 'u_owner', nextRole: 'admin' }])
    ).toBe(true)
  })

  it('should return true when promoting another user to owner alongside removing the existing owner (transfer)', () => {
    expect(
      wouldStillHaveOwner(
        [owner, admin],
        [
          { userId: 'u_admin', nextRole: 'owner' },
          { userId: 'u_owner', nextRole: 'admin' }
        ]
      )
    ).toBe(true)
  })

  it('should return false when no owner exists and no mutation creates one', () => {
    expect(wouldStillHaveOwner([admin, member], [{ userId: 'u_member', nextRole: 'admin' }])).toBe(
      false
    )
  })
})
