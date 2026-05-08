import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import { Repository, TagStatus } from 'aws-cdk-lib/aws-ecr'
import type { Construct } from 'constructs'
import { type EnvName, PRODUCT } from './config.js'

export interface DataStackProps extends StackProps {
  envName: EnvName
}

export class DataStack extends Stack {
  readonly apiRepo: Repository

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props)

    this.apiRepo = new Repository(this, 'ApiRepo', {
      repositoryName: `${PRODUCT}-${props.envName}-api`,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: [
        {
          rulePriority: 1,
          description: 'Expire untagged images after 14 days',
          tagStatus: TagStatus.UNTAGGED,
          maxImageAge: Duration.days(14)
        },
        {
          rulePriority: 2,
          description: 'Keep only the last 30 untagged images',
          tagStatus: TagStatus.UNTAGGED,
          maxImageCount: 30
        }
      ]
    })
  }
}
