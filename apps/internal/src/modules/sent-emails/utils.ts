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
