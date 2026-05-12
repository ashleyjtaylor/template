import { Toaster as SonnerToaster } from 'sonner'

// Single Toaster instance mounted in __root.tsx. Sonner exports a `toast`
// function consumers call directly — see `import { toast } from 'sonner'`
// in feature modules.
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: 'rounded-lg border bg-card text-card-foreground shadow-lg',
          description: 'text-muted-foreground'
        }
      }}
    />
  )
}
