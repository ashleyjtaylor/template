import { createFileRoute } from '@tanstack/react-router'

// Placeholder for the audit log list page (chunk 10). Exists today only so
// the typed `useNavigate({ to: '/audit' })` from the login page resolves.
export const Route = createFileRoute('/audit')({
  component: () => <div className="p-8 text-sm text-muted-foreground">Audit log — coming next.</div>
})
