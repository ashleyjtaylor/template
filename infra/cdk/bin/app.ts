import { App, type StackProps } from 'aws-cdk-lib'
import { AppStack } from '../lib/app-stack.js'
import { aws, type EnvName, PRODUCT, tagsFor } from '../lib/config.js'
import { DataStack } from '../lib/data-stack.js'
import { NetworkStack } from '../lib/network-stack.js'

const app = new App()

// Use `||` not `??` — an empty-string `imageTag` (e.g. from a workflow that
// failed to substitute it) must be treated as missing. Without this, the
// empty tag becomes a tagless image reference in the CFN template, which
// Docker resolves to `:latest` — pulls fail because we never push `:latest`.
// `:placeholder` fails just as loudly but with a clearer error message.
const imageTag = app.node.tryGetContext('imageTag') || 'placeholder'

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
    imageTag
  })
}
