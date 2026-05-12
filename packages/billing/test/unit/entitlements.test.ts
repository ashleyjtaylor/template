import { describe, expect, it } from 'vitest'
import { entitlementsForPlan, knownPlanKeys } from '../../src/entitlements.js'

describe('entitlementsForPlan', () => {
  it('returns the Pro plan with the expected shape', () => {
    const result = entitlementsForPlan('pro')

    expect(result.seats).toBe(25)
    expect(result.features).toBeInstanceOf(Set)
  })

  it('throws on an unknown plan key', () => {
    expect(() => entitlementsForPlan('enterprise')).toThrow(/Unknown plan key/)
  })
})

describe('knownPlanKeys', () => {
  it('includes the Pro plan', () => {
    expect(knownPlanKeys()).toContain('pro')
  })
})
