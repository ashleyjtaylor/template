import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ApiError, api } from '@/lib/api'
import { orgBillingDetailSchema, orgListSchema } from './schemas'

const buildListUrl = (cursor: string | undefined, search: string) => {
  const params = new URLSearchParams()

  if (cursor) params.set('cursor', cursor)
  if (search.trim().length > 0) params.set('search', search.trim())

  const qs = params.toString()

  return qs ? `/api/admin/orgs?${qs}` : '/api/admin/orgs'
}

export const useAdminOrgList = (search: string) =>
  useInfiniteQuery({
    queryKey: ['admin-orgs', search.trim()],
    queryFn: ({ pageParam }) => api(buildListUrl(pageParam, search), orgListSchema),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined
  })

export const useAdminOrgBilling = (orgEntityId: string) =>
  useQuery({
    queryKey: ['admin-orgs', orgEntityId, 'billing'],
    queryFn: () => api(`/api/admin/orgs/${orgEntityId}/billing`, orgBillingDetailSchema),
    enabled: orgEntityId.length > 0,
    // 401 / 403 / 404 are terminal — page UI handles each.
    retry: (_count, err) => !(err instanceof ApiError && [401, 403, 404].includes(err.status))
  })
