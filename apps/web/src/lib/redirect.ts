// Validates a string is a safe in-app redirect target. Rejects anything
// that isn't a path-and-query — no protocol-relative `//evil.com`, no
// `http://evil.com`, no `javascript:`, no protocol-absolute URLs at all.
// Without this, `?redirect=` is an open-redirect / XSS vector.
export const safeRedirect = (raw: string | undefined, fallback = '/'): string => {
  if (!raw) return fallback
  if (!raw.startsWith('/')) return fallback
  // Protocol-relative URLs (`//host.example`) start with `/` but get
  // resolved against the current scheme — these are external.
  if (raw.startsWith('//')) return fallback

  return raw
}
