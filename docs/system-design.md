# System design

Current topology of what is actually deployed. Updated as resources are added or removed. Read alongside `.claude/memory/project_overview.md` (the design intent) and `.claude/memory/progress.md` (the chronological log).

This document only covers **staging** at the moment. Production stacks are *defined* in CDK (`bin/app.ts` instantiates them) but never deployed by any workflow yet — they will get their own diagram when a `deploy-production` workflow lands.

## AWS infra (staging)

```mermaid
graph TB
    Internet((Internet))

    subgraph VPC["VPC — 10.0.0.0/16, eu-west-1, 2 AZs"]
        subgraph PublicSubnets["Public subnets"]
            ALB["ALB<br/>internet-facing<br/>:80 HTTP"]
            NAT["NAT Gateway<br/>(single)"]
        end
        subgraph PrivateSubnets["Private subnets"]
            ECS["ECS Fargate service — api<br/>0.25 vCPU / 0.5 GB<br/>:3000"]
            Migrator["ECS Fargate task — migrator<br/>(one-off, run on each deploy)"]
            RDS[("RDS Postgres<br/>db.t4g.micro, 20 GB<br/>:5432")]
        end
    end

    ECR["ECR repo<br/>template-staging-api"]
    Logs["CloudWatch Logs<br/>/ecs/template-staging-api<br/>/ecs/template-staging-migrator<br/>30d retention"]
    DbSecret["Secrets Manager<br/>template-staging-db-credentials"]
    AppSecrets["Secrets Manager<br/>template-staging-app-secrets<br/>(betterAuthSecret, ...)"]

    Internet -->|HTTP :80| ALB
    ALB -->|target group<br/>health: GET /health| ECS
    ECS -->|Postgres :5432| RDS
    Migrator -->|prisma migrate deploy| RDS
    ECS -->|outbound via NAT| Internet
    ECR -.->|image pull on task start| ECS
    ECR -.->|same image, override CMD| Migrator
    DbSecret -.->|injected as DB_* env vars| ECS
    DbSecret -.->|injected as DB_* env vars| Migrator
    AppSecrets -.->|injected as BETTER_AUTH_SECRET| ECS
    ECS -.->|stdout / stderr| Logs
    Migrator -.->|stdout / stderr| Logs
```

**Security groups**
- `albSg`: inbound `:80` from `0.0.0.0/0`
- `ecsSg`: inbound `:3000` from `albSg` only
- `rdsSg`: inbound `:5432` from `ecsSg` only
- All other inbound denied (default)

**Stacks** (CloudFormation)
- `template-staging-network` — VPC, NAT, security groups
- `template-staging-data` — ECR repo, RDS Postgres, Secrets Manager DB credentials + app-secrets, ECS cluster, migrator task definition + log group
- `template-staging-app` — Fargate service, API task def, ALB, target group, listener, API log group

All stacks have `terminationProtection: false` so `cdk destroy "template-staging-*"` tears them down without manual intervention.

## Request paths

Per-route documentation lives in [`docs/endpoints.md`](endpoints.md) — request/response shape, sequence diagrams, status-code deviations, and the convention for adding new routes. This file (`system-design.md`) covers infra topology and deploy mechanics only.

## Deploy flow

```mermaid
graph LR
    Push[workflow_dispatch on main] --> CI[ci]
    Push --> CDK[cdk synth]
    CI --> Infra[deploy-infra]
    CDK --> Infra
    Infra -->|cdk deploy<br/>network + data<br/>-c imageTag=sha| Build[build-image]
    Build -->|docker build<br/>push :sha to ECR| Migrate[migrate-db]
    Migrate -->|aws ecs run-task<br/>migrator + prisma migrate deploy| App[deploy-app]
    App -->|cdk deploy app<br/>-c imageTag=sha| Smoke[smoke]
    Smoke -->|curl /health<br/>assert version=sha| Done([deployed])
```

- Deploy jobs run on `workflow_dispatch` (manual trigger from the Actions tab) on `main`, gated by `[ci, cdk]` passing. _(Note: while the template is being scaffolded, deploys are gated on `workflow_dispatch` rather than push — see `docs/runbooks/staging-teardown-and-redeploy.md`.)_
- AWS access via OIDC (`AWS_DEPLOY_ROLE_ARN` in the `staging` GitHub Environment).
- `deploy-infra` passes `imageTag` so the migrator task definition references the SHA `build-image` is about to push. CFN doesn't validate ECR image existence at deploy time, so referring to a not-yet-pushed tag is fine.
- `migrate-db` invokes `aws ecs run-task` against the migrator task definition, waits for it to stop, and fails the workflow on a non-zero exit (dumping the last 5 minutes of `/ecs/template-staging-migrator` logs).
- `deploy-app` uses `cdk deploy --exclusively` so it does not re-confirm the network and data stacks.
- The smoke step polls `/health` for up to 5 minutes and asserts the response's `version` matches the pushed SHA — catches "deploy succeeded but rolling update did not actually swap the image".

## External integrations

None at the moment.

Stripe / SES / Sentry / OAuth providers will get their own subsection here as they are wired in.

## What is NOT deployed (yet)

These are designed for in `project_overview.md` but absent from the live system:

- **Data**: ElastiCache Redis, S3 (uploads). (Application-level Secrets Manager secret `${PRODUCT}-${env}-app-secrets` IS deployed and currently holds `betterAuthSecret`; future fields like `stripeSecretKey` add to the same JSON document.)
- **Edge**: Route53, ACM, CloudFront, HTTPS / TLS, custom domain
- **Apps**: `apps/worker` (BullMQ consumer), `apps/web`, `apps/internal`, `apps/portal`
- **Packages**: `packages/auth` (better-auth wired inline at `apps/api/src/lib/auth.ts` until a second consumer arrives), `packages/db`, `packages/billing`, `packages/errors`, `packages/types`, `packages/schemas`, etc.
- **Workflows**: `deploy-production.yml`, promote-by-image cross-env retag
- **IAM**: deploy roles still hold `AdministratorAccess` — tightening deferred per `docs/runbooks/github-oidc-setup.md`
- **Production env**: stacks compile during `cdk synth` but no workflow deploys them; sizing is identical to staging (parameterise when production actually runs)
