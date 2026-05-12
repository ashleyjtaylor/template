import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Check, Loader2 } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { useAccessState, useCreateCheckoutSession } from '@/modules/billing/api'

const searchSchema = z.object({
  orgId: z.string().min(1)
})

export const Route = createFileRoute('/onboarding/subscribe')({
  validateSearch: searchSchema,
  component: SubscribePage
})

function SubscribePage() {
  const { orgId } = Route.useSearch()
  const navigate = useNavigate()
  const access = useAccessState(orgId)
  const checkout = useCreateCheckoutSession(orgId)

  // If the org already has a paid / past_due subscription, the user
  // shouldn't be on this page — bounce them home.
  if (access.data && access.data.state !== 'paywalled') {
    navigate({ to: '/' })

    return null
  }

  const handleSubscribe = async () => {
    try {
      const { url } = await checkout.mutateAsync()
      window.location.href = url
    } catch (_err) {
      // Error state is rendered below — no toast here because the user
      // is mid-action and inline messaging is clearer.
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,_var(--foreground)_1px,_transparent_0)] [background-size:24px_24px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b from-background to-transparent"
      />

      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10 sm:px-6">
        <header className="mb-8">
          <div className="text-[10px] font-medium uppercase text-muted-foreground/70">
            <Link to="/" className="hover:text-foreground">
              Home
            </Link>{' '}
            · Subscribe
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Pick a plan to continue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a plan to unlock this organisation. You can change or cancel anytime.
          </p>
        </header>

        <div className="grid gap-4">
          <PlanCard
            name="Pro"
            tagline="For small teams getting started."
            features={[
              'Up to 25 seats',
              'All core product features',
              'Email support',
              'Cancel anytime'
            ]}
            onSubscribe={handleSubscribe}
            busy={checkout.isPending}
            error={humaniseCheckoutError(checkout.error)}
          />
        </div>

        <footer className="mt-auto pt-10 text-center text-[10px] text-muted-foreground/60 uppercase">
          Card-on-file · Stripe secure checkout · Cancel anytime
        </footer>
      </div>
    </div>
  )
}

interface PlanCardProps {
  name: string
  tagline: string
  features: string[]
  onSubscribe: () => void
  busy: boolean
  error: string | null
}

function PlanCard({ name, tagline, features, onSubscribe, busy, error }: PlanCardProps) {
  return (
    <div className="relative rounded-lg border bg-card p-6 shadow-sm">
      <div
        aria-hidden
        className="absolute -top-px right-6 left-6 h-px bg-linear-to-r from-transparent via-foreground/30 to-transparent"
      />
      <div className="mb-2 text-[10px] font-medium uppercase text-muted-foreground">{name}</div>
      <h2 className="text-xl font-semibold tracking-tight">{name} plan</h2>
      <p className="mt-1 text-sm text-muted-foreground">{tagline}</p>

      <ul className="my-5 space-y-2 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-foreground/70" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <Button type="button" className="group w-full" onClick={onSubscribe} disabled={busy}>
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            Subscribe to {name}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </Button>
    </div>
  )
}

const humaniseCheckoutError = (err: unknown): string | null => {
  if (!err) return null

  if (err instanceof ApiError) {
    if (err.status === 409) {
      return 'This organisation already has an active subscription. Manage it from Settings → Billing.'
    }
    if (err.status === 403) return 'Only admins and owners can subscribe.'
    if (err.status === 404) return "Couldn't find this organisation."
    if (err.status >= 500) return 'Stripe is unreachable right now. Try again in a moment.'
  }

  return 'Could not start the checkout flow. Try again.'
}
