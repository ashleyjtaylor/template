import { createFileRoute, Link } from '@tanstack/react-router'
import { Building2, ChevronRight, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useMyOrgs } from '@/modules/org-management/api'
import { roleLabel } from '@/modules/org-management/utils'
import { useSession } from '@/modules/session/api'

export const Route = createFileRoute('/')({
  component: HomePage
})

function HomePage() {
  const { user } = useSession()
  const firstname = user?.name.split(' ')[0] ?? 'there'

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

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-8">
          <div className="text-[10px] font-medium uppercase text-muted-foreground/70">Home</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Welcome, {firstname}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your dashboard. Real widgets land here as the product grows.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <OrganisationsCard />
          <PlaceholderCard title="TBD widget">
            Per-product content slots in here. Replace this card when the first real surface lands.
          </PlaceholderCard>
        </div>
      </div>
    </div>
  )
}

function OrganisationsCard() {
  const orgs = useMyOrgs()

  return (
    <section className="rounded-lg border bg-card text-sm shadow-xs">
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Organisations</h2>
        <p className="text-xs text-muted-foreground">Teams you belong to.</p>
      </header>

      {orgs.isLoading ? (
        <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Loading…
        </div>
      ) : orgs.isError ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">
          <Skeleton className="h-4 w-32" />
        </div>
      ) : (orgs.data ?? []).length === 0 ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">
          You don't belong to any organisations yet.
        </div>
      ) : (
        <ul>
          {orgs.data?.map(({ organisation, membership }) => (
            <li key={organisation.entityId}>
              <Link
                to="/orgs/$orgId/settings/people"
                params={{ orgId: organisation.entityId }}
                className="group flex items-center justify-between gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-accent/40"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Building2 className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{organisation.name}</div>
                    <div className="text-[10px] uppercase text-muted-foreground/70">
                      {roleLabel[membership.role]}
                    </div>
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface PlaceholderCardProps {
  title: string
  children: ReactNode
}

function PlaceholderCard({ title, children }: PlaceholderCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 text-sm">
      <h2 className="mb-1 text-sm font-medium">{title}</h2>
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  )
}
