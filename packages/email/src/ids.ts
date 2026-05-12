// Prefixed id generator for sent_emails. Matches the inline pattern used
// elsewhere; consolidates here so packages/email has a single helper.
export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}
