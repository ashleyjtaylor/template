import { App, type StackProps } from 'aws-cdk-lib'
import { AppStack } from '../lib/app-stack.js'
import { aws, type EnvName, PRODUCT, tagsFor } from '../lib/config.js'
import { DataStack } from '../lib/data-stack.js'
import { NetworkStack } from '../lib/network-stack.js'

const app = new App()

const imageTag = app.node.tryGetContext('imageTag') ?? 'placeholder'

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
    envName: env
  })

  new AppStack(app, `${PRODUCT}-${env}-app`, {
    ...baseProps,
    envName: env,
    vpc: network.vpc,
    albSg: network.albSg,
    ecsSg: network.ecsSg,
    apiRepo: data.apiRepo,
    imageTag
  })
}
