import type { Entitlements } from './types.js'

// Single plan for the MVP. New plans get an entry here; the per-fork
// pricing page UI surface arrives in a separate ticket.
const PLANS: Record<string, Entitlements> = {
  pro: {
    seats: 25,
    features: new Set<string>()
  }
}

export function entitlementsForPlan(planKey: string): Entitlements {
  const plan = PLANS[planKey]

  if (!plan) throw new Error(`Unknown plan key: ${planKey}`)

  return plan
}

export function knownPlanKeys(): readonly string[] {
  return Object.keys(PLANS)
}
