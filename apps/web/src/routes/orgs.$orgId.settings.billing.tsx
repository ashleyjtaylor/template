import { createFileRoute, Link } from '@tanstack/react-router'
import { ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { useAccessState, useCreatePortalSession } from '@/modules/billing/api'
import { SettingsNav } from '@/modules/org-management/components/SettingsNav'

export const Route = createFileRoute('/orgs/$orgId/settings/billing')({
  component: BillingPage
})

const fullDateFormatter = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'long',
  day: '2-digit'
})

function BillingPage() {
  const { orgId } = Route.useParams()
  const access = useAccessState(orgId)
  const portal = useCreatePortalSession(orgId)

  const handleManage = async () => {
    try {
      const { url } = await portal.mutateAsync()
      window.location.href = url
    } catch (err) {
      toast.error(humanisePortalError(err))
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,_var(--foreground)_1px,_transparent_0)] [background-size:24px_24px]"
      />

      <div className="relative mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <div className="text-[10px] font-medium uppercase text-muted-foreground/70">
            <Link to="/" className="hover:text-foreground">
              Home
            </Link>{' '}
            · Settings · Billing
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Billing</h1>
        </header>

        <SettingsNav orgId={orgId} />

        {access.isLoading ? (
          <div className="flex items-center gap-2 px-4 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : access.data?.subscription ? (
          <section className="rounded-lg border bg-card/60 p-5 shadow-xs">
            <div className="mb-3 flex items-baseline justify-between">
              <div>
                <div className="text-[10px] font-medium uppercase text-muted-foreground/70">
                  Current plan
                </div>
                <h2 className="mt-1 text-lg font-semibold capitalize">
                  {access.data.subscription.planKey}
                </h2>
              </div>
              <StatusBadge status={access.data.subscription.status} />
            </div>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Renews on">
                {fullDateFormatter.format(new Date(access.data.subscription.currentPeriodEnd))}
              </Field>
              <Field label="Cancellation">
                {access.data.subscription.cancelAtPeriodEnd
                  ? 'Set to cancel at period end'
                  : 'Not scheduled'}
              </Field>
            </dl>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Change your card, view invoices, or cancel via the Stripe Customer Portal.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleManage}
                disabled={portal.isPending}
              >
                {portal.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <>
                    <ExternalLink className="size-3" />
                    Manage in Stripe
                  </>
                )}
              </Button>
            </div>
          </section>
        ) : (
          <section className="rounded-lg border bg-card/60 px-4 py-12 text-center text-sm text-muted-foreground shadow-xs">
            No subscription on file. The paywall will guide you through Checkout when you next try
            to use this organisation.
          </section>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'active' || status === 'trialing'
      ? 'text-emerald-700 bg-emerald-100'
      : status === 'past_due'
        ? 'text-amber-700 bg-amber-100'
        : 'text-muted-foreground bg-muted'

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
    >
      {status}
    </span>
  )
}

const humanisePortalError = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.status === 409) return 'No Stripe customer for this organisation yet.'
    if (err.status === 403) return 'Only admins and owners can manage billing.'
    if (err.status >= 500) return 'Stripe is unreachable right now. Try again in a moment.'
  }

  return 'Could not open the billing portal. Try again.'
}
