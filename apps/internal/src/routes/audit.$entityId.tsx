import { createFileRoute } from '@tanstack/react-router'

// Placeholder for the audit event detail page (chunk 11). Exists today so
// the typed `<Link to="/audit/$entityId">` from the list page resolves.
export const Route = createFileRoute('/audit/$entityId')({
  component: DetailPlaceholder
})

function DetailPlaceholder() {
  const { entityId } = Route.useParams()

  return (
    <div className="p-8 text-sm text-muted-foreground">
      Audit event detail — coming next: <span className="font-mono">{entityId}</span>
    </div>
  )
}
