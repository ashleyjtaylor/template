import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api'
import {
  type InviteRole,
  invitationListSchema,
  memberListSchema,
  myOrgsSchema,
  type Role
} from './schemas'

const membersKey = (orgId: string) => ['org', orgId, 'members'] as const
const invitationsKey = (orgId: string) => ['org', orgId, 'invitations', 'pending'] as const
const MY_ORGS_KEY = ['orgs'] as const

export const useMyOrgs = () =>
  useQuery({
    queryKey: MY_ORGS_KEY,
    queryFn: () => api('/api/orgs', myOrgsSchema),
    staleTime: 60_000
  })

export const useMembers = (orgId: string) =>
  useQuery({
    queryKey: membersKey(orgId),
    queryFn: () => api(`/api/orgs/${orgId}/members`, memberListSchema),
    enabled: orgId.length > 0,
    // Admin surface — refetch on window focus + tab mount so an invite
    // accepted in another session is reflected without a manual refresh.
    staleTime: 0,
    refetchOnWindowFocus: true
  })

export const useInvitations = (orgId: string) =>
  useQuery({
    queryKey: invitationsKey(orgId),
    queryFn: () => api(`/api/orgs/${orgId}/invitations?status=pending`, invitationListSchema),
    enabled: orgId.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: true
  })

export const useCreateInvitation = (orgId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (input: { email: string; role: InviteRole }) =>
      api(`/api/orgs/${orgId}/invitations`, z.unknown(), {
        method: 'POST',
        body: input
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitationsKey(orgId) })
  })
}

export const useRevokeInvitation = (orgId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (invitationId: string) =>
      api(`/api/orgs/${orgId}/invitations/${invitationId}`, z.unknown(), {
        method: 'DELETE'
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitationsKey(orgId) })
  })
}

export const useChangeRole = (orgId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ userEntityId, role }: { userEntityId: string; role: Role }) =>
      api(`/api/orgs/${orgId}/members/${userEntityId}`, z.unknown(), {
        method: 'PATCH',
        body: { role }
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(orgId) })
  })
}

export const useRemoveMember = (orgId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (userEntityId: string) =>
      api(`/api/orgs/${orgId}/members/${userEntityId}`, z.unknown(), {
        method: 'DELETE'
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(orgId) })
  })
}

export const useLeaveOrg = (orgId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: () => api(`/api/orgs/${orgId}/leave`, z.unknown(), { method: 'POST', body: {} }),
    onSuccess: async () => {
      // Caller is no longer a member — every per-org query is stale and
      // the global org list shrunk.
      await Promise.all([
        qc.invalidateQueries({ queryKey: MY_ORGS_KEY }),
        qc.invalidateQueries({ queryKey: ['org', orgId] })
      ])
    }
  })
}

export const useTransferOwnership = (orgId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (newOwnerUserId: string) =>
      api(`/api/orgs/${orgId}/transfer-ownership`, z.unknown(), {
        method: 'POST',
        body: { newOwnerUserId }
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(orgId) })
  })
}
