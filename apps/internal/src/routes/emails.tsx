import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronDown, Inbox, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import { useSentEmailList } from '@/modules/sent-emails/api'
import type { SentEmailRow } from '@/modules/sent-emails/schemas'
import { formatTsCompact } from '@/modules/sent-emails/utils'

export const Route = createFileRoute('/emails')({
  component: EmailsPage
})

const friendlyError = (err: unknown): string => {
  if (err instanceof ApiError && err.status >= 500) {
    return 'Something went wrong loading sent emails.'
  }

  return 'Could not load sent emails. Try again.'
}

function EmailsPage() {
  const list = useSentEmailList()
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
        <header className="mb-8">
          <div className="text-[10px] font-medium text-muted-foreground/70 uppercase">
            Internal Console · /api/admin/sent-emails
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sent Emails</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every email the worker has attempted to send.
          </p>
        </header>

        <div className="overflow-hidden rounded-lg border bg-card/60 shadow-xs">
          <div className="grid grid-cols-[180px_minmax(220px,1.4fr)_140px_minmax(220px,1fr)_100px] gap-4 border-b bg-muted/30 px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase">
            <div>Timestamp</div>
            <div>Recipient</div>
            <div>Template</div>
            <div>Subject</div>
            <div className="text-right">Status</div>
          </div>

          {is403 ? (
            <NotAuthorisedBlock />
          ) : list.isError ? (
            <ErrorBlock message={friendlyError(list.error)} onRetry={() => list.refetch()} />
          ) : list.isLoading ? (
            <SkeletonRows />
          ) : rows.length === 0 ? (
            <EmptyState />
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
          <div className="mt-4 text-center text-[10px] text-muted-foreground/60 uppercase">
            {rows.length} {rows.length === 1 ? 'email' : 'emails'}
            {list.hasNextPage ? ' · more available' : ''}
          </div>
        )}
      </div>
    </div>
  )
}

const statusColor = (status: string): string => {
  if (status === 'sent') return 'text-emerald-600'
  if (status === 'failed') return 'text-destructive'

  return 'text-muted-foreground'
}

function RowItem({ row }: { row: SentEmailRow }) {
  return (
    <Link
      to="/emails/$entityId"
      params={{ entityId: row.entityId }}
      className="grid grid-cols-[180px_minmax(220px,1.4fr)_140px_minmax(220px,1fr)_100px] items-center gap-4 border-b px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
    >
      <div className="text-xs text-muted-foreground tabular-nums">
        {formatTsCompact(row.createdAt)}
      </div>
      <div className="truncate text-xs text-foreground">{row.recipient}</div>
      <div className="truncate font-mono text-xs text-muted-foreground">{row.template}</div>
      <div className="truncate text-xs text-foreground">{row.subject}</div>
      <div className={`text-right text-[10px] font-medium uppercase ${statusColor(row.status)}`}>
        {row.status}
      </div>
    </Link>
  )
}

function SkeletonRows() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
          key={i}
          className="grid grid-cols-[180px_minmax(220px,1.4fr)_140px_minmax(220px,1fr)_100px] gap-4 border-b px-4 py-3 last:border-b-0"
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto h-4 w-12" />
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <Inbox className="size-5 text-muted-foreground/40" aria-hidden />
      <p className="text-sm text-muted-foreground">No emails sent yet.</p>
    </div>
  )
}

function NotAuthorisedBlock() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <div className="text-[10px] text-destructive uppercase">403 — Forbidden</div>
      <p className="text-sm text-foreground">Staff access required to view this page.</p>
    </div>
  )
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <div className="text-[10px] text-destructive uppercase">Error</div>
      <p className="text-sm text-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
