import Stripe from 'stripe'
import { env } from './env.js'

// Lazily-initialised Stripe singleton. Tests swap this via `setStripeClient`
// so they never reach the real API.
let cached: Stripe | undefined

export function getStripeClient(): Stripe {
  if (cached) return cached

  cached = new Stripe(env.STRIPE_API_KEY, {
    // Pin the API version so behaviour doesn't drift when Stripe rolls
    // forward. Renovate-equivalent for Stripe versions is a manual bump
    // here + reading the changelog.
    apiVersion: '2026-04-22.dahlia'
  })

  return cached
}

// Test seam — pass a stubbed Stripe-like client to bypass the network.
export function setStripeClient(client: Stripe): void {
  cached = client
}

export function resetStripeClient(): void {
  cached = undefined
}
