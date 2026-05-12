import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { ApiError } from '@/lib/api'
import { useAccessState } from './api'

interface OrgPaywallGateProps {
  orgId: string
  children: ReactNode
}

// Holds an org-scoped page from rendering until the org has either an
// active subscription (paid) or one being retried (past_due). Anything
// else (paywalled, 404, 403) is handled per case:
//
// - paywalled → redirect to /onboarding/subscribe?orgId=... so the user
//   can complete Checkout. The post-Checkout success page is what
//   redirects them back here.
// - 404 (org not found or caller is not a member) → fall through to the
//   child page, which renders its own "Organisation not found" full-page
//   block (existing pattern from the People page).
// - 403 → same as 404; surfaced by the child.
//
// The access-state query refetches on window focus and on mount
// (staleTime: 0) so a webhook-driven flip is reflected without a manual
// page reload.
export function OrgPaywallGate({ orgId, children }: OrgPaywallGateProps) {
  const navigate = useNavigate()
  const access = useAccessState(orgId)

  useEffect(() => {
    if (access.data?.state === 'paywalled') {
      navigate({
        to: '/onboarding/subscribe',
        search: { orgId }
      })
    }
  }, [access.data?.state, navigate, orgId])

  if (access.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  // Forward 401/403/404 to the child — its own "not authorised" /
  // "not found" rendering is the right surface, and AuthGate handles
  // 401 globally.
  if (access.isError) {
    const status = access.error instanceof ApiError ? access.error.status : null

    if (status === 401 || status === 403 || status === 404) return children

    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Could not load billing state for this organisation.
      </div>
    )
  }

  if (access.data?.state === 'paywalled') {
    // Effect-driven redirect is mid-flight; render nothing for one frame.
    return null
  }

  return <>{children}</>
}
