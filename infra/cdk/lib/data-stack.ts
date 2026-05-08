import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  type SecurityGroup,
  SubnetType,
  type Vpc
} from 'aws-cdk-lib/aws-ec2'
import { Repository, TagStatus } from 'aws-cdk-lib/aws-ecr'
import {
  Cluster,
  ContainerImage,
  Secret as EcsSecret,
  FargateTaskDefinition,
  LogDrivers
} from 'aws-cdk-lib/aws-ecs'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  StorageType
} from 'aws-cdk-lib/aws-rds'
import type { Construct } from 'constructs'
import { type EnvName, PRODUCT } from './config.js'

export interface DataStackProps extends StackProps {
  envName: EnvName
  vpc: Vpc
  rdsSg: SecurityGroup
  imageTag: string
}

type DbSecrets = {
  DB_HOST: EcsSecret
  DB_PORT: EcsSecret
  DB_USER: EcsSecret
  DB_PASSWORD: EcsSecret
  DB_NAME: EcsSecret
}

// `template` (bare) is a reserved DB name on RDS Postgres because the engine
// uses `template0` / `template1` as system templates. Use `app` instead.
// Local Compose / CI use `template_dev` / `template_test` — Postgres only
// reserves the exact words `template0` and `template1`, so the underscored
// names are fine there.
const DB_NAME = 'app'
const DB_USER = 'template_admin'

export class DataStack extends Stack {
  readonly apiRepo: Repository
  readonly cluster: Cluster
  readonly database: DatabaseInstance
  readonly dbSecrets: DbSecrets

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props)

    const { envName, vpc, rdsSg, imageTag } = props

    this.apiRepo = new Repository(this, 'ApiRepo', {
      repositoryName: `${PRODUCT}-${envName}-api`,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
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

    this.database = new DatabaseInstance(this, 'Postgres', {
      // Latest Postgres minor that RDS exposes in eu-west-1. RDS lags
      // upstream by months; check `aws rds describe-db-engine-versions
      // --engine postgres` and bump the constant when a newer minor is
      // available. Compose at the repo root tracks the same major.
      engine: DatabaseInstanceEngine.postgres({
        version: PostgresEngineVersion.VER_18_3
      }),
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [rdsSg],
      databaseName: DB_NAME,
      credentials: Credentials.fromGeneratedSecret(DB_USER, {
        secretName: `${PRODUCT}-${envName}-db-credentials`
      }),
      allocatedStorage: 20,
      storageType: StorageType.GP3,
      multiAz: false,
      publiclyAccessible: false,
      storageEncrypted: true,
      autoMinorVersionUpgrade: true,
      backupRetention: Duration.days(7),
      deleteAutomatedBackups: true,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY
    })

    this.cluster = new Cluster(this, 'Cluster', {
      vpc,
      clusterName: `${PRODUCT}-${envName}`,
      containerInsightsV2: undefined
    })

    // DatabaseInstance.secret is typed as optional because not every
    // credential strategy creates one. With Credentials.fromGeneratedSecret
    // it's always present — narrow once here so the secret-mapping below is
    // typed without per-line assertions.
    const dbSecret = this.database.secret

    if (!dbSecret) {
      throw new Error(
        'RDS instance has no secret; Credentials.fromGeneratedSecret should have created one'
      )
    }

    this.dbSecrets = {
      DB_HOST: EcsSecret.fromSecretsManager(dbSecret, 'host'),
      DB_PORT: EcsSecret.fromSecretsManager(dbSecret, 'port'),
      DB_USER: EcsSecret.fromSecretsManager(dbSecret, 'username'),
      DB_PASSWORD: EcsSecret.fromSecretsManager(dbSecret, 'password'),
      DB_NAME: EcsSecret.fromSecretsManager(dbSecret, 'dbname')
    }

    const migratorLogGroup = new LogGroup(this, 'MigratorLogs', {
      logGroupName: `/ecs/${PRODUCT}-${envName}-migrator`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    })

    const migratorTaskDef = new FargateTaskDefinition(this, 'MigratorTask', {
      cpu: 256,
      memoryLimitMiB: 512,
      family: `${PRODUCT}-${envName}-migrator`
    })

    migratorTaskDef.addContainer('migrator', {
      image: ContainerImage.fromEcrRepository(this.apiRepo, imageTag),
      logging: LogDrivers.awsLogs({ logGroup: migratorLogGroup, streamPrefix: 'migrator' }),
      environment: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },
      secrets: this.dbSecrets,
      // Override the API image's CMD: this task only applies migrations, then
      // exits. CI's `aws ecs run-task` invocation doesn't override; this is
      // the canonical command.
      //
      // Don't prefix with `node` — `.bin/prisma` is a /bin/sh wrapper, not
      // JS, so `node node_modules/.bin/prisma` errors with "SyntaxError:
      // missing ) after argument list" on the wrapper's shell syntax. The
      // wrapper's shebang invokes node on the real JS entry on its own.
      command: ['node_modules/.bin/prisma', 'migrate', 'deploy', '--schema=./prisma/schema.prisma']
    })

    // CFN outputs consumed by the migrate-db CI step.
    new CfnOutput(this, 'MigratorTaskDefArn', {
      value: migratorTaskDef.taskDefinitionArn,
      description: 'Task definition ARN for the prisma migrate one-off task'
    })
    new CfnOutput(this, 'ApiClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS cluster name (shared by the API service and the migrator)'
    })
    new CfnOutput(this, 'MigratorLogGroupName', {
      value: migratorLogGroup.logGroupName,
      description: 'Log group for the migrator task — tail this on failure'
    })
  }
}
