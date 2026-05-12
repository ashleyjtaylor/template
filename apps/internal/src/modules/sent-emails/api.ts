import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ApiError, api } from '@/lib/api'
import { sentEmailDetailSchema, sentEmailListSchema } from './schemas'

export const useSentEmailList = () =>
  useInfiniteQuery({
    queryKey: ['sent-emails'],
    queryFn: ({ pageParam }) => {
      const path = pageParam
        ? `/api/admin/sent-emails?cursor=${encodeURIComponent(pageParam)}`
        : '/api/admin/sent-emails'

      return api(path, sentEmailListSchema)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined
  })

export const useSentEmailDetail = (entityId: string) =>
  useQuery({
    queryKey: ['sent-emails', entityId],
    queryFn: () => api(`/api/admin/sent-emails/${entityId}`, sentEmailDetailSchema),
    // 401 / 403 / 404 are terminal — page UI handles each.
    retry: (_count, err) => !(err instanceof ApiError && [401, 403, 404].includes(err.status))
  })
