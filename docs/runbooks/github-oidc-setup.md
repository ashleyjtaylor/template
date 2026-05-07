# GitHub OIDC + AWS deploy roles

One-time setup per AWS account + product fork. Lets GitHub Actions assume scoped IAM roles to deploy CDK stacks without any long-lived AWS credentials in GitHub.

## Architecture

```
GitHub Actions workflow (environment: staging or production)
        │
        ▼  short-lived JWT issued by token.actions.githubusercontent.com
AWS IAM OIDC provider  ──────  one per AWS account, shared across all forks
        │
        ▼  assume-role-with-web-identity, sub claim filtered to repo + environment
IAM role: ${product}-deploy-staging      OR      ${product}-deploy-production
        │
        ▼  uses CDK execution roles created by `cdk bootstrap`
CloudFormation deploy
```

The trust policy on each IAM role limits *who* can assume it (your repo, that environment). The OIDC token's `sub` claim is the security boundary — even if the workflow were tampered with, it cannot assume a role for a different environment.

## Prerequisites

- AWS CLI v2 configured with admin credentials.
- A GitHub repo created and pushed (the GitHub repo must exist before the OIDC roles are useful).
- Decided values:
  - `ACCOUNT_ID` — your AWS account ID (`aws sts get-caller-identity --query Account --output text`)
  - `GITHUB_REPO` — `OWNER/REPO`, e.g. `ashleytaylor14/template`
  - `PRODUCT` — short slug used in role names, e.g. `template`

```bash
ACCOUNT_ID=123456789012
GITHUB_REPO=OWNER/REPO
PRODUCT=template
```

## Step 1 — Create the OIDC provider (one-time per AWS account)

Skip this step if another fork sharing the same AWS account has already done it. Verify with:

```bash
aws iam list-open-id-connect-providers
```

If `token.actions.githubusercontent.com` already appears, skip ahead to Step 2.

Otherwise:

```bash
aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

The thumbprint is GitHub's OIDC certificate fingerprint. AWS auto-trusts GitHub's certs internally, but the CLI still requires the parameter.

## Step 2 — Create the staging deploy role

```bash
cat > /tmp/trust-staging.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Principal": {
        "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:environment:staging"
        }
      }
    }
  ]
}
EOF

aws iam create-role --role-name ${PRODUCT}-deploy-staging --assume-role-policy-document file:///tmp/trust-staging.json --description "GitHub Actions deploys to ${PRODUCT} staging"

aws iam attach-role-policy --role-name ${PRODUCT}-deploy-staging --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

aws iam get-role --role-name ${PRODUCT}-deploy-staging --query Role.Arn --output text
```

Capture the role ARN printed by the last command — you'll need it for Step 4.

## Step 3 — Create the production deploy role

Identical to Step 2 but with `production` everywhere:

```bash
cat > /tmp/trust-production.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Principal": {
        "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:environment:production"
        }
      }
    }
  ]
}
EOF

aws iam create-role --role-name ${PRODUCT}-deploy-production --assume-role-policy-document file:///tmp/trust-production.json --description "GitHub Actions deploys to ${PRODUCT} production"

aws iam attach-role-policy --role-name ${PRODUCT}-deploy-production --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

aws iam get-role --role-name ${PRODUCT}-deploy-production --query Role.Arn --output text
```

## Step 4 — Wire role ARNs into GitHub Environments

GitHub UI → **Settings → Environments**:

- **`staging`** environment → add secret:
  - Name: `AWS_DEPLOY_ROLE_ARN`
  - Value: `arn:aws:iam::${ACCOUNT_ID}:role/${PRODUCT}-deploy-staging`
- **`production`** environment → add secret:
  - Name: `AWS_DEPLOY_ROLE_ARN`
  - Value: `arn:aws:iam::${ACCOUNT_ID}:role/${PRODUCT}-deploy-production`

Set `production`'s protection rules to require at least one reviewer and restrict deployment branches to `main`.

## Step 5 — Clean up

```bash
rm /tmp/trust-staging.json /tmp/trust-production.json
```

## Common pitfalls

**Trust policy `sub` claim format.** Use exactly `repo:OWNER/REPO:environment:NAME` with `StringEquals`. Mistakes that cause `AccessDenied`:

- Trailing `:*` (e.g. `…:environment:staging:*`) — the actual `sub` claim has nothing after `staging`, so this never matches.
- `StringLike` with no wildcard — same as `StringEquals` but slower; just use `StringEquals`.
- Duplicating the same value in the array — only one is needed; an array of identical entries is the same as one.
- Using `branch` instead of `environment` — only valid if the workflow doesn't declare `environment:`.

**`aws: [ERROR] argument operation: Found invalid choice 'https://...'`** — line continuations didn't survive the paste. Rewrite the command on a single line.

**`AccessDenied` when the workflow runs.** Check the GitHub Actions log for the `sub` claim it sent, then compare to the trust policy. CloudWatch will not log this — only the GitHub log will.

## Tightening the deploy role (after first successful deploy)

The roles currently have `AdministratorAccess`. After CDK is bootstrapped and the staging deploy succeeds at least once, swap the policy to a tighter version that only grants:

- `sts:AssumeRole` on `arn:aws:iam::${ACCOUNT_ID}:role/cdk-*` (CDK's execution roles)
- ECR push permissions (added when the API feature lands)
- ECS run-task + update-service (added when API/worker exist)

Replace via:

```bash
aws iam detach-role-policy --role-name ${PRODUCT}-deploy-staging --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
aws iam put-role-policy --role-name ${PRODUCT}-deploy-staging --policy-name deploy --policy-document file:///tmp/policy-staging.json
```

The actual JSON for the tightened policy will be added to this runbook when CDK is bootstrapped and the surface is known.

## Re-running on a new fork

If you fork this template into a new product:

- **Step 1**: Skip — the OIDC provider is already in your account.
- **Steps 2–4**: Repeat with a new `PRODUCT` slug. Roles in the same account don't conflict because role names are unique per slug.
