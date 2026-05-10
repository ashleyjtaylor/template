# System design

Current topology of what is actually deployed. Updated as resources are added or removed. Read alongside `.claude/memory/project_overview.md` (the design intent) and `.claude/memory/progress.md` (the chronological log).

This document only covers **staging** at the moment. Production stacks are *defined* in CDK (`bin/app.ts` instantiates them) but never deployed by any workflow yet — they will get their own diagram when a `deploy-production` workflow lands.

## AWS infra (staging)

```mermaid
graph TB
    Internet((Internet))
    CF["CloudFront<br/>internal SPA distribution"]
    SpaBucket[("S3<br/>template-staging-internal-spa<br/>private, OAC")]

    subgraph VPC["VPC — 10.0.0.0/16, eu-west-1, 2 AZs"]
        subgraph PublicSubnets["Public subnets"]
            ALB["ALB<br/>internet-facing<br/>:80 HTTP"]
            NAT["NAT Gateway<br/>(single)"]
        end
        subgraph PrivateSubnets["Private subnets"]
            ECS["ECS Fargate service — api<br/>0.25 vCPU / 0.5 GB<br/>:3000"]
            Migrator["ECS Fargate task — migrator<br/>(one-off, run on each deploy)"]
            Bootstrap["ECS Fargate task — bootstrap-staff<br/>(one-off, workflow_dispatch only)"]
            RDS[("RDS Postgres<br/>db.t4g.micro, 20 GB<br/>:5432")]
        end
    end

    ECR["ECR repo<br/>template-staging-api"]
    Logs["CloudWatch Logs<br/>/ecs/template-staging-api<br/>/ecs/template-staging-migrator<br/>/ecs/template-staging-bootstrap<br/>30d retention"]
    DbSecret["Secrets Manager<br/>template-staging-db-credentials"]
    AppSecrets["Secrets Manager<br/>template-staging-app-secrets<br/>(betterAuthSecret, ...)"]

    Internet -->|HTTP :80| ALB
    Internet -->|HTTPS :443| CF
    CF -->|S3 origin<br/>default behaviour| SpaBucket
    CF -->|ALB origin<br/>/api/*| ALB
    ALB -->|target group<br/>health: GET /health| ECS
    ECS -->|Postgres :5432| RDS
    Migrator -->|prisma migrate deploy| RDS
    Bootstrap -->|create / promote staff user| RDS
    ECS -->|outbound via NAT| Internet
    ECR -.->|image pull on task start| ECS
    ECR -.->|same image, override CMD| Migrator
    ECR -.->|same image, override CMD| Bootstrap
    DbSecret -.->|injected as DB_* env vars| ECS
    DbSecret -.->|injected as DB_* env vars| Migrator
    DbSecret -.->|injected as DB_* env vars| Bootstrap
    AppSecrets -.->|injected as BETTER_AUTH_SECRET| ECS
    AppSecrets -.->|injected as BETTER_AUTH_SECRET| Bootstrap
    ECS -.->|stdout / stderr| Logs
    Migrator -.->|stdout / stderr| Logs
    Bootstrap -.->|stdout / stderr| Logs
```

**Security groups**
- `albSg`: inbound `:80` from `0.0.0.0/0`
- `ecsSg`: inbound `:3000` from `albSg` only
- `rdsSg`: inbound `:5432` from `ecsSg` only
- All other inbound denied (default)

**Stacks** (CloudFormation)
- `template-staging-network` — VPC, NAT, security groups
- `template-staging-data` — ECR repo, RDS Postgres, Secrets Manager DB credentials + app-secrets, ECS cluster, migrator + bootstrap-staff task definitions and their log groups
- `template-staging-app` — Fargate service, API task def, ALB, target group, listener, API log group, internal SPA S3 bucket + CloudFront distribution

All stacks have `terminationProtection: false` so `cdk destroy "template-staging-*"` tears them down without manual intervention.

## Request paths

Per-route documentation lives in [`docs/endpoints.md`](endpoints.md) — request/response shape, sequence diagrams, status-code deviations, and the convention for adding new routes. This file (`system-design.md`) covers infra topology and deploy mechanics only.

## Deploy flow

Two workflow files own the staging deploy story:

- **`.github/workflows/ci.yml`** — PR + push validation only. Jobs: `ci`, `cdk-synth`, `commitlint` (PR), `build-api-image` (PR sanity), `build-internal-app` (PR sanity).
- **`.github/workflows/deploy-staging.yml`** — `workflow_dispatch`-only deploy DAG.

```mermaid
graph LR
    Trigger[workflow_dispatch on main] --> Network[deploy-network-data]
    Network -->|cdk deploy<br/>network + data<br/>-c imageTag=sha| BuildApi[build-api-image]
    Trigger --> BuildSpa[build-internal-app]
    BuildApi -->|docker build<br/>push :sha to ECR| Migrate[migrate-db]
    Migrate -->|aws ecs run-task<br/>migrator + prisma migrate deploy| AppStack[deploy-app-stack]
    AppStack -->|cdk deploy app| InternalSpa[deploy-internal-spa]
    BuildSpa -->|vite build<br/>upload bundle artifact| InternalSpa
    InternalSpa -->|S3 sync + CloudFront invalidate| Smoke[smoke]
    AppStack --> Smoke
    Smoke -->|curl ALB /health<br/>curl CloudFront /| Done([deployed])
```

- The deploy DAG is `workflow_dispatch`-only (manual trigger from the Actions tab). Operator discipline: trigger only after the green check from `ci.yml` on the same SHA. There is no in-workflow gate yet — see `docs/tickets/09-ci-workflow-reorg.md` for when to add one.
- AWS access via OIDC (`AWS_DEPLOY_ROLE_ARN` in the `staging` GitHub Environment).
- `deploy-network-data` passes `imageTag` so the migrator + bootstrap-staff task definitions reference the SHA `build-api-image` is about to push. CFN doesn't validate ECR image existence at deploy time, so referring to a not-yet-pushed tag is fine.
- `build-internal-app` runs in parallel with everything that doesn't need it; the artifact is consumed by `deploy-internal-spa`. Each future SPA gets its own `build-<name>` + `deploy-<name>-spa` pair.
- `migrate-db` invokes `aws ecs run-task` against the migrator task definition, waits for it to stop, and fails the workflow on a non-zero exit (dumping the last 5 minutes of `/ecs/template-staging-migrator` logs).
- `deploy-app-stack` uses `cdk deploy --exclusively` so it does not re-confirm the network and data stacks.
- `deploy-internal-spa` downloads the SPA artifact, two-pass-syncs it to S3 (long-cache + immutable for hashed assets, no-cache for `index.html`), and invalidates `/` + `/index.html` on CloudFront. Sequenced after `deploy-app-stack` so the distribution exists.
- The smoke step polls the ALB `/health` for up to 5 minutes (asserting `version` matches the pushed SHA) and curls CloudFront for the SPA shell (asserting the response contains `id="root"`).

### bootstrap-staff (sibling workflow)

`.github/workflows/bootstrap-staff.yml` is a separate `workflow_dispatch`-only workflow — never on push, never on schedule, never wired into the main deploy DAG. It runs `aws ecs run-task` against the `template-${env}-bootstrap` task definition with the four `BOOTSTRAP_STAFF_*` inputs passed as **runtime env overrides** on the container. No long-lived bootstrap secrets exist on the task definition or in Secrets Manager. See [`docs/runbooks/staff-bootstrap.md`](runbooks/staff-bootstrap.md).

## External integrations

None at the moment.

Stripe / SES / Sentry / OAuth providers will get their own subsection here as they are wired in.

## What is NOT deployed (yet)

These are designed for in `project_overview.md` but absent from the live system:

- **Data**: ElastiCache Redis, S3 (uploads). (Application-level Secrets Manager secret `${PRODUCT}-${env}-app-secrets` IS deployed and currently holds `betterAuthSecret`; future fields like `stripeSecretKey` add to the same JSON document.)
- **Edge**: Route53, ACM, HTTPS on the ALB, custom domain. (CloudFront IS deployed for the internal SPA — backed by an S3 origin for `/*` and the ALB origin for `/api/*`. Route53 + ACM still pending so the SPA is served from the CloudFront default `*.cloudfront.net` domain.)
- **Apps**: `apps/worker` (BullMQ consumer), `apps/web`, `apps/portal`. (`apps/internal` IS deployed: login + audit-log list/detail behind a `staffRole` gate.)
- **Packages**: `packages/auth` (better-auth wired inline at `apps/api/src/lib/auth.ts` until a second consumer arrives), `packages/db`, `packages/billing`, `packages/errors`, `packages/types`, `packages/schemas`, etc.
- **Workflows**: `deploy-production.yml`, promote-by-image cross-env retag
- **IAM**: deploy roles still hold `AdministratorAccess` — tightening deferred per `docs/runbooks/github-oidc-setup.md`
- **Production env**: stacks compile during `cdk synth` but no workflow deploys them; sizing is identical to staging (parameterise when production actually runs)
