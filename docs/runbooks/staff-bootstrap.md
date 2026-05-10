# Staff bootstrap

Create or promote the first staff user for an environment. Required once per
env spin-up — there is no UI for self-promoting an account, by design (no
public path to staff access).

The script (`apps/api/src/scripts/bootstrap-staff.ts`) is idempotent:

- User does not exist → creates via `auth.api.signUpEmail` (better-auth hashes
  the password and emits the `user.signed_up` audit event), then sets
  `staffRole`.
- User exists with the same role → no-op.
- User exists with a different role (or `null`) → updates `staffRole` only;
  the password is **not** touched.

Roles: `support` | `engineer` | `admin`. The `requireStaff` middleware accepts
any of the three; today's audit-log endpoints don't differentiate further.

## Local

Pre-requisites: local Postgres up (`docker compose up -d postgres`),
migrations applied, `apps/api/.env` populated. See [`local-dev.md`](./local-dev.md).

```bash
pnpm --filter @template/api bootstrap:staff \
  --email=ada@example.com \
  --name="Ada Lovelace" \
  --password='choose-something-strong' \
  --role=admin
```

The CLI flags are convenient but appear in shell history. For a one-off
session, prefer environment variables:

```bash
BOOTSTRAP_STAFF_EMAIL=ada@example.com \
BOOTSTRAP_STAFF_NAME="Ada Lovelace" \
BOOTSTRAP_STAFF_PASSWORD='choose-something-strong' \
BOOTSTRAP_STAFF_ROLE=admin \
  pnpm --filter @template/api bootstrap:staff
```

Re-running with the same email + role logs `already has staffRole=…, no-op`.

## Staging (and any future env)

Triggered manually from the GitHub Actions tab — there is no scheduled or
push-driven path.

1. Open **Actions** → **bootstrap-staff** → **Run workflow**.
2. Branch: `main`. Inputs:
   - `environment`: `staging`
   - `email`: target user
   - `name`: display name (e.g. `"Ada Lovelace"`)
   - `password`: only used if the user is being created; rotate after first
     login. Leave the field empty after the user is created — re-runs that
     just promote a role won't read it. (The input is masked in logs.)
   - `role`: defaults to `admin`
3. Run.

The workflow runs `aws ecs run-task` against the
`template-staging-bootstrap` Fargate task definition with the four
`BOOTSTRAP_STAFF_*` values passed as **runtime env overrides** — never as
long-lived env vars on the task definition or in Secrets Manager. The
container exits as soon as the script returns. Total run time is ~30s.

On failure, the workflow tails the last 5 minutes of
`/ecs/template-staging-bootstrap` and exits non-zero.

## Why a one-off task instead of a deploy step

The same script could be wired into `migrate-db` or the API container's
startup, but that would mean either persistent `BOOTSTRAP_STAFF_*` env vars on
every deploy (defeating "creds appear at trigger time only") or non-idempotent
deploys that re-run the script every release. A `workflow_dispatch` task with
runtime overrides keeps the secret surface ephemeral and makes the operation
explicit and auditable (each invocation is a Run row in the Actions tab).

## Related

- `apps/api/src/middleware/require-staff.ts` — the `staffRole` gate enforced
  on `/api/audit-log/*`. New staff routes should layer on this middleware.
- `apps/api/src/lib/auth.ts` — `staffRole` declared on better-auth
  `additionalFields` with `input: false` so the auth API can't set it.
