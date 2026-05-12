import { createFileRoute, Link } from '@tanstack/react-router'
import { Building2, ChevronDown, Loader2, Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import { useAdminOrgList } from '@/modules/admin-orgs/api'
import type { OrgRow } from '@/modules/admin-orgs/schemas'
import { formatDateCompact } from '@/modules/admin-orgs/utils'

export const Route = createFileRoute('/orgs')({
  component: OrgsPage
})

const friendlyError = (err: unknown): string => {
  if (err instanceof ApiError && err.status >= 500) {
    return 'Something went wrong loading organisations.'
  }

  return 'Could not load organisations. Try again.'
}

function OrgsPage() {
  const [search, setSearch] = useState('')
  const list = useAdminOrgList(search)
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? []
  const is403 = list.error instanceof ApiError && list.error.status === 403

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

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <div className="text-[10px] font-medium uppercase text-muted-foreground/70">
            Internal Console · /api/admin/orgs
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Organisations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Customer organisations + their billing state.
          </p>
        </header>

        <div className="mb-4 flex items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60"
            />
            <Input
              type="search"
              placeholder="Search by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              aria-label="Search organisations by name"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border bg-card/60 shadow-xs">
          <div className="grid grid-cols-[minmax(220px,1.6fr)_minmax(220px,1.4fr)_90px_120px_120px] gap-4 border-b bg-muted/30 px-4 py-2.5 text-[10px] font-medium uppercase text-muted-foreground">
            <div>Organisation</div>
            <div>Owner</div>
            <div className="text-right">Members</div>
            <div>Plan</div>
            <div>Status</div>
          </div>

          {is403 ? (
            <NotAuthorisedBlock />
          ) : list.isError ? (
            <ErrorBlock message={friendlyError(list.error)} onRetry={() => list.refetch()} />
          ) : list.isLoading ? (
            <SkeletonRows />
          ) : rows.length === 0 ? (
            <EmptyState hasSearch={search.trim().length > 0} />
          ) : (
            <>
              {rows.map((row) => (
                <RowItem key={row.entityId} row={row} />
              ))}

              {list.hasNextPage && (
                <div className="flex justify-center border-t bg-muted/20 p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => list.fetchNextPage()}
                    disabled={list.isFetchingNextPage}
                    className="gap-2"
                  >
                    {list.isFetchingNextPage ? (
                      <>
                        <Loader2 className="size-3 animate-spin" />
                        Loading
                      </>
                    ) : (
                      <>
                        Load more
                        <ChevronDown className="size-3" />
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {!list.isLoading && !is403 && rows.length > 0 && (
          <div className="mt-4 text-center text-[10px] uppercase text-muted-foreground/60">
            {rows.length} {rows.length === 1 ? 'organisation' : 'organisations'}
            {list.hasNextPage ? ' · more available' : ''}
          </div>
        )}
      </div>
    </div>
  )
}

function RowItem({ row }: { row: OrgRow }) {
  return (
    <Link
      to="/orgs/$entityId/billing"
      params={{ entityId: row.entityId }}
      className="grid grid-cols-[minmax(220px,1.6fr)_minmax(220px,1.4fr)_90px_120px_120px] items-center gap-4 border-b px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Building2 className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{row.name}</div>
          <div className="truncate text-[10px] text-muted-foreground/70">
            created {formatDateCompact(row.createdAt)}
          </div>
        </div>
      </div>
      <div className="truncate text-xs text-muted-foreground">{row.ownerEmail ?? <Dash />}</div>
      <div className="text-right text-xs tabular-nums text-muted-foreground">{row.memberCount}</div>
      <div className="truncate text-xs text-muted-foreground">
        {row.subscription?.planKey ?? <Dash />}
      </div>
      <StatusBadge subscription={row.subscription} />
    </Link>
  )
}

function StatusBadge({ subscription }: { subscription: OrgRow['subscription'] }) {
  if (!subscription) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        none
      </span>
    )
  }

  const status = subscription.status
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
      className={`rounded-full px-2 py-0.5 text-center text-[10px] font-medium uppercase tracking-wide ${tone}`}
    >
      {status}
    </span>
  )
}

function Dash() {
  return <span className="text-muted-foreground/30">—</span>
}

function SkeletonRows() {
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder
          key={i}
          className="grid grid-cols-[minmax(220px,1.6fr)_minmax(220px,1.4fr)_90px_120px_120px] gap-4 border-b px-4 py-3 last:border-b-0"
        >
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto h-4 w-8" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-20 text-center">
      <Building2 className="size-5 text-muted-foreground/40" aria-hidden />
      <p className="text-sm text-muted-foreground">
        {hasSearch ? 'No organisations match this search.' : 'No organisations yet.'}
      </p>
    </div>
  )
}

function NotAuthorisedBlock() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <div className="text-[10px] uppercase text-destructive">403 — Forbidden</div>
      <p className="text-sm text-foreground">Staff access required to view this page.</p>
    </div>
  )
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <div className="text-[10px] uppercase text-destructive">Error</div>
      <p className="text-sm text-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
