const compactTsFormatter = new Intl.DateTimeFormat('en-GB', {
  year: '2-digit',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
})

const fullTsFormatter = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'long',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short'
})

export const formatTsCompact = (iso: string): string => compactTsFormatter.format(new Date(iso))
export const formatTsFull = (iso: string): string => fullTsFormatter.format(new Date(iso))

// 'user.signed_up' → { ns: 'user.', verb: 'signed_up' }
// 'org.member.invited' → { ns: 'org.member.', verb: 'invited' }
// 'login' → { ns: '', verb: 'login' }
export const splitAction = (action: string): { ns: string; verb: string } => {
  const idx = action.lastIndexOf('.')
  if (idx === -1) return { ns: '', verb: action }

  return { ns: action.slice(0, idx + 1), verb: action.slice(idx + 1) }
}
