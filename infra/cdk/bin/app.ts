import { App, type StackProps } from 'aws-cdk-lib'
import { AppStack } from '../lib/app-stack.js'
import { aws, type EnvName, PRODUCT, tagsFor } from '../lib/config.js'
import { DataStack } from '../lib/data-stack.js'
import { EmailStack } from '../lib/email-stack.js'
import { NetworkStack } from '../lib/network-stack.js'

const app = new App()

// Use `||` not `??` — an empty-string `imageTag` (e.g. from a workflow that
// failed to substitute it) must be treated as missing. Without this, the
// empty tag becomes a tagless image reference in the CFN template, which
// Docker resolves to `:latest` — pulls fail because we never push `:latest`.
// `:placeholder` fails just as loudly but with a clearer error message.
const imageTag = app.node.tryGetContext('imageTag') || 'placeholder'

// Optional per-env sending domain. Forks set this via cdk.json or
// `-c emailDomain.staging=mail.example.com`. Without it, EmailStack is not
// instantiated and the worker keeps @template/email's LogOnlySender.
const emailDomainFor = (env: EnvName): string | undefined => {
  const value = app.node.tryGetContext(`emailDomain.${env}`)

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

// Per-env Stripe Pro price id. Forks set via cdk.json or
// `-c stripePriceIdPro.staging=price_…`. Empty until configured — the
// billing module's `isBillingConfigured()` predicate gates real Stripe
// calls and returns a 503 from /api/orgs/:orgId/billing/* in the
// meantime. Webhook + Checkout secrets live in Secrets Manager and are
// managed out-of-band (see docs/runbooks/billing-smoke.md).
const stripePriceIdProFor = (env: EnvName): string | undefined => {
  const value = app.node.tryGetContext(`stripePriceIdPro.${env}`)

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const envs: EnvName[] = ['staging', 'production']

for (const env of envs) {
  const baseProps: StackProps = {
    env: aws,
    tags: tagsFor(env),
    terminationProtection: false
  }

  const network = new NetworkStack(app, `${PRODUCT}-${env}-network`, baseProps)

  const data = new DataStack(app, `${PRODUCT}-${env}-data`, {
    ...baseProps,
    envName: env,
    vpc: network.vpc,
    rdsSg: network.rdsSg,
    redisSg: network.redisSg,
    imageTag
  })

  const emailDomain = emailDomainFor(env)
  const emailStack = emailDomain
    ? new EmailStack(app, `${PRODUCT}-${env}-email`, {
        ...baseProps,
        envName: env,
        emailDomain
      })
    : undefined

  new AppStack(app, `${PRODUCT}-${env}-app`, {
    ...baseProps,
    envName: env,
    vpc: network.vpc,
    albSg: network.albSg,
    ecsSg: network.ecsSg,
    apiRepo: data.apiRepo,
    workerRepo: data.workerRepo,
    cluster: data.cluster,
    dbSecrets: data.dbSecrets,
    appSecrets: data.appSecrets,
    redisHost: data.redisHost,
    redisPort: data.redisPort,
    imageTag,
    emailDomain,
    emailIdentityArn: emailStack?.identityArn,
    emailConfigurationSetName: emailStack?.configurationSetName,
    stripePriceIdPro: stripePriceIdProFor(env)
  })
}
