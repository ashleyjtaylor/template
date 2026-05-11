// Prefixed identifier generator. Same shape as the inline `usr_${randomUUID()}`
// pattern used elsewhere in the codebase; consolidated here so packages/events
// has a single helper. Extracts to packages/ids once a third consumer arrives.
export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}
