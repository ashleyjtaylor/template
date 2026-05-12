import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { accessStateSchema, sessionUrlSchema } from './schemas'

const accessStateKey = (orgId: string) => ['org', orgId, 'access-state'] as const

export const useAccessState = (orgId: string, opts: { pollMs?: number } = {}) =>
  useQuery({
    queryKey: accessStateKey(orgId),
    queryFn: () => api(`/api/orgs/${orgId}/billing/access-state`, accessStateSchema),
    enabled: orgId.length > 0,
    // Admin-shaped query — refetch on focus / mount so the webhook-driven
    // state flip lands without a manual reload.
    staleTime: 0,
    refetchOnWindowFocus: true,
    // Onboarding success page passes `pollMs` so it can watch the state
    // flip from `paywalled` to `paid` after Checkout completes.
    refetchInterval: opts.pollMs ?? false
  })

export const useCreateCheckoutSession = (orgId: string) =>
  useMutation({
    mutationFn: () =>
      api(`/api/orgs/${orgId}/billing/checkout-session`, sessionUrlSchema, {
        method: 'POST',
        body: {}
      })
  })

export const useCreatePortalSession = (orgId: string) =>
  useMutation({
    mutationFn: () =>
      api(`/api/orgs/${orgId}/billing/portal-session`, sessionUrlSchema, {
        method: 'POST',
        body: {}
      })
  })
