import { ChevronDown, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import {
  useChangeRole,
  useLeaveOrg,
  useMembers,
  useRemoveMember,
  useTransferOwnership
} from '../api'
import type { MemberRow, Role } from '../schemas'
import { formatDate, fullName, roleLabel } from '../utils'
import { ConfirmDialog } from './ConfirmDialog'

interface MembersSectionProps {
  orgId: string
  callerUserEntityId: string
  callerRole: Role
  onLeft: () => void
}

type Dialog =
  | { kind: 'remove'; target: MemberRow }
  | { kind: 'leave' }
  | { kind: 'transfer'; target: MemberRow }
  | null

export function MembersSection({
  orgId,
  callerUserEntityId,
  callerRole,
  onLeft
}: MembersSectionProps) {
  const members = useMembers(orgId)
  const changeRole = useChangeRole(orgId)
  const removeMember = useRemoveMember(orgId)
  const leaveOrg = useLeaveOrg(orgId)
  const transferOwnership = useTransferOwnership(orgId)
  const [dialog, setDialog] = useState<Dialog>(null)

  const handleChangeRole = async (target: MemberRow, role: Role) => {
    if (role === 'owner') {
      setDialog({ kind: 'transfer', target })

      return
    }

    try {
      await changeRole.mutateAsync({ userEntityId: target.user.entityId, role })
      toast.success(`Role updated to ${roleLabel[role]}`)
    } catch (err) {
      toast.error(humaniseError(err, 'change role'))
    }
  }

  const handleConfirmRemove = async () => {
    if (dialog?.kind !== 'remove') return

    try {
      await removeMember.mutateAsync(dialog.target.user.entityId)
      toast.success(`${fullName(dialog.target.user)} removed`)
      setDialog(null)
    } catch (err) {
      toast.error(humaniseError(err, 'remove member'))
      setDialog(null)
    }
  }

  const handleConfirmLeave = async () => {
    try {
      await leaveOrg.mutateAsync()
      toast.success('You left the organisation')
      setDialog(null)
      onLeft()
    } catch (err) {
      toast.error(humaniseError(err, 'leave'))
      setDialog(null)
    }
  }

  const handleConfirmTransfer = async () => {
    if (dialog?.kind !== 'transfer') return

    try {
      await transferOwnership.mutateAsync(dialog.target.user.entityId)
      toast.success(`${fullName(dialog.target.user)} is now the owner`)
      setDialog(null)
    } catch (err) {
      toast.error(humaniseError(err, 'transfer ownership'))
      setDialog(null)
    }
  }

  if (members.isLoading) {
    return (
      <section className="rounded-lg border bg-card/60 shadow-xs">
        <div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
              key={i}
              className="flex items-center justify-between border-b px-4 py-3 last:border-b-0"
            >
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (members.isError) {
    return (
      <section className="rounded-lg border bg-card/60 shadow-xs">
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
          Could not load members.
          <Button variant="link" size="sm" onClick={() => members.refetch()}>
            Try again
          </Button>
        </div>
      </section>
    )
  }

  const rows = members.data ?? []

  return (
    <section className="overflow-hidden rounded-lg border bg-card/60 shadow-xs">
      <ul>
        {rows.map((row) => {
          const isSelf = row.user.entityId === callerUserEntityId

          return (
            <li
              key={row.membership.entityId}
              className="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {fullName(row.user)}
                  {isSelf && (
                    <span className="ml-2 text-[10px] uppercase text-muted-foreground/60">you</span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">{row.user.email}</div>
              </div>

              <div className="hidden text-xs text-muted-foreground sm:block">
                Joined {formatDate(row.membership.createdAt)}
              </div>

              <RoleControl
                row={row}
                callerRole={callerRole}
                isSelf={isSelf}
                onSelectRole={(role) => handleChangeRole(row, role)}
              />

              <RowMenu
                row={row}
                isSelf={isSelf}
                callerRole={callerRole}
                onLeave={() => setDialog({ kind: 'leave' })}
                onRemove={() => setDialog({ kind: 'remove', target: row })}
              />
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={dialog?.kind === 'remove'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Remove member"
        description={
          dialog?.kind === 'remove' ? (
            <>
              Remove <strong>{fullName(dialog.target.user)}</strong> from this organisation? They
              will lose access immediately.
            </>
          ) : null
        }
        confirmLabel="Remove"
        destructive
        busy={removeMember.isPending}
        onConfirm={handleConfirmRemove}
      />

      <ConfirmDialog
        open={dialog?.kind === 'leave'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Leave organisation"
        description="You will lose access immediately. Owners must transfer ownership before leaving."
        confirmLabel="Leave"
        destructive
        busy={leaveOrg.isPending}
        onConfirm={handleConfirmLeave}
      />

      <ConfirmDialog
        open={dialog?.kind === 'transfer'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Transfer ownership"
        description={
          dialog?.kind === 'transfer' ? (
            <>
              Make <strong>{fullName(dialog.target.user)}</strong> the owner of this organisation?
              You will become an admin.
            </>
          ) : null
        }
        confirmLabel="Transfer"
        busy={transferOwnership.isPending}
        onConfirm={handleConfirmTransfer}
      />
    </section>
  )
}

interface RoleControlProps {
  row: MemberRow
  callerRole: Role
  isSelf: boolean
  onSelectRole: (role: Role) => void
}

function RoleControl({ row, callerRole, isSelf, onSelectRole }: RoleControlProps) {
  // Only owners can change roles. Owners can never demote themselves
  // inline — they must transfer ownership first.
  const canChange = callerRole === 'owner' && !isSelf

  if (!canChange) {
    return (
      <span className="w-20 text-right text-xs text-muted-foreground">
        {roleLabel[row.membership.role]}
      </span>
    )
  }

  const options: Role[] = ['member', 'admin', 'owner']

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-24 justify-between text-xs">
          {roleLabel[row.membership.role]}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option) => (
          <DropdownMenuItem
            key={option}
            disabled={option === row.membership.role}
            onSelect={() => onSelectRole(option)}
          >
            {roleLabel[option]}
            {option === 'owner' && (
              <span className="ml-2 text-[10px] text-muted-foreground">transfer</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface RowMenuProps {
  row: MemberRow
  isSelf: boolean
  callerRole: Role
  onLeave: () => void
  onRemove: () => void
}

function RowMenu({ row, isSelf, callerRole, onLeave, onRemove }: RowMenuProps) {
  // Render rules:
  // - self → "Leave organisation"
  // - admin viewing → can remove members only (not other admins/owners)
  // - owner viewing → can remove anyone except self
  const canRemove =
    !isSelf &&
    (callerRole === 'owner' || (callerRole === 'admin' && row.membership.role === 'member'))

  const items: { label: string; destructive?: boolean; onSelect: () => void }[] = []

  if (isSelf) items.push({ label: 'Leave organisation', destructive: true, onSelect: onLeave })
  else if (canRemove) items.push({ label: 'Remove', destructive: true, onSelect: onRemove })

  if (items.length === 0) {
    return <div className="w-8" aria-hidden />
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Open actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item, idx) => (
          <div key={item.label}>
            {idx > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={item.onSelect}
              className={item.destructive ? 'text-destructive' : ''}
            >
              {item.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const humaniseError = (err: unknown, verb: string): string => {
  if (err instanceof ApiError) {
    if (err.status === 409 && typeof err.message === 'string') return err.message
    if (err.status === 403) return 'You do not have permission to do this.'
  }

  return `Could not ${verb}. Try again.`
}
