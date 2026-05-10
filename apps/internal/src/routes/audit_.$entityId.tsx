import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Check, Copy, FileQuestion } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import { useAuditLogDetail } from '@/modules/audit-log/api'
import type { AuditLogRow } from '@/modules/audit-log/schemas'
import { formatTsFull, splitAction } from '@/modules/audit-log/utils'

export const Route = createFileRoute('/audit_/$entityId')({
  component: AuditDetailPage
})

const friendlyError = (err: unknown): string => {
  if (err instanceof ApiError && err.status >= 500) {
    return 'Something went wrong loading this event.'
  }

  return 'Could not load this audit event. Try again.'
}

function AuditDetailPage() {
  const { entityId } = Route.useParams()
  const navigate = useNavigate()
  const shortId = entityId.slice(-8)

  const event = useAuditLogDetail(entityId)

  // 401 → bounce to /login
  useEffect(() => {
    if (event.error instanceof ApiError && event.error.status === 401) {
      navigate({ to: '/login' })
    }
  }, [event.error, navigate])

  const is403 = event.error instanceof ApiError && event.error.status === 403
  const is404 = event.error instanceof ApiError && event.error.status === 404

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

      <div className="relative mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <Link
          to="/audit"
          className="mb-6 inline-flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        >
          <ArrowLeft className="size-3" />
          Back to audit log
        </Link>

        <header className="mb-8">
          <div className="text-[10px] font-medium text-muted-foreground/70 uppercase">
            Internal Console · /api/audit-log/{shortId}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Audit Event</h1>
        </header>

        {is403 ? (
          <NotAuthorisedBlock />
        ) : is404 ? (
          <NotFoundBlock shortId={shortId} />
        ) : event.isError ? (
          <ErrorBlock message={friendlyError(event.error)} onRetry={() => event.refetch()} />
        ) : event.isLoading || !event.data ? (
          <SkeletonBlocks />
        ) : (
          <DetailContent row={event.data} />
        )}
      </div>
    </div>
  )
}

// --- Detail content ---

function DetailContent({ row }: { row: AuditLogRow }) {
  const navigate = useNavigate()
  const { ns, verb } = splitAction(row.action)

  const filterByRequest = () => {
    if (!row.requestId) return

    navigate({ to: '/audit', search: { requestId: row.requestId } })
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-lg border bg-card/60 shadow-xs">
        {/* Left-edge accent — quietly signals "this is the inspected event" */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-4 left-0 w-px bg-gradient-to-b from-transparent via-foreground/30 to-transparent"
        />

        <div className="space-y-5 px-6 py-5">
          <div>
            <FieldLabel>Action</FieldLabel>
            <div className="mt-1.5 text-base">
              <span className="text-muted-foreground/60">{ns}</span>
              <span className="text-foreground">{verb}</span>
            </div>
          </div>

          <div>
            <FieldLabel>Timestamp</FieldLabel>
            <div className="mt-1.5 text-sm tabular-nums text-foreground">
              {formatTsFull(row.createdAt)}
            </div>
          </div>

          <div className="border-t" />

          <dl className="flex flex-col gap-3.5">
            <FieldRow label="Actor">
              {row.actorImpersonator ? (
                <span className="text-sm">
                  <span className="text-foreground">{row.actorUser?.email ?? <Dash />}</span>
                  <span className="text-muted-foreground"> impersonated by </span>
                  <span className="text-foreground">{row.actorImpersonator.email}</span>
                </span>
              ) : (
                <span className="text-sm text-foreground">{row.actorUser?.email ?? <Dash />}</span>
              )}
            </FieldRow>

            <FieldRow label="Resource">
              {row.resourceType && row.resourceId ? (
                <span className="font-mono text-xs">
                  <span className="text-muted-foreground/60">{row.resourceType}:</span>
                  <span className="text-foreground">{row.resourceId}</span>
                </span>
              ) : (
                <Dash />
              )}
            </FieldRow>

            <FieldRow label="Request ID">
              {row.requestId ? (
                <button
                  type="button"
                  onClick={filterByRequest}
                  className="font-mono text-xs text-foreground transition-colors hover:underline focus-visible:underline focus-visible:outline-none"
                  title="Filter audit log by this request ID"
                >
                  {row.requestId}
                </button>
              ) : (
                <Dash />
              )}
            </FieldRow>

            <FieldRow label="Entity ID">
              <span className="font-mono text-xs text-foreground">{row.entityId}</span>
            </FieldRow>

            <FieldRow label="IP">
              {row.ipAddress ? (
                <span className="font-mono text-xs text-foreground">{row.ipAddress}</span>
              ) : (
                <Dash />
              )}
            </FieldRow>

            <FieldRow label="User Agent">
              {row.userAgent ? (
                <span className="text-xs text-muted-foreground break-all">{row.userAgent}</span>
              ) : (
                <Dash />
              )}
            </FieldRow>
          </dl>
        </div>
      </section>

      <DetailsJsonSection details={row.details} />
    </div>
  )
}

// --- JSON viewer with copy ---

function DetailsJsonSection({ details }: { details: unknown }) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(details, null, 2)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore — clipboard API may be unavailable in some contexts */
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card/60 shadow-xs">
      <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-2.5">
        <span className="text-[10px] font-medium text-muted-foreground uppercase">Details</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        >
          {copied ? (
            <>
              <Check className="size-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copy JSON
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed text-foreground">
        {json}
      </pre>
    </section>
  )
}

// --- Field components ---

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[10px] font-medium text-muted-foreground uppercase">{children}</span>
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-6">
      <dt className="w-27.5 shrink-0 text-[10px] font-medium text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  )
}

function Dash() {
  return <span className="text-muted-foreground/30">—</span>
}

// --- States ---

function SkeletonBlocks() {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-card/60 px-6 py-5 shadow-xs">
        <div className="space-y-5">
          <div>
            <Skeleton className="h-3 w-12" />
            <Skeleton className="mt-2 h-5 w-48" />
          </div>

          <div>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-4 w-64" />
          </div>

          <div className="flex flex-col gap-3.5 border-t pt-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
                key={i}
                className="flex items-baseline gap-6"
              >
                <Skeleton className="h-3 w-20 shrink-0" />
                <Skeleton className="h-3 w-44" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-card/60 shadow-xs">
        <div className="border-b bg-muted/20 px-4 py-2.5">
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="space-y-2 px-4 py-4">
          <Skeleton className="h-3 w-full max-w-md" />
          <Skeleton className="h-3 w-full max-w-lg" />
          <Skeleton className="h-3 w-full max-w-sm" />
        </div>
      </section>
    </div>
  )
}

function NotAuthorisedBlock() {
  return (
    <div className="overflow-hidden rounded-lg border bg-card/60 shadow-xs">
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
        <div className="text-[10px] text-destructive uppercase">403 — Forbidden</div>
        <p className="text-sm text-foreground">Staff access required to view this page.</p>
        <p className="max-w-md text-xs text-muted-foreground">
          Your account is signed in but does not have a staff role.
        </p>
      </div>
    </div>
  )
}

function NotFoundBlock({ shortId }: { shortId: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card/60 shadow-xs">
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
        <FileQuestion className="size-5 text-muted-foreground/40" aria-hidden />
        <div className="text-[10px] text-muted-foreground uppercase">404 — Not Found</div>
        <p className="text-sm text-foreground">
          No audit event with ID <span className="font-mono">{shortId}</span>.
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          It may have been anonymised or never existed.
        </p>
        <Link to="/audit" className="mt-2">
          <Button variant="outline" size="sm">
            <ArrowLeft className="size-3" />
            Back to audit log
          </Button>
        </Link>
      </div>
    </div>
  )
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card/60 shadow-xs">
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
        <div className="text-[10px] text-destructive uppercase">Error</div>
        <p className="text-sm text-foreground">{message}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}
