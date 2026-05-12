// Public API surface for `sendEmail`. Callers either build this envelope
// from a template factory (e.g. `invitationEmail({...})`) or hand-roll it.
export interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string
  // Stable key used for idempotency. The send-side upserts a `sent_emails`
  // row by this key and skips if already marked sent. Conventional shape:
  // `<resource>:<id>` (e.g. `invitation:inv_<uuid>`). Required so handlers
  // can't accidentally hot-loop a transport.
  dedupeKey: string
  // The template name that produced this envelope. Stored on `sent_emails`
  // so the admin view can filter by template + the bounce-handling PR can
  // attribute deliveries.
  template: string
  // Forwarded onto the `sent_emails` row for correlation.
  requestId?: string | null
}

// Transport-layer return value. `messageId` is the upstream's id when
// available (SES MessageId, Mailpit's messageId).
export interface TransportResult {
  messageId?: string | null
}

export interface EmailTransport {
  send(params: SendEmailParams & { from: string }): Promise<TransportResult>
}
