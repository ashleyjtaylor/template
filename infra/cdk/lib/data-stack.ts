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
      // ECR allows only one rule per storage class (tagged / untagged).
      // We keep the last 30 tagged deploy artifacts and expire any untagged
      // stragglers (manual interventions, scanner re-pushes) within a day.
      lifecycleRules: [
        {
          rulePriority: 1,
          description: 'Keep only the last 30 tagged images',
          tagStatus: TagStatus.TAGGED,
          tagPatternList: ['*'],
          maxImageCount: 30
        },
        {
          rulePriority: 2,
          description: 'Expire untagged images after 1 day',
          tagStatus: TagStatus.UNTAGGED,
          maxImageAge: Duration.days(1)
        }
      ]
    })
  }
}
