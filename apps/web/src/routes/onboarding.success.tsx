import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { useAccessState } from '@/modules/billing/api'

const searchSchema = z.object({
  orgId: z.string().min(1),
  // Stripe appends this to the success URL — we don't need to read its
  // contents (the webhook does the heavy lift) but it's a useful
  // correlation marker in logs / DevTools.
  session_id: z.string().optional()
})

export const Route = createFileRoute('/onboarding/success')({
  validateSearch: searchSchema,
  component: SuccessPage
})

// Polls access-state for ~10s after Checkout completes. The webhook
// usually lands within 1-2s, but Stripe doesn't guarantee timing — this
// page is the UX glue that bridges "Stripe redirected" and "subscription
// row exists in our DB."
const POLL_INTERVAL_MS = 1_000
const POLL_TIMEOUT_MS = 10_000

function SuccessPage() {
  const { orgId } = Route.useSearch()
  const navigate = useNavigate()
  const access = useAccessState(orgId, { pollMs: POLL_INTERVAL_MS })

  useEffect(() => {
    if (access.data?.state === 'paid' || access.data?.state === 'past_due') {
      navigate({ to: '/orgs/$orgId/settings/people', params: { orgId } })
    }
  }, [access.data?.state, navigate, orgId])

  // After ~10s without a flip to paid, stop polling and surface a
  // manual-refresh CTA. The webhook still runs in the background; this
  // is just to avoid a forever-spinning page.
  const timedOut =
    access.dataUpdatedAt > 0 &&
    Date.now() - access.dataUpdatedAt > POLL_TIMEOUT_MS &&
    access.data?.state === 'paywalled'

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,_var(--foreground)_1px,_transparent_0)] [background-size:24px_24px]"
      />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
        <div className="w-full rounded-lg border bg-card px-6 py-8 shadow-sm">
          {timedOut ? (
            <>
              <RefreshCw className="mx-auto size-8 text-muted-foreground" />
              <h1 className="mt-3 text-lg font-semibold tracking-tight">Still processing…</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Stripe is taking a little longer than usual to confirm your subscription. Refresh in
                a moment, or go back to the home page.
              </p>
              <div className="mt-6 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => access.refetch()}
                >
                  Refresh
                </Button>
                <Button className="flex-1" onClick={() => navigate({ to: '/' })}>
                  Go home
                </Button>
              </div>
            </>
          ) : (
            <>
              <CheckCircle2 className="mx-auto size-8 text-foreground" />
              <h1 className="mt-3 text-lg font-semibold tracking-tight">Finalising your plan</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Stripe has confirmed your payment. We're just syncing the subscription state — this
                usually takes a second.
              </p>
              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Loading…
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
