import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api'

const healthSchema = z.object({
  status: z.string(),
  version: z.string(),
  env: z.enum(['local', 'staging', 'production']),
  uptime: z.number()
})

export function EnvBadge() {
  const { data } = useQuery({
    queryKey: ['health'],
    queryFn: () => api('/health', healthSchema),
    // Reflects the deployed API; refetch on focus so the badge catches a
    // fresh deploy without a page reload.
    staleTime: 60_000,
    refetchOnWindowFocus: true
  })

  if (!data) return null

  const sha8 = data.version.slice(0, 8)

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
      <span
        aria-hidden
        className={
          data.env === 'production'
            ? 'size-1.5 rounded-full bg-destructive'
            : data.env === 'staging'
              ? 'size-1.5 rounded-full bg-yellow-500'
              : 'size-1.5 rounded-full bg-emerald-500'
        }
      />
      <span>{data.env}</span>
      <span className="text-muted-foreground/40">·</span>
      <span className="font-mono normal-case">{sha8}</span>
    </div>
  )
}
