import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, Inbox, Loader2, RotateCcw } from 'lucide-react'
import { type ReactNode, useEffect, useId } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, api } from '@/lib/api'
import { type AuditLogRow, auditLogRowSchema, formatTsCompact, splitAction } from '@/lib/audit-log'

// --- Schemas ---

const auditLogListSchema = z.object({
  rows: z.array(auditLogRowSchema),
  nextCursor: z.string().nullable()
})

const auditLogActionsSchema = z.object({
  actions: z.array(z.string())
})

// Search params kept as datetime-local strings (browser-tz) for direct binding
// to <input type="datetime-local">. Converted to ISO at the API call site so
// the server gets timezone-anchored values.
const searchSchema = z.object({
  action: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  requestId: z.string().optional()
})

type Search = z.infer<typeof searchSchema>

// --- Route ---

export const Route = createFileRoute('/audit')({
  validateSearch: searchSchema,
  component: AuditPage
})

// --- Helpers ---

const buildQuery = (search: Search, cursor?: string): string => {
  const params = new URLSearchParams()

  if (search.action) params.set('action', search.action)
  if (search.from) params.set('from', new Date(search.from).toISOString())
  if (search.to) params.set('to', new Date(search.to).toISOString())
  if (search.requestId) params.set('requestId', search.requestId)
  if (cursor) params.set('cursor', cursor)

  return params.toString()
}

const friendlyError = (err: unknown): string => {
  if (err instanceof ApiError && err.status >= 500) {
    return 'Something went wrong loading audit events.'
  }

  return 'Could not load audit events. Try again.'
}

// --- Page ---

function AuditPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const actionId = useId()
  const fromId = useId()
  const toId = useId()
  const reqIdId = useId()

  const list = useInfiniteQuery({
    queryKey: ['audit-log', search],
    queryFn: ({ pageParam }) => {
      const qs = buildQuery(search, pageParam)
      const path = qs ? `/api/audit-log?${qs}` : '/api/audit-log'

      return api(path, auditLogListSchema)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined
  })

  const actions = useQuery({
    queryKey: ['audit-log-actions'],
    queryFn: () => api('/api/audit-log/actions', auditLogActionsSchema),
    staleTime: 5 * 60_000
  })

  // 401 means no session — bounce to /login.
  useEffect(() => {
    if (list.error instanceof ApiError && list.error.status === 401) {
      navigate({ to: '/login' })
    }
  }, [list.error, navigate])

  const updateFilter = (patch: Partial<Search>) => {
    navigate({
      to: '/audit',
      search: (prev) => {
        const next: Record<string, string | undefined> = { ...prev, ...patch }

        for (const key of Object.keys(next)) {
          if (next[key] === '' || next[key] === undefined) delete next[key]
        }

        return next
      }
    })
  }

  const clearFilters = () => navigate({ to: '/audit', search: {} })

  const hasFilters = Boolean(search.action || search.from || search.to || search.requestId)
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? []
  const is403 = list.error instanceof ApiError && list.error.status === 403

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Engineering dot-grid — same backdrop as login. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,_var(--foreground)_1px,_transparent_0)] [background-size:24px_24px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent"
      />

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-8 animate-in fade-in slide-in-from-bottom-1 duration-500">
          <div className="font-mono text-[10px] font-medium tracking-[0.2em] text-muted-foreground/70 uppercase">
            Internal Console · /api/audit-log
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Audit Log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Append-only record of state-changing actions.
          </p>
        </header>

        <div
          className="mb-6 rounded-lg border bg-card/60 shadow-xs animate-in fade-in slide-in-from-bottom-1 duration-500 fill-mode-backwards"
          style={{ animationDelay: '60ms' }}
        >
          <div className="flex flex-wrap items-end gap-3 p-3">
            <FilterField label="Action" htmlFor={actionId}>
              <select
                id={actionId}
                value={search.action ?? ''}
                onChange={(e) => updateFilter({ action: e.target.value || undefined })}
                disabled={actions.isLoading}
                className="h-9 w-full min-w-[10rem] rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none transition-[color,box-shadow,border-color] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">All</option>
                {actions.data?.actions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="From" htmlFor={fromId}>
              <Input
                id={fromId}
                type="datetime-local"
                value={search.from ?? ''}
                onChange={(e) => updateFilter({ from: e.target.value || undefined })}
                className="font-mono text-xs"
              />
            </FilterField>

            <FilterField label="To" htmlFor={toId}>
              <Input
                id={toId}
                type="datetime-local"
                value={search.to ?? ''}
                onChange={(e) => updateFilter({ to: e.target.value || undefined })}
                className="font-mono text-xs"
              />
            </FilterField>

            <FilterField label="Request ID" htmlFor={reqIdId}>
              <Input
                id={reqIdId}
                type="text"
                placeholder="req_..."
                value={search.requestId ?? ''}
                onChange={(e) => updateFilter({ requestId: e.target.value || undefined })}
                className="font-mono text-xs"
              />
            </FilterField>

            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="ml-auto inline-flex h-9 items-center gap-1.5 px-2 font-mono text-[10px] tracking-[0.15em] text-muted-foreground uppercase transition-colors hover:text-foreground"
              >
                <RotateCcw className="size-3" />
                Clear
              </button>
            )}
          </div>
        </div>

        <div
          className="overflow-hidden rounded-lg border bg-card/60 shadow-xs animate-in fade-in slide-in-from-bottom-1 duration-500 fill-mode-backwards"
          style={{ animationDelay: '120ms' }}
        >
          <div className="grid grid-cols-[180px_minmax(180px,1fr)_minmax(220px,1.4fr)_minmax(160px,1fr)_120px] gap-4 border-b bg-muted/30 px-4 py-2.5 font-mono text-[10px] font-medium tracking-[0.15em] text-muted-foreground uppercase">
            <div>Timestamp</div>
            <div>Action</div>
            <div>Actor</div>
            <div>Resource</div>
            <div className="text-right">Request</div>
          </div>

          {is403 ? (
            <NotAuthorisedBlock />
          ) : list.isError ? (
            <ErrorBlock message={friendlyError(list.error)} onRetry={() => list.refetch()} />
          ) : list.isLoading ? (
            <SkeletonRows />
          ) : rows.length === 0 ? (
            <EmptyState hasFilters={hasFilters} />
          ) : (
            <>
              {rows.map((row) => (
                <RowItem
                  key={row.entityId}
                  row={row}
                  onFilterByRequest={(rid) => updateFilter({ requestId: rid })}
                />
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
          <div className="mt-4 text-center font-mono text-[10px] tracking-[0.15em] text-muted-foreground/60 uppercase">
            {rows.length} {rows.length === 1 ? 'event' : 'events'}
            {list.hasNextPage ? ' · more available' : ''}
          </div>
        )}
      </div>
    </div>
  )
}

// --- Sub-components ---

function FilterField({
  label,
  htmlFor,
  children
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="font-mono text-[10px] font-medium tracking-[0.2em] text-muted-foreground uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function RowItem({
  row,
  onFilterByRequest
}: {
  row: AuditLogRow
  onFilterByRequest: (requestId: string) => void
}) {
  const { ns, verb } = splitAction(row.action)
  const requestIdShort = row.requestId ? row.requestId.slice(-8) : null

  return (
    <Link
      to="/audit/$entityId"
      params={{ entityId: row.entityId }}
      className="grid grid-cols-[180px_minmax(180px,1fr)_minmax(220px,1.4fr)_minmax(160px,1fr)_120px] items-center gap-4 border-b px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
    >
      <div className="font-mono text-xs text-muted-foreground tabular-nums">
        {formatTsCompact(row.createdAt)}
      </div>
      <div className="font-mono text-xs">
        <span className="text-muted-foreground/60">{ns}</span>
        <span className="text-foreground">{verb}</span>
      </div>
      <div className="truncate text-xs text-foreground">{row.actorUser?.email ?? <Dash />}</div>
      <div className="truncate font-mono text-xs">
        {row.resourceType && row.resourceId ? (
          <>
            <span className="text-muted-foreground/60">{row.resourceType}:</span>
            <span className="text-foreground">{row.resourceId}</span>
          </>
        ) : (
          <Dash />
        )}
      </div>
      <div className="text-right">
        {requestIdShort && row.requestId ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onFilterByRequest(row.requestId as string)
            }}
            className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline focus-visible:outline-none"
          >
            {requestIdShort}
          </button>
        ) : (
          <Dash />
        )}
      </div>
    </Link>
  )
}

function Dash() {
  return <span className="text-muted-foreground/30">—</span>
}

function SkeletonRows() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
          key={i}
          className="grid grid-cols-[180px_minmax(180px,1fr)_minmax(220px,1.4fr)_minmax(160px,1fr)_120px] gap-4 border-b px-4 py-3 last:border-b-0"
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <Inbox className="size-5 text-muted-foreground/40" aria-hidden />
      <p className="text-sm text-muted-foreground">
        {hasFilters ? 'No events match these filters.' : 'No audit events yet.'}
      </p>
    </div>
  )
}

function NotAuthorisedBlock() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <div className="font-mono text-[10px] tracking-[0.2em] text-destructive uppercase">
        403 — Forbidden
      </div>
      <p className="text-sm text-foreground">Staff access required to view this page.</p>
      <p className="max-w-md text-xs text-muted-foreground">
        Your account is signed in but does not have a staff role. Speak to an existing staff member
        to be granted access.
      </p>
    </div>
  )
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <div className="font-mono text-[10px] tracking-[0.2em] text-destructive uppercase">Error</div>
      <p className="text-sm text-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
