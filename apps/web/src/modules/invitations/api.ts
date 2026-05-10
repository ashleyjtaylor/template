import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  type AcceptInvitationResponse,
  acceptInvitationResponseSchema,
  invitationPreviewSchema
} from './schemas'

export const usePreviewInvite = (token: string) =>
  useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => api(`/api/invitations/${encodeURIComponent(token)}`, invitationPreviewSchema),
    enabled: token.length > 0,
    staleTime: 30_000,
    retry: false
  })

export const useAcceptInvite = () => {
  const queryClient = useQueryClient()

  return useMutation<AcceptInvitationResponse, Error, { token: string }>({
    mutationFn: ({ token }) =>
      api(`/api/invitations/${encodeURIComponent(token)}/accept`, acceptInvitationResponseSchema, {
        method: 'POST'
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] })
  })
}
