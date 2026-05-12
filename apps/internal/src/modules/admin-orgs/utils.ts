const compactTsFormatter = new Intl.DateTimeFormat('en-GB', {
  year: '2-digit',
  month: 'short',
  day: '2-digit'
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

export const formatDateCompact = (iso: string): string => compactTsFormatter.format(new Date(iso))
export const formatDateFull = (iso: string): string => fullTsFormatter.format(new Date(iso))

// Stripe dashboard deeplink. The host is the same for test + live —
// Stripe routes the dashboard user to whichever mode their session is
// currently in. Falls back to the global /customers index when the org
// hasn't been linked to a Stripe customer yet.
export const stripeCustomerUrl = (customerId: string | null): string =>
  customerId
    ? `https://dashboard.stripe.com/customers/${encodeURIComponent(customerId)}`
    : 'https://dashboard.stripe.com/customers'
