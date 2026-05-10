import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import { routeTree } from '@/routeTree.gen'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Conservative defaults: avoid surprise refetches; pages opt-in to
      // shorter staleTime when they want fresher data.
      staleTime: 30_000,
      refetchOnWindowFocus: false
    }
  }
})

// Router context exposes queryClient to route loaders and beforeLoad hooks.
// Loaders can call `queryClient.ensureQueryData(...)` to preload before render.
const router = createRouter({
  routeTree,
  context: { queryClient }
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const root = document.getElementById('root')

if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
