import { createFileRoute, Link } from '@tanstack/react-router'
import { Building2, ChevronLeft, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
// `Button` used in ErrorBlock retry button below.
import { ApiError } from '@/lib/api'
import { useAdminOrgBilling } from '@/modules/admin-orgs/api'
import { formatDateFull, stripeCustomerUrl } from '@/modules/admin-orgs/utils'

export const Route = createFileRoute('/orgs_/$entityId/billing')({
  component: OrgBillingPage
})

function OrgBillingPage() {
  const { entityId } = Route.useParams()
  const detail = useAdminOrgBilling(entityId)

  const is401 = detail.error instanceof ApiError && detail.error.status === 401
  const is403 = detail.error instanceof ApiError && detail.error.status === 403
  const is404 = detail.error instanceof ApiError && detail.error.status === 404

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,_var(--foreground)_1px,_transparent_0)] [background-size:24px_24px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent"
      />

      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <Link
          to="/orgs"
          className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3" />
          Back to organisations
        </Link>

        {detail.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        )}

        {is401 && <NotAuthorisedBlock title="401 — Unauthorised" detail="Sign in to continue." />}
        {is403 && (
          <NotAuthorisedBlock
            title="403 — Forbidden"
            detail="Staff access required to view this page."
          />
        )}
        {is404 && (
          <NotAuthorisedBlock title="404 — Not found" detail="This organisation does not exist." />
        )}
        {detail.isError && !is401 && !is403 && !is404 && (
          <ErrorBlock
            message="Could not load this organisation."
            onRetry={() => detail.refetch()}
          />
        )}

        {detail.data && (
          <>
            <header className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-medium uppercase text-muted-foreground/70">
                  Organisation · {detail.data.organisation.entityId}
                </div>
                <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
                  <Building2 className="size-5 text-muted-foreground/70" aria-hidden />
                  {detail.data.organisation.name}
                </h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  Created {formatDateFull(detail.data.organisation.createdAt)} ·{' '}
                  {detail.data.members.length}{' '}
                  {detail.data.members.length === 1 ? 'member' : 'members'}
                </p>
              </div>

              <a
                href={stripeCustomerUrl(detail.data.organisation.stripeCustomerId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <ExternalLink className="size-3.5" />
                View in Stripe
              </a>
            </header>

            <section className="mb-6 overflow-hidden rounded-lg border bg-card/60 shadow-xs">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Billing</h2>
                <p className="text-xs text-muted-foreground">
                  Subscription mirror from the Stripe webhook.
                </p>
              </div>

              {detail.data.subscription ? (
                <SubscriptionPanel subscription={detail.data.subscription} />
              ) : (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No subscription on file.
                  {detail.data.organisation.stripeCustomerId && (
                    <span className="block text-xs">
                      Customer linked: {detail.data.organisation.stripeCustomerId}
                    </span>
                  )}
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-lg border bg-card/60 shadow-xs">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Members</h2>
                <p className="text-xs text-muted-foreground">
                  Everyone with access to this organisation.
                </p>
              </div>
              <ul>
                {detail.data.members.map((m) => (
                  <li
                    key={m.user.entityId}
                    className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_140px] items-center gap-4 border-b px-4 py-3 text-sm last:border-b-0"
                  >
                    <div className="truncate font-medium">
                      {`${m.user.firstname} ${m.user.lastname}`.trim() || m.user.email}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{m.user.email}</div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      {m.role}
                    </div>
                    <div className="text-right text-[10px] text-muted-foreground/70">
                      joined {formatDateFull(m.joinedAt).split(',')[0]}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function SubscriptionPanel({
  subscription
}: {
  subscription: NonNullable<ReturnType<typeof useAdminOrgBilling>['data']>['subscription']
}) {
  if (!subscription) return null

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-2">
      <Field label="Plan">{subscription.planKey}</Field>
      <Field label="Status">
        <StatusBadge status={subscription.status} />
      </Field>
      <Field label="Current period start">{formatDateFull(subscription.currentPeriodStart)}</Field>
      <Field label="Renews on">{formatDateFull(subscription.currentPeriodEnd)}</Field>
      <Field label="Cancellation">
        {subscription.cancelAtPeriodEnd
          ? 'Set to cancel at period end'
          : subscription.canceledAt
            ? `Canceled ${formatDateFull(subscription.canceledAt)}`
            : 'Not scheduled'}
      </Field>
      <Field label="Stripe subscription id" mono>
        {subscription.stripeSubscriptionId}
      </Field>
      <Field label="Stripe customer id" mono>
        {subscription.stripeCustomerId}
      </Field>
      <Field label="Stripe price id" mono>
        {subscription.stripePriceId}
      </Field>
    </dl>
  )
}

function Field({
  label,
  children,
  mono
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className={mono ? 'mt-1 break-all font-mono text-xs' : 'mt-1 text-sm'}>{children}</dd>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'active' || status === 'trialing'
      ? 'text-emerald-700 bg-emerald-100'
      : status === 'past_due'
        ? 'text-amber-700 bg-amber-100'
        : status === 'canceled'
          ? 'text-muted-foreground bg-muted'
          : 'text-destructive bg-destructive/10'

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
    >
      {status}
    </span>
  )
}

function NotAuthorisedBlock({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card/60 px-4 py-20 text-center shadow-xs">
      <div className="text-[10px] uppercase text-destructive">{title}</div>
      <p className="text-sm text-foreground">{detail}</p>
    </div>
  )
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card/60 px-4 py-20 text-center shadow-xs">
      <div className="text-[10px] uppercase text-destructive">Error</div>
      <p className="text-sm text-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
