import type { Role } from './schemas'

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: '2-digit'
})

export const formatDate = (iso: string): string => dateFormatter.format(new Date(iso))

export const fullName = (u: { firstname: string; lastname: string; email: string }): string => {
  const composed = `${u.firstname} ${u.lastname}`.trim()

  return composed.length > 0 ? composed : u.email
}

export const roleLabel: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member'
}
