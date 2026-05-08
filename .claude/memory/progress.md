---
name: progress
description: What has actually shipped on this template, in reverse chronological order. Read alongside project_overview.md — the overview is the design, this is the status.
type: project
---

# Progress

Reverse chronological log of consequential changes. One section per milestone (a meaningful PR or feature), not per commit. Renovate bumps, lint fixes, typo corrections, and trivial dependency tweaks do **not** get entries.

Each entry: date, ref(s), what landed, what's now possible, what's deferred.

---

## 2026-05-08 — `apps/api` foundations: logger, request ID, typed errors, security middleware, graceful shutdown

- **Branch / PR**: `feat/api-foundations`
- **What landed**:
  - **`apps/api/src/lib/logger.ts`** — pino 10.3.1 (JSON in prod, pino-pretty in dev), AsyncLocalStorage-backed request context with `runWithContext()` / `getRequestId()` helpers, pino mixin that automatically tags every log line with the current request ID, base fields `{ service: 'api', release: env.GIT_SHA }`.
  - **`apps/api/src/lib/errors.ts`** — abstract `HttpError` base + six subclasses (`ValidationError` 400, `UnauthorizedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409, `InternalError` 500), `formatError()` that returns the canonical wire shape `{ code, message, details? }`. Lives in-app for now; moves to `packages/errors` when the worker arrives.
  - **`apps/api/src/lib/shutdown.ts`** — registers SIGTERM/SIGINT handlers that call `server.close()`, wait up to `SHUTDOWN_TIMEOUT_MS` for in-flight requests to drain, then `process.exit(0)`. Returns an unregister function (used in tests). Idempotent — second signal is a no-op.
  - **Three middlewares** in `apps/api/src/middleware/`:
    - `request-id.ts` — generates a UUID via `crypto.randomUUID()`, sets `X-Request-Id` response header, seeds the ALS context.
    - `request-logger.ts` — logs one line per request on completion (`{ method, path, status, durationMs }`); skips `/health` (ALB probe noise).
    - `error-handler.ts` — `app.onError()` callback that formats `HttpError` subclasses, maps Hono `HTTPException` to the same wire shape, and falls back to a scrubbed `500 InternalError` for unhandled errors (original logged with stack).
  - **`apps/api/src/app.ts`** — `createApp()` factory wires the middleware chain in the locked order (`requestId → requestLogger → secureHeaders → cors → bodyLimit → routes → onError`). Optional `corsOrigins` and `bodyLimitBytes` factory props default to env values, override-able from tests.
  - **`apps/api/src/index.ts`** — registers the shutdown hook against the `serve()` instance.
  - **`apps/api/src/env.ts`** — adds `NODE_ENV`, `LOG_LEVEL`, `CORS_ORIGINS` (csv → array), `BODY_LIMIT_BYTES` (default 1 MB), `SHUTDOWN_TIMEOUT_MS` (default 25 s) — all optional with sensible defaults.
  - **`infra/cdk/lib/app-stack.ts`** — explicit `stopTimeout: Duration.seconds(30)` on the API container with a comment naming the cross-file invariant against `SHUTDOWN_TIMEOUT_MS`.
  - **`apps/api/vitest.config.ts`** — sets `NODE_ENV=test` and `LOG_LEVEL=silent` for test runs so the suite doesn't spew JSON logs.
  - **27 tests** across four files (errors, logger ALS, shutdown, app integration) — including request-ID format, security headers, CORS allow/deny, body limit, error wire shape, request-logger /health skip.
- **What's now possible**:
  - Throw a typed error from any future handler — `throw new NotFoundError('user missing')` → `404 { code: "NotFoundError", message: "user missing" }` on the wire, no per-handler `try/catch` plumbing.
  - Filter all logs from one request: `cloudwatch logs filter-pattern '{ $.requestId = "abc-..." }'` returns the full story for that request.
  - Tear down with no in-flight loss: ECS rolling deploy → SIGTERM → app drains for up to 25 s → exits cleanly before ECS's 30 s `stopTimeout`.
  - CORS-protected by default. When `apps/web` lands, set `CORS_ORIGINS=https://app.staging.<domain>` on the ECS task and that's it.
- **Deferred** (explicit follow-up surface):
  - **Rate limiting** — better-auth handles its own auth-route limiter; a generic Hono limiter for tRPC arrives once Redis exists.
  - **tRPC + typed contract** — lands with the first non-`/health` route.
  - **Sentry** — not wired; CloudWatch + structured logs cover triage until real users hit production.
  - **Auth middleware** (`getCurrentUser`, `assertCan`) — lands with better-auth + sessions.
  - **`packages/errors`, `packages/types`, `packages/schemas`** — extracted on first ≥2-consumer need (likely worker arrival).
  - **OpenTelemetry / X-Ray distributed tracing** — Sentry perf covers 80% per overview; defer indefinitely.

## 2026-05-08 — `apps/api` with `/health`, deployed to staging end-to-end

- **Branch / PRs**: `feat/api-health` (#10) + `fix/ecr-lifecycle-rules` (#11)
- **Verified live**: `http://<alb-dns>/health` → `200 { status: "ok", version: "<commit sha on main>", uptime: <seconds> }`. ALB DNS available from the `AlbDnsName` output of `template-staging-app`.
- **What landed**:
  - `apps/api` workspace (`@template/api`): Hono 4.12.18 + `@hono/node-server` 2.0.1 + Zod 4.4.3 on Node 24.15.0. Single route `GET /health` returns `{ status, version, uptime }` where `version` is the running container's `GIT_SHA` and `uptime` is seconds since the app started. Code is structured as a `createApp({ gitSha })` factory + a `src/env.ts` Zod schema that parses `process.env` once at boot — no `process.env.X` access in handlers, no `biome-ignore` for the index-signature lint. Two Vitest tests (factory-based, no env stubbing). Build via `tsc -p tsconfig.build.json`; tests excluded from the build output.
  - `apps/api/Dockerfile`: multi-stage (`base`/`deps`/`build`/runner) on `node:24.15.0-bookworm-slim` (chosen over alpine for glibc compatibility with native npm prebuilds, no musl DNS/threading edge cases). pnpm installed via `npm i -g`, no Corepack. `pnpm deploy --prod --ignore-scripts` produces a clean production directory copied into the runner. Runs as `USER node`. Build context is repo root; `.dockerignore` at root prunes `node_modules`, `.git`, `dist`, `cdk.out`, `.turbo`, `docs`, `*.md`.
  - **CDK stacks fully populated** (`template-staging-{network,data,app}`, all with `terminationProtection: false`):
    - `NetworkStack`: VPC `10.0.0.0/16`, 2 AZs, public + private subnets, **single NAT gateway**, `albSg` (`:80` from internet), `ecsSg` (`:3000` from `albSg` only). `APP_PORT = 3000` exported as the cross-file constant.
    - `DataStack`: ECR repo `template-staging-api` with `imageScanOnPush`, one lifecycle rule per storage class (TAGGED: keep last 30; UNTAGGED: expire after 1 day), `removalPolicy: DESTROY`, `autoDeleteImages: true`, `emptyOnDelete: true`.
    - `AppStack`: Fargate cluster, task def 0.25 vCPU / 0.5 GB, container from ECR `:imageTag` (CDK context), `circuitBreaker: { rollback: true }`, `minHealthyPercent: 0`, ECS container health check via `node -e fetch`. Service in private subnets, no public IP. Public ALB listener on `:80` with target group health check `GET /health`. CloudWatch log group `/ecs/template-staging-api` 30d retention `DESTROY`. `AlbDnsName` `CfnOutput`.
  - **Promote-by-image-friendly CI/CD DAG** in `.github/workflows/ci.yml`: `[ci, cdk] → deploy-infra → build-image → deploy-app → smoke`. ECR login via `aws-actions/amazon-ecr-login@v2.1.5`. Image tag = `github.sha`. Smoke step polls `/health` for up to 5 minutes and asserts `version` matches the pushed SHA — catches "deploy succeeded but rolling update did not actually swap the image". Added a `docker-build` job that runs on PRs only (catches Dockerfile breakage before merge; on `main` the existing `build-image` job covers it).
  - `infra/cdk/tsconfig.json`: relaxed `exactOptionalPropertyTypes: false` for the CDK package only (CDK's interface types declare optional fields without `| undefined` and trip the strict check; this is a documented CDK incompatibility).
  - **pnpm bumped 10.33.4 → 11.0.8** across all pinned locations. `pnpm-workspace.yaml` opts into `injectWorkspacePackages: true` (proper way to make `pnpm deploy` work in Docker without `--legacy`), and uses pnpm 11's new `allowBuilds: { esbuild, lefthook }` (which replaces the deprecated `onlyBuiltDependencies`).
  - `docs/system-design.md`: first version, with Mermaid diagrams for AWS infra topology, request path, and deploy flow.
- **What's now possible**:
  - Push to `main` → ~5 min later, `http://<alb-dns>/health` returns `200 { status: "ok", version: <sha>, uptime: <seconds> }`. The ALB DNS is exposed as a CFN output on `template-staging-app` and the smoke step asserts the deploy reached the running task. _(Note: while the template is being scaffolded, deploys are gated on `workflow_dispatch` rather than push — see `docs/runbooks/staging-teardown-and-redeploy.md`.)_
  - `cdk destroy "template-staging-*"` tears the whole staging environment down cleanly (ECR images auto-deleted, log groups go away, no stuck CFN exports).
  - The four-job deploy DAG is the right shape for promote-by-image: when a future `deploy-production.yml` lands, it consumes a tag built by `build-image` rather than re-building.
- **Deferred** (explicit follow-up surface):
  - **Cross-file version drift**: Node `24.15.0` and pnpm `11.0.8` are duplicated in root `package.json`, `.github/workflows/ci.yml` (5 jobs), `apps/api/Dockerfile`, and `README.md`. Renovate currently does not group these. Add `customManagers` regex rules so a Node bump updates every location in one PR.
  - **HTTPS / TLS / DNS**: ALB serves `:80` only. Route53, ACM, CloudFront, custom domain all deferred until a real domain exists for this template.
  - **Data layer**: no RDS, Redis, S3 (uploads), Secrets Manager. Add when first feature requires them; will need NAT (already in place) plus security group additions.
  - **`apps/worker`, `apps/web`, `apps/internal`**: not scaffolded. Scaffold the next time a feature needs background work or a frontend.
  - **`packages/*`**: nothing yet. `packages/errors`, `packages/types`, `packages/schemas`, `packages/db`, `packages/auth`, etc. — created on first need.
  - **`deploy-production.yml`**: tag-triggered, environment-protected. Will retag the existing staging-tested ECR image rather than re-build (promote-by-image).
  - **Tighten OIDC role**: still `AdministratorAccess`. Runbook at `docs/runbooks/github-oidc-setup.md` has the plan; surface is now known (CDK exec roles + ECR push + ECS update-service + CFN describe-stacks).
  - **Production env sizing**: prod stacks compile with the same sizing as staging. Parameterise via `config.ts` when `deploy-production` lands.
  - **Path-ignore on `deploy-staging` for doc-only changes**: discussed and deferred. Would skip ECS rolling updates on doc-only merges. Worth doing once doc PR frequency justifies it.

## 2026-05-07 — `building-feature` skill: self-review step

- **Commits**: `c3f4cdf`
- **What landed**: Added a "Review (before committing — be your own code reviewer)" section to `.claude/skills/building-feature/SKILL.md`. Lists specific things to audit (overlooked logic, cross-file consistency, CI coverage, version compatibility, hardcoded values, failure modes, reverse-direction effects, footguns, skill drift).
- **What's now possible**: feature work has an explicit self-review gate before commit, reducing "next commit is a follow-up fix" patterns.
- **Deferred**: nothing.

## 2026-05-07 — CDK skeleton + staging CI/CD pipeline

- **Commits**: `be1436a`, `69e08b1`, `0cb8e2c`, `42be839` (PR #6, PR #7)
- **What landed**:
  - `infra/cdk/` workspace (`@template/cdk`) with `aws-cdk-lib` 2.253.0 and `aws-cdk` CLI 2.1121.0 pinned.
  - Three empty stack classes: `NetworkStack`, `DataStack`, `AppStack` in `infra/cdk/lib/`.
  - `bin/app.ts` instantiates all three for both `staging` and `production` envs (`template-{env}-{stack}`), tagged with `Product`/`Environment`/`ManagedBy=cdk` via `tagsFor()`.
  - Region locked to `eu-west-1` in `infra/cdk/lib/config.ts`.
  - `.github/workflows/ci.yml`: `ci` (lint+typecheck+test), `cdk` (synth), `commitlint` (PR-only), `deploy-staging` (push-to-main, gated on `[ci, cdk]` passing, OIDC role assumption, `cdk deploy "template-staging-*"`).
  - `pnpm-workspace.yaml` `onlyBuiltDependencies: [esbuild, lefthook]` to allow postinstall scripts CI needs.
  - Runbooks: `docs/runbooks/cdk-bootstrap.md`, `docs/runbooks/github-oidc-setup.md`.
- **What's now possible**: pushes to `main` automatically run lint/typecheck/test/synth and (if green) call `cdk deploy` against the staging account. Right now this is a no-op because the stacks are empty, but the wiring is end-to-end.
- **Deferred**:
  - All actual infra resources (VPC, NAT, ECR, ECS, ALB, RDS, Redis, S3) — stacks are empty.
  - `deploy-production.yml` workflow (tag-triggered, requires reviewer approval).
  - Tightening the OIDC role from `AdministratorAccess` to scoped permissions (runbook has the plan).
  - Promote-by-image flow (build once, retag for prod).

## 2026-05-06 — Monorepo bootstrap

- **Commits**: `15f9fb4`
- **What landed**:
  - `package.json` at root (`type: module`, Node ≥24.15.0, pnpm 10.33.4 via `packageManager`).
  - `pnpm-workspace.yaml` covering `apps/*`, `packages/*`, `infra/*`.
  - Turborepo 2.9.10 with `build`, `typecheck`, `test`, `lint`, `format`, `dev` tasks (build/typecheck/test depend on `^build`).
  - Biome 2.4.14 for lint + format.
  - TypeScript 6.0.3 with strict `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `isolatedModules`, NodeNext modules).
  - Lefthook 2.1.6 for git hooks.
  - Commitlint 20.5.3 with conventional config — non-conforming commit messages rejected at commit time.
- **What's now possible**: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all wired up across the workspace. Conventional Commits enforced.
- **Deferred**: any actual app, package, or infra code — all directories are empty.

---

## Convention

- **One section per milestone**, not per commit. Group related commits (the same feature, follow-up fixes, hotfixes) under one entry.
- **Skip**: renovate bumps, lint/format fixes, typo corrections, version bumps that don't change behaviour, internal-only refactors that don't shift capability.
- **Reverse chronological** — newest at the top, just under the "Progress" heading.
- **Date format**: `YYYY-MM-DD` from the merge date.
- **Every entry must include "Deferred"** — even "nothing" — so the next session knows the explicit follow-up surface, not just what's done.
