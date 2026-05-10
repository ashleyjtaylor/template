import { createFileRoute } from '@tanstack/react-router'
import { LayoutGrid } from 'lucide-react'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/')({
  component: HomePage
})

function HomePage() {
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
          <div className="text-[10px] font-medium uppercase text-muted-foreground/70">
            Internal Console · Home
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Operational overview. Widgets land here as the platform grows.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <PlaceholderCard title="Recent activity">
            Aggregated audit-log feed across all customer orgs.
          </PlaceholderCard>
          <PlaceholderCard title="Sign-ups (last 7d)">
            New user count, broken down by signup method.
          </PlaceholderCard>
          <PlaceholderCard title="Failed jobs">
            BullMQ failures from the last 24 hours; click through to the queue.
          </PlaceholderCard>
        </div>
      </div>
    </div>
  )
}

function PlaceholderCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-dashed bg-card/40 p-5 shadow-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <LayoutGrid className="size-4" />
        <span className="text-[10px] font-medium uppercase">TBD</span>
      </div>
      <h2 className="mt-3 text-sm font-medium text-foreground">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{children}</p>
    </section>
  )
}
