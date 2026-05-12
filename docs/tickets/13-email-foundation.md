# 13 — Email foundation (Mailpit / SES facade + invitation email)

## Goal

Ship the email infrastructure: `packages/email` facade (Mailpit local / LogOnly deployed-default / SES when `emailDomain` is wired), `packages/emails` react-email templates, a `sent_emails` table for dedupe + history, and the first real consumer — replace the placeholder `invitation.created` subscriber with a handler that renders + sends the invitation email and writes a `sent_emails` row. Staff get a `/emails` view in `apps/internal`.

## Acceptance criteria

- `pnpm dev` brings up Mailpit (`http://localhost:8025`). Creating an invitation via `apps/web` lands the email in Mailpit + a `sent_emails` row with `status='sent'`.
- A second run of `publishOutbox()` over the same outbox row does **not** re-send (dedupe gate).
- Failed sends leave `sent_emails.status='failed'` with a meaningful `last_error`; BullMQ exponential-backoff retries kick in.
- Staff member can visit `/emails` in `apps/internal`, paginate the list, open a detail page with the rendered HTML preview (iframe-sandboxed).
- CDK synth clean with `emailDomain` set (provisions the new `EmailStack`) and unset (`LogOnlySender`).
- All existing tests green; new unit + integration tests cover the email flow.

## Data model — one new table

```
sent_emails
  entity_id    text   pk, sem_<uuid>
  request_id   text   nullable
  dedupe_key   text   unique           -- e.g. 'invitation:inv_<uuid>'
  recipient    text
  template     text                    -- template name, e.g. 'invitation'
  subject      text
  html         text                    -- rendered HTML body
  text         text   nullable         -- rendered plaintext body
  status       text                    -- 'pending' | 'sent' | 'failed'
  last_error   text   nullable
  message_id   text   nullable         -- SES MessageId / Mailpit message id
  created_at   timestamptz default now()
  sent_at      timestamptz nullable

index (created_at desc)
index (recipient, created_at desc)
index (request_id)
```

Bounce / complaint columns (`bounced_at`, `complained_at`, `delivery_state`) land with the follow-up bounce-handling PR.

## Packages

**`packages/email`** — new. Owns the facade + transports.

- Exports: `sendEmail({ to, subject, html, text?, dedupeKey, requestId? })`.
- Transport selection (internal):
  - `APP_ENV='local'` → `MailpitSender` (Nodemailer over SMTP `:1025`).
  - `APP_ENV` in `staging|production` AND `EMAIL_FROM` set → `SesSender` (`@aws-sdk/client-sesv2` `SendEmailCommand`).
  - Otherwise → `LogOnlySender` (writes the rendered email to the worker's structured log).
- Owns dedupe-upsert into `sent_emails` before send; skips if `sent_at` is already set; updates status after send.
- `packages/email/src/env.ts` validates `EMAIL_FROM` (required when not local). `AWS_REGION` is read by the AWS SDK automatically — not parsed here.

**`packages/emails`** — new. React-email templates.

- Each template = a typed factory module:
  ```ts
  export interface InvitationEmailProps { inviterName, orgName, acceptUrl }
  export function invitationEmail(p: InvitationEmailProps): {
    subject: string; html: string; text: string
  }
  ```
- Ships with **one** template in this PR: `Invitation`.
- Uses `@react-email/components` + `@react-email/render`.

## Event payload + emit

- `packages/events/src/types.ts`: `InvitationCreatedEvent` gains `rawToken: string`.
- `apps/api/src/modules/org-invitations/service.ts`: passes `rawToken` into the `emit({ ... }, { tx })` call inside the existing invitation-create transaction. Token transits Postgres outbox + ElastiCache Redis (both encrypted at rest, TLS in transit, AUTH). 7-day TTL, single-use. The insider-risk model is bounded and documented; forks needing stricter compliance can rotate the token in the worker handler instead.

## Queue layout

- Add `QueueName.emails = 'emails'` in `packages/events/src/queues.ts`.
- Route `invitation.created` → `emails` queue (update the `eventQueue` map).
- `apps/worker/src/index.ts` boots a 4th BullMQ Worker on the `emails` queue. Concurrency 5 (env `WORKER_QUEUE_EMAILS_CONCURRENCY`).

## Worker subscriber rewrite

`apps/worker/src/subscribers/invitation-created.ts`:

1. Fetch invitation (`include: { invitedBy: true, organisation: true }`) via `@template/db`.
2. Build `acceptUrl = \`${env.WEB_BASE_URL}/accept-invite?token=${event.rawToken}\``.
3. `await sendEmail({ to: event.email, dedupeKey: \`invitation:${event.invitationId}\`, requestId: event.requestId ?? null, ...invitationEmail({ inviterName, orgName, acceptUrl }) })`.

## API surface

**`/api/admin/sent-emails`** — new, staff-gated:

- `GET /api/admin/sent-emails` — paginated list, cursor by `created_at desc`. Returns `{ rows, nextCursor }`.
- `GET /api/admin/sent-emails/:entityId` — single row including stored `html`. **404** if missing.

Routes live in `apps/api/src/modules/admin/sent-emails/` following the route → controller → service layering.

## `apps/internal` SPA

- New TanStack file-based routes: `routes/emails.tsx` (list) + `routes/emails_.$entityId.tsx` (detail, trailing-underscore for flat sibling, mirrors `audit_.$entityId.tsx`).
- New sidebar `NavItem` ("Emails", icon `Mail`) linking to `/emails`.
- Detail page renders HTML in `<iframe sandbox="">` for safety.
- New module `apps/internal/src/modules/sent-emails/` with api wrapper + schemas, mirroring the existing `audit-log` module.

## Env vars (new)

| Var | Where read | Notes |
|---|---|---|
| `EMAIL_FROM` | `packages/email` | Required when not `APP_ENV=local`. Without it on staging/prod → `LogOnlySender`. |
| `AWS_REGION` | AWS SDK auto | Set on api + worker containers by CDK from `aws.region`. No code parses it directly. |
| `WEB_BASE_URL` | `apps/worker` | Used by invitation handler to build the accept-link. Local default `http://localhost:5174`. CDK injects `WebSpaUrl`. |
| `WORKER_QUEUE_EMAILS_CONCURRENCY` | `apps/worker` | Default 5. |

`apps/api/.env.example` and `apps/worker/.env.example` updated.

## Local dev

- Add Mailpit to `docker-compose.yml`:
  ```yaml
  mailpit:
    image: axllent/mailpit:latest
    container_name: template-mailpit
    ports: ['1025:1025', '8025:8025']
  ```
- Worker connects to `localhost:1025` SMTP when `APP_ENV=local`. UI at `http://localhost:8025`.
- `apps/worker/.env.example`: `EMAIL_FROM=noreply@local.test`, `WEB_BASE_URL=http://localhost:5174`.

## Infrastructure (CDK)

**New stack: `EmailStack`** — conditional on `-c emailDomain=<domain>`. Without the context flag, the stack is not instantiated in `bin/app.ts`.

- `EmailIdentity` for the supplied domain.
- DKIM CNAMEs via `HostedZone.fromLookup({ domainName: emailDomain })` + automatic record provisioning (assumes the fork has a Route53 zone for the domain).
- `ConfigurationSet` (`${PRODUCT}-${envName}-default`) — placeholder for future bounce-event wiring.
- CFN outputs: `EmailDomain`, `EmailIdentityArn`, `EmailConfigurationSetName`.

**`AppStack` becomes email-aware (optional props)**

- New optional props: `emailDomain?`, `emailIdentityArn?`, `emailConfigSetName?`.
- When set: worker container env gets `EMAIL_FROM=noreply@${emailDomain}`; worker task role gets `ses:SendEmail` + `ses:SendRawEmail` scoped to `emailIdentityArn`.
- Always: worker container env gets `AWS_REGION` and `WEB_BASE_URL=https://${webDistribution.distributionDomainName}`.

**`bin/app.ts`**

```ts
const emailDomain = app.node.tryGetContext('emailDomain')
const email = emailDomain
  ? new EmailStack(app, `${PRODUCT}-${env}-email`, { ...baseProps, envName: env, emailDomain })
  : undefined

new AppStack(app, `${PRODUCT}-${env}-app`, {
  ...baseProps,
  ...(email && {
    emailDomain,
    emailIdentityArn: email.identityArn,
    emailConfigSetName: email.configurationSetName
  }),
  // existing props…
})
```

**Stacks (final list)**

- `${product}-${env}-network` — unchanged
- `${product}-${env}-data` — unchanged
- `${product}-${env}-email` — **new, optional**
- `${product}-${env}-app` — picks up SES props from `EmailStack` when present

## CI/CD

- `ci.yml`: add `mailpit` service container alongside `postgres` + `redis`. Set `EMAIL_FROM=noreply@local.test` in the job env. Tests connect to `localhost:1025` SMTP + `localhost:8025` HTTP API.
- `deploy-staging.yml`: **unchanged in shape**. Template-default deploy continues to work end-to-end (LogOnlySender). Forks setting `-c emailDomain=...` add `template-${env}-email` to their fork's `cdk deploy` step and ship a Route53 zone for the domain.

## Testing plan

**Unit (Vitest, mocked):**

- `packages/email`: transport-selection logic; the dedupe-upsert flow (mocked Prisma).
- Render snapshot of the `Invitation` template (deterministic given props).

**Integration (Postgres + Redis + Mailpit service containers in CI):**

- `emit({ type: 'invitation.created', ... }, { tx })` inside a transaction → outbox row → `publishOutbox()` → emails-queue Worker → handler runs → `sent_emails` row with `status='sent'` + Mailpit's HTTP API returns the message with the expected To / Subject / HTML.
- Re-running `publishOutbox()` over the same `entityId` does **not** produce a second Mailpit message; the dedupe gate inside `sendEmail` short-circuits on the existing `sent_at`.
- `apps/api` admin routes:
  - `GET /api/admin/sent-emails` — 401 unauth, 403 non-staff, 200 staff returns the expected JSON shape.
  - `GET /api/admin/sent-emails/:entityId` — 401 / 403 / 200; 200 includes the stored `html`.

**No Playwright E2E in this PR** — deferred per the worker ticket's explicit list.

## Error handling

| Scenario | Behaviour |
|---|---|
| `dedupeKey` missing | Throw `ValidationError` (400 in API; logged + retried in worker) |
| Transport throws on send | `sent_emails.status='failed'`, `last_error` populated; BullMQ retries (3 attempts, exp backoff) |
| Retry after a successful send | `sendEmail` finds `sent_at` set, no-ops |
| `EMAIL_FROM` missing on deployed env | Worker uses `LogOnlySender` — sends become structured log entries |
| Admin route, no session | `401 UnauthorizedError` |
| Admin route, no staff role | `403 ForbiddenError` |
| Admin detail, missing entityId | `404 NotFoundError` |

## Integration points

- **Postgres**: new `sent_emails` table + invitation / user / organisation reads in the worker handler.
- **Redis**: BullMQ `emails` queue.
- **Mailpit** (local) or **SES** (deployed-with-`emailDomain`) for actual send.
- **ECS worker**: outbound SMTP to Mailpit (local) or HTTPS to SES API (deployed). Worker task role grants `ses:SendEmail` when `EmailStack` is deployed.

Effects on existing modules:

- `packages/events`: `types.ts` adds `rawToken` to `InvitationCreatedEvent`; `queues.ts` adds the `emails` queue.
- `apps/api/src/modules/org-invitations/service.ts`: emit passes `rawToken`.
- `apps/worker/src/subscribers/invitation-created.ts`: replaced with real handler.
- `apps/worker/src/index.ts`: 4th `Worker` on the `emails` queue.
- `apps/internal`: new route + nav item.

## Deferred (explicit follow-up surface)

- **Bounce + complaint handling** (SES → SNS → SQS → suppression worker → extends `sent_emails` with delivery-state columns). Own ticket.
- **better-auth-driven emails** (verify-email + password-reset + magic-link hooks). Own ticket — flow change: enabling email-verify makes signups gated.
- **"Resend" action** in admin UI + filters on the list view.
- **Per-template Configuration Sets** for tagged event routing in SES.
- **Playwright E2E** of the full invitation → email → accept flow.
- **DMARC / SPF docs** in `docs/runbooks/`.
- **Conversion nudges / digests** — scheduled emails via the existing `schedules` queue.
