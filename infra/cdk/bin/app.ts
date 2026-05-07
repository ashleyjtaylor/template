import { App } from 'aws-cdk-lib'
import { AppStack } from '../lib/app-stack.js'
import { aws, type EnvName, PRODUCT, tagsFor } from '../lib/config.js'
import { DataStack } from '../lib/data-stack.js'
import { NetworkStack } from '../lib/network-stack.js'

const app = new App()

const envs: EnvName[] = ['staging', 'production']

for (const env of envs) {
  const props = { env: aws, tags: tagsFor(env) }
  new NetworkStack(app, `${PRODUCT}-${env}-network`, props)
  new DataStack(app, `${PRODUCT}-${env}-data`, props)
  new AppStack(app, `${PRODUCT}-${env}-app`, props)
}
