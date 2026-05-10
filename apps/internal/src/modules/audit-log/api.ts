import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ApiError, api } from '@/lib/api'
import {
  type AuditLogSearch,
  auditLogActionsSchema,
  auditLogListSchema,
  auditLogRowSchema
} from './schemas'

const buildListQuery = (search: AuditLogSearch, cursor?: string): string => {
  const params = new URLSearchParams()

  if (search.action) params.set('action', search.action)
  if (search.from) params.set('from', new Date(search.from).toISOString())
  if (search.to) params.set('to', new Date(search.to).toISOString())
  if (search.requestId) params.set('requestId', search.requestId)
  if (cursor) params.set('cursor', cursor)

  return params.toString()
}

export const useAuditLogList = (search: AuditLogSearch) =>
  useInfiniteQuery({
    queryKey: ['audit-log', search],
    queryFn: ({ pageParam }) => {
      const qs = buildListQuery(search, pageParam)
      const path = qs ? `/api/audit-log?${qs}` : '/api/audit-log'

      return api(path, auditLogListSchema)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined
  })

export const useAuditLogActions = () =>
  useQuery({
    queryKey: ['audit-log-actions'],
    queryFn: () => api('/api/audit-log/actions', auditLogActionsSchema),
    // Action list is derived from existing rows server-side; cache for 5 min
    // so the dropdown doesn't refetch on every list filter change.
    staleTime: 5 * 60_000
  })

export const useAuditLogDetail = (entityId: string) =>
  useQuery({
    queryKey: ['audit-log', entityId],
    queryFn: () => api(`/api/audit-log/${entityId}`, auditLogRowSchema),
    // 401 / 403 / 404 are terminal — page-level UI handles each. Other errors
    // (5xx, network) get the default retry policy.
    retry: (_count, err) => !(err instanceof ApiError && [401, 403, 404].includes(err.status))
  })
