# 09 — CI workflow reorganisation

Split the deploy DAG out of `ci.yml`, rename and split the misnamed `deploy-app` job, and add a PR-time SPA build sanity check. Pre-emptive cleanup before the second SPA (`apps/web`) makes the current shape worse.

## Goal

Today `.github/workflows/ci.yml` is one ~480-line file mixing two unrelated concerns:

- **PR + push validation** (`ci`, `cdk`, `commitlint`, `docker-build`)
- **Manual staging deploy DAG** (`deploy-infra`, `build-internal-app`, `build-image`, `migrate-db`, `deploy-app`, `smoke`) — gated on `workflow_dispatch`

Two pain points:

1. **`deploy-app` is a misnomer.** It does three things: `cdk deploy app`, S3 sync of the SPA bundle, CloudFront invalidation. As more SPAs (`apps/web`, `apps/portal`) land, this job grows linearly and the name becomes more wrong.
2. **The SPA build is invisible on PRs.** It only runs when someone clicks "Run workflow" on the deploy. A PR that breaks the SPA bundle merges green.

## Acceptance criteria

- `ci.yml` contains only PR + push validation jobs. No `workflow_dispatch` deploy jobs in this file.
- `.github/workflows/deploy-staging.yml` is a new file containing the deploy DAG, `workflow_dispatch`-only.
- `deploy-infra` is renamed to `deploy-network-data` (matches what it actually deploys).
- `deploy-app` is split into `deploy-app-stack` (cdk deploy) and `deploy-internal-spa` (S3 sync + CloudFront invalidation). The two are sequenced so the distribution exists before the sync runs.
- `build-internal-app` is added to `ci.yml` as a PR-only job so SPA build breakage fails the PR.
- `bootstrap-staff.yml` is unchanged (already separate, already correct).
- `docs/system-design.md` deploy-flow Mermaid is updated to reflect the new shape.

## Out of scope (deferred — explicit follow-ups)

- **`deploy-production.yml`** — production stacks compile in `cdk synth` but no workflow deploys them; pattern for that lands once an actual production env is wanted.
- **Reusable `workflow_call` extraction** of `build-internal-app` (today duplicated between `ci.yml` and `deploy-staging.yml`) — defer until a third caller justifies the indirection. Two copies of ~25 lines each is fine.
- **Trigger gating** of `deploy-staging.yml` on a green `ci.yml` run for the same SHA — operator discipline for now (trigger only after the green check on main). Worth revisiting when there are more deploy operators than reviewers.
- **`per-app` job for `apps/web` / `apps/portal`** — added when those SPAs scaffold; the file shape already supports it.

## Implementation chunking

3 chunks, each a single-concern commit:

1. This ticket.
2. `ci.yml` slimmed to validation jobs only; `deploy-staging.yml` created with the renamed + split deploy DAG; PR-only `build-internal-app` added to `ci.yml`.
3. Doc catch-up — `system-design.md` deploy-flow Mermaid + the `infra` skill's deploy-order paragraph if it references the old job names.
