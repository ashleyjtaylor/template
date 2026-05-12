import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { useSentEmailDetail } from '@/modules/sent-emails/api'
import { formatTsFull } from '@/modules/sent-emails/utils'

export const Route = createFileRoute('/emails_/$entityId')({
  component: EmailDetailPage
})

function EmailDetailPage() {
  const { entityId } = Route.useParams()
  const detail = useSentEmailDetail(entityId)

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
          to="/emails"
          className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3" />
          Back to list
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
          <NotAuthorisedBlock
            title="404 — Not found"
            detail="This email record does not exist (or was hard-deleted)."
          />
        )}
        {detail.isError && !is401 && !is403 && !is404 && (
          <ErrorBlock message="Could not load this email." onRetry={() => detail.refetch()} />
        )}

        {detail.data && (
          <>
            <header className="mb-6">
              <div className="text-[10px] font-medium text-muted-foreground/70 uppercase">
                Sent Email · {detail.data.entityId}
              </div>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">{detail.data.subject}</h1>
            </header>

            <dl className="mb-6 grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border bg-card/60 p-4 text-sm shadow-xs sm:grid-cols-2">
              <Field label="To">{detail.data.recipient}</Field>
              <Field label="Template">{detail.data.template}</Field>
              <Field label="Status">
                <span className={statusColor(detail.data.status)}>{detail.data.status}</span>
              </Field>
              <Field label="Dedupe key" mono>
                {detail.data.dedupeKey}
              </Field>
              <Field label="Created">{formatTsFull(detail.data.createdAt)}</Field>
              <Field label="Sent">
                {detail.data.sentAt ? formatTsFull(detail.data.sentAt) : <Dash />}
              </Field>
              <Field label="Message ID" mono>
                {detail.data.messageId ?? <Dash />}
              </Field>
              <Field label="Request ID" mono>
                {detail.data.requestId ?? <Dash />}
              </Field>
              {detail.data.lastError && (
                <Field label="Last error" full>
                  <span className="text-destructive">{detail.data.lastError}</span>
                </Field>
              )}
            </dl>

            <div className="overflow-hidden rounded-lg border bg-card/60 shadow-xs">
              <div className="border-b bg-muted/30 px-4 py-2 text-[10px] font-medium text-muted-foreground uppercase">
                Rendered preview
              </div>
              {/* Iframe-sandboxed so any inline scripts or external resources
                  in the rendered HTML can't escape into the SPA's origin. */}
              <iframe
                title="Rendered email preview"
                sandbox=""
                srcDoc={detail.data.html}
                className="h-[600px] w-full bg-white"
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  mono,
  full
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
  full?: boolean
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <dt className="text-[10px] font-medium text-muted-foreground uppercase">{label}</dt>
      <dd className={mono ? 'mt-1 font-mono text-xs' : 'mt-1 text-sm'}>{children}</dd>
    </div>
  )
}

function Dash() {
  return <span className="text-muted-foreground/30">—</span>
}

const statusColor = (status: string): string => {
  if (status === 'sent') return 'text-emerald-600 font-medium'
  if (status === 'failed') return 'text-destructive font-medium'

  return 'text-muted-foreground'
}

function NotAuthorisedBlock({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card/60 px-4 py-20 text-center shadow-xs">
      <div className="text-[10px] text-destructive uppercase">{title}</div>
      <p className="text-sm text-foreground">{detail}</p>
    </div>
  )
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card/60 px-4 py-20 text-center shadow-xs">
      <div className="text-[10px] text-destructive uppercase">Error</div>
      <p className="text-sm text-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
