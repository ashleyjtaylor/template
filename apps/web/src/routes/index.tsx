import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
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
          <PlaceholderCard title="TBD widget">
            Per-product content slots in here. Replace this card when the first real surface lands.
          </PlaceholderCard>
        </div>
      </div>
    </div>
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
