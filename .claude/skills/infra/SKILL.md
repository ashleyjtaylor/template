---
name: infra
description: Plan or review AWS CDK infrastructure. Covers stack decomposition, deploy order, bootstrapping concerns, secrets management, security groups, and common failure patterns. Use before adding new infrastructure or debugging a deploy.
---

Read the existing infrastructure code first, then work through the following.

**Stack decomposition (3 stacks per environment)**

Split by lifecycle, not by resource type:

- `${product}-${env}-network` — VPC, subnets, NAT gateway(s), security groups. Rarely changes.
- `${product}-${env}-data` — RDS, ElastiCache Redis, ECR, Secrets Manager, S3 (uploads). Long-lived; deploys infrequently.
- `${product}-${env}-app` — ECS cluster + services (api + worker), ALB, CloudFront, Route53, ACM. Deploys frequently.

ECR lives in `data` because the image must exist before `app`'s ECS service can start. Secrets live in `data` for the same reason — they must be populated before `app` deploys.

**Deploy order**

First-deploy sequence (always sequential):
```
network → data → populate secrets out-of-band → push image → app
```

Subsequent deploys: push image → CI orchestrates an ECS rolling update. CDK runs only when infra changes.

**Migrations**

Run Prisma `migrate deploy` as an **ECS one-off task** before the API rolling update. Never at container startup — it causes boot storms when ECS scales out, and a slow migration fails healthchecks.

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

**Before adding new infrastructure, answer:**
- Which stack does this resource belong in (network / data / app), and why?
- Does anything need to exist before this resource can be used?
- Does this change the deploy order?
- What IAM permissions does the task role need?
- What security group rules are needed?
- What tags apply?
