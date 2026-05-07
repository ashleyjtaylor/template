# CDK bootstrap

One-time per (AWS account, region). Required before the first `cdk deploy` against an account+region pair.

CDK bootstrap creates a small set of resources — an S3 bucket for assets, an ECR repository for asset images, and a handful of IAM roles — that all subsequent CDK deploys assume. Without it, `cdk deploy` fails with a "this environment has not been bootstrapped" error.

## Run it

From an admin shell with AWS credentials configured:

```bash
cd infra/cdk
pnpm install
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
pnpm exec cdk bootstrap aws://${ACCOUNT_ID}/eu-west-1
```

This creates a CloudFormation stack named `CDKToolkit` in `eu-west-1`. Takes ~2 minutes.

You only run this once per (account, region) combination. If a future fork deploys to additional regions, bootstrap each one separately.

## Tightening the deploy role afterwards

The GitHub OIDC deploy roles currently have `AdministratorAccess`. After bootstrap completes, the role's permissions can be tightened to:

- `sts:AssumeRole` on `arn:aws:iam::${ACCOUNT_ID}:role/cdk-*` (lets it assume CDK's execution roles)
- ECR push permissions (added when the API feature lands and we have images to push)
- ECS run-task + update-service (added when API/worker services exist)

Replace the policy attachment after the first successful deploy proves the OIDC + CDK chain works end-to-end.

## Verifying bootstrap worked

```bash
aws cloudformation describe-stacks --stack-name CDKToolkit --region eu-west-1 \
  --query 'Stacks[0].StackStatus' --output text
```

Expected: `CREATE_COMPLETE`.
