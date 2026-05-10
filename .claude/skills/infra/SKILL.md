---
name: infra
description: Plan or review AWS CDK infrastructure. Covers stack decomposition, deploy order, bootstrapping concerns, secrets management, security groups, and common failure patterns. Use before adding new infrastructure or debugging a deploy.
---

Read the existing infrastructure code first, then work through the following.

**Stack decomposition (3 stacks per environment)**

Split by lifecycle, not by resource type:

- `${product}-${env}-network` — VPC, subnets, NAT gateway(s), security groups. Rarely changes.
- `${product}-${env}-data` — RDS, ElastiCache Redis, ECR, Secrets Manager, S3 (uploads), **ECS cluster**, **one-off task definitions** (migrator, bootstrap-staff, future seed/backfill tasks). Long-lived; deploys infrequently.
- `${product}-${env}-app` — ECS services (api + worker), ALB, per-SPA S3 buckets + CloudFront distributions, Route53, ACM. Deploys frequently.

ECR lives in `data` because the image must exist before `app`'s ECS service can start. The **ECS cluster also lives in `data`** so the migration one-off task can run before `app` deploys; services in `app` import the cluster via cross-stack ref. Secrets live in `data` for the same reason — they must be populated before `app` deploys.

**Deploy order**

First-deploy sequence (always sequential):
```
network → data → populate secrets out-of-band → push image → app
```

Subsequent deploys: push image → CI orchestrates an ECS rolling update. CDK runs only when infra changes.

**Migrations**

Run Prisma `migrate deploy` as an **ECS one-off task** before the API rolling update. Never at container startup — it causes boot storms when ECS scales out, and a slow migration fails healthchecks.

**One-shot ops (the `workflow_dispatch` sibling pattern)**

Anything that runs **once per environment spin-up** rather than once per deploy — bootstrapping the first staff user, seeding test data, backfilling a column — gets its own `workflow_dispatch`-only GitHub Actions workflow that calls `aws ecs run-task` against a dedicated Fargate task definition. Don't bake one-off ops into the deploy DAG, into container startup, or into long-lived env vars.

The pattern looks like the `migrator`:

- A Fargate task definition in the `data` stack, sharing the API image, with a per-task CMD overriding the container entrypoint (e.g. `['node', 'dist/scripts/bootstrap-staff.js']`).
- Per-task CloudWatch log group (`/ecs/${product}-${env}-<purpose>`) so failures are easy to find.
- DB secrets + any app secrets the task actually needs, injected the same way the API service receives them.
- An empty `environment:` block for any creds that should appear at trigger time only — those arrive as **runtime env overrides** in the workflow's `aws ecs run-task --overrides` payload, never as values stored on the task def or in Secrets Manager.
- The workflow uses `add-mask` for sensitive inputs and tails the task's log group on a non-zero exit.

The current example is `bootstrap-staff` (see `infra/cdk/lib/data-stack.ts` and `.github/workflows/bootstrap-staff.yml`). New one-shot tasks should mirror that file layout.

**SPA hosting (CloudFront + S3 with OAC)**

SPAs (`apps/internal` is the first; `apps/web`, `apps/portal` follow the same pattern) are served from a private S3 bucket fronted by CloudFront using **Origin Access Control** (the modern replacement for OAI). The bucket has `BLOCK_ALL` public access, server-side encryption, and a bucket policy that only allows the CloudFront distribution's source ARN.

The CloudFront distribution carries two origins:

- **S3 origin** (default behaviour, `CACHING_OPTIMIZED`) — serves the SPA bundle. Vite's hashed assets are sync'd with `Cache-Control: public, max-age=31536000, immutable`; `index.html` gets `no-cache, must-revalidate` so the SPA shell ships on the next request after deploy.
- **ALB origin** (`/api/*` behaviour, `CACHING_DISABLED`, `ALL_VIEWER_EXCEPT_HOST_HEADER` policy) — forwards cookies + auth headers to the API task. The "except host header" matters: stripping `Host` lets the ALB resolve to the right target group; keeping cookies + `Authorization` lets the session round-trip.

A custom error response maps `404` and `403` from S3 to `200 /index.html` so client-side routing works (TanStack Router resolves the path on load).

The deploy step (in CI) does a two-pass S3 sync — long-cache + immutable for everything except `index.html`, then a separate copy of `index.html` with `no-cache` — followed by a CloudFront invalidation of `/` + `/index.html`. Hashed assets never need invalidation; the shell does.

**Secrets**

- Never put secrets in CDK `environment:` — use `secrets:` backed by Secrets Manager.
- Create the secret in `data` (so it exists before `app`); populate it out-of-band.
- ECS injects secret fields as individual env vars: `ecs.Secret.fromSecretsManager(secret, 'FIELD_NAME')`.
- Always validate env vars at server startup (Zod) so the container fails fast on misconfiguration.

**Security groups — principle of least privilege**

- ALB SG: inbound 80/443 from internet
- ECS SG: inbound app port from ALB SG only
- RDS SG: inbound 5432 from ECS SG only
- Redis SG: inbound 6379 from ECS SG only
- No inbound rule = no access (default deny)

**Tagging**

Every resource gets `Product`, `Environment`, `ManagedBy=cdk` via stack-level CDK aspects. Don't tag inline.

**Common failure patterns to check**

1. ECS task not starting → check CloudWatch logs immediately; most likely missing env var, wrong secret field name, or application crash at startup.
2. Pre-deploy migration task failing → it must succeed before the rolling deploy starts. Check the one-off task's logs.
3. ALB health check timing → set `startPeriod` long enough for app boot; unhealthy threshold 3 before marking degraded.
4. CloudFront returning HTML for API calls → the route prefix in the CloudFront behaviour must match what the backend mounts (e.g. `/api/*` requires backend routes at `/api/...`).
5. Secrets not picked up → ECS reads secrets at task start; force a new deployment after updating a secret.
6. RDS rejects engine version (`Cannot find version X.Y for postgres`) → CDK's `PostgresEngineVersion` enum can list versions that AWS hasn't enabled in your region, and skips minors (e.g. there is no Postgres `18.0` in RDS — `18.1` is the first 18.x). Confirm with `aws rds describe-db-engine-versions --engine postgres --region <region> --query 'DBEngineVersions[*].EngineVersion'` before pinning.
7. RDS rejects `DBName template` as a reserved word → Postgres uses `template0` / `template1` as system templates; RDS specifically forbids the bare name `template` as a user database. Use a generic name (`app`) or a product-prefixed name. The underscored `template_dev` / `template_test` are fine for user-created Postgres databases (only `template0` / `template1` are engine-reserved).
8. ECR lifecycle policy validation failure (`Only one rule can select Untagged images per storage class`) → ECR allows exactly one lifecycle rule per `tagStatus`. For tagged-image cleanup AND untagged cleanup, use one rule of each status (`TAGGED` + `UNTAGGED`), not two rules targeting the same status.
9. Prisma logs `Could not find libssl` in the container → `node:*-bookworm-slim` does not include OpenSSL by default. Add `RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*` in the runner stage so Prisma's libssl detection succeeds. Alpine bases have musl quirks; bookworm-slim + openssl is the path of least surprise.
10. `pnpm deploy --prod` strips devDeps in the Docker build → if a CLI tool (e.g. `prisma`) needs to run inside `/prod` against the deployed node_modules, it must be a runtime dep, not a devDep. Common case: re-running `prisma generate` inside `/prod` after `pnpm deploy` so the production runtime has the generated client.
11. ECS task command can't `node <wrapper>` (`SyntaxError: missing ) after argument list` on the wrapper's shell syntax) → entries under `node_modules/.bin/` are pnpm/npm-generated `/bin/sh` wrappers, not JS. Invoke them directly (`['node_modules/.bin/prisma', '...']`) — the shebang handles invoking node. Or invoke the package's actual JS entry (`['node', 'node_modules/<pkg>/build/index.js', '...']`).
12. ECS task pulling `<repo>:latest` despite the workflow pushing `<repo>:<sha>` → an empty `imageTag` string at synth time produces a tagless URI in the CFN template, which Docker resolves to `:latest`. Two reinforcing fixes: pass `-c imageTag=${{ github.sha }}` directly in CI (don't depend on `needs.<job>.outputs.*`, which can be empty when re-running an individual job), and use `||` not `??` for the imageTag default in `bin/app.ts` so an empty string falls through to a clearly-named placeholder that fails loudly.
13. RDS Postgres rejects connection with `no pg_hba.conf entry for host "...", database "...", no encryption` → RDS Postgres has `rds.force_ssl=1` enabled by default. Append `?sslmode=require` to the connection URL. The Prisma CLI binary engine handles this natively; the runtime client through `@prisma/adapter-pg` does too, with one caveat — see #14.
14. After adding `sslmode=require`, the runtime client errors with `self-signed certificate in certificate chain` → `pg-connection-string` (under `@prisma/adapter-pg`) treats `sslmode=require` as `verify-full` and demands a trusted CA chain; RDS uses Amazon's RDS CA, which isn't in Node's default trust store. Append `&uselibpqcompat=true` to revert to libpq's historical "encrypt, don't validate" semantics. Tighter posture: ship the RDS CA bundle in the image and use `sslmode=verify-full`.
15. Stack stuck in `ROLLBACK_COMPLETE` after a failed first deploy → CFN cannot UPDATE a stack in `ROLLBACK_COMPLETE`; it must be deleted and re-created. `aws cloudformation delete-stack --stack-name <name>` then re-trigger the deploy. CDK does not auto-delete-and-recreate.

**Before adding new infrastructure, answer:**
- Which stack does this resource belong in (network / data / app), and why?
- Does anything need to exist before this resource can be used?
- Does this change the deploy order?
- What IAM permissions does the task role need?
- What security group rules are needed?
- What tags apply?
