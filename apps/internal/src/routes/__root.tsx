import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'

// `createRootRouteWithContext` declares the context shape that flows from
// the router's top-level `context: { queryClient }` (set in main.tsx).
// Loaders and beforeLoad hooks can then read it via `({ context }) => ...`.
export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <div>
      <h1>Internal Dashboard</h1>
      <Outlet />
    </div>
  )
})
