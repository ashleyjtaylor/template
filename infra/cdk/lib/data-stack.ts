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
import { CfnReplicationGroup, CfnSubnetGroup } from 'aws-cdk-lib/aws-elasticache'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  StorageType
} from 'aws-cdk-lib/aws-rds'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'
import { type EnvName, PRODUCT } from './config.js'

export interface DataStackProps extends StackProps {
  envName: EnvName
  vpc: Vpc
  rdsSg: SecurityGroup
  redisSg: SecurityGroup
  imageTag: string
}

type DbSecrets = {
  DB_HOST: EcsSecret
  DB_PORT: EcsSecret
  DB_USER: EcsSecret
  DB_PASSWORD: EcsSecret
  DB_NAME: EcsSecret
}

type AppSecrets = {
  BETTER_AUTH_SECRET: EcsSecret
  REDIS_AUTH_TOKEN: EcsSecret
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
  readonly workerRepo: Repository
  readonly cluster: Cluster
  readonly database: DatabaseInstance
  readonly dbSecrets: DbSecrets
  readonly appSecrets: AppSecrets
  readonly redisHost: string
  readonly redisPort: string

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props)

    const { envName, vpc, rdsSg, redisSg, imageTag } = props

    const ecrLifecycleRules = [
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

    this.apiRepo = new Repository(this, 'ApiRepo', {
      repositoryName: `${PRODUCT}-${envName}-api`,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: ecrLifecycleRules
    })

    this.workerRepo = new Repository(this, 'WorkerRepo', {
      repositoryName: `${PRODUCT}-${envName}-worker`,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: ecrLifecycleRules
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

    // App-level secrets share one Secrets Manager entry as a JSON document so
    // future fields (Stripe key, SES creds, etc.) just add another key without
    // multiplying secrets and their per-secret monthly cost. Each field is
    // injected into ECS as its own env var via fromSecretsManager(secret, key).
    const appSecretsRaw = new Secret(this, 'AppSecrets', {
      secretName: `${PRODUCT}-${envName}-app-secrets`,
      description: 'App-level secrets (better-auth signing key, future app secrets)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'betterAuthSecret',
        passwordLength: 64,
        // Punctuation-free keeps the value safe to inline in shell/JSON
        // contexts. Better-auth uses it for HMAC, not URL-encoded transport,
        // so no character-class requirements apply.
        excludePunctuation: true
      }
    })

    // Redis AUTH token lives in a separate Secrets Manager entry because
    // generateSecretString can only auto-generate one field per secret; we
    // need a second auto-generated value alongside betterAuthSecret. ElastiCache
    // forbids @ " / in AUTH tokens.
    const redisSecretsRaw = new Secret(this, 'RedisSecrets', {
      secretName: `${PRODUCT}-${envName}-redis-secrets`,
      description: 'Redis AUTH token for ElastiCache (used by BullMQ on ECS)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'redisAuthToken',
        passwordLength: 64,
        excludePunctuation: true,
        excludeCharacters: '@"/'
      }
    })

    this.appSecrets = {
      BETTER_AUTH_SECRET: EcsSecret.fromSecretsManager(appSecretsRaw, 'betterAuthSecret'),
      REDIS_AUTH_TOKEN: EcsSecret.fromSecretsManager(redisSecretsRaw, 'redisAuthToken')
    }

    // ElastiCache (Valkey 8 — Redis-protocol-compatible, AWS's go-forward
    // engine after Redis's licence change). Staging: single node, t4g.micro,
    // single-AZ. Production sizing (t4g.small × 2, multi-AZ failover) lives
    // in a follow-up.
    const redisSubnetGroup = new CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: `Redis subnet group for ${PRODUCT} ${envName}`,
      subnetIds: vpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
      cacheSubnetGroupName: `${PRODUCT}-${envName}-redis-subnets`
    })

    const redis = new CfnReplicationGroup(this, 'Redis', {
      replicationGroupId: `${PRODUCT}-${envName}-redis`,
      replicationGroupDescription: `${PRODUCT} ${envName} BullMQ`,
      engine: 'valkey',
      engineVersion: '8.0',
      cacheNodeType: 'cache.t4g.micro',
      numCacheClusters: 1,
      automaticFailoverEnabled: false,
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
      securityGroupIds: [redisSg.securityGroupId],
      authToken: redisSecretsRaw.secretValueFromJson('redisAuthToken').unsafeUnwrap(),
      transitEncryptionEnabled: true,
      atRestEncryptionEnabled: true,
      port: 6379
    })
    redis.addDependency(redisSubnetGroup)

    this.redisHost = redis.attrPrimaryEndPointAddress
    this.redisPort = redis.attrPrimaryEndPointPort

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
      // prisma is a runtime dep of @template/db (not apps/api), so the CLI
      // lives at /app/node_modules/@template/db/node_modules/.bin/prisma after
      // `pnpm deploy`. Run it via sh -c with a `cd` so prisma.config.ts +
      // prisma/schema.prisma resolve relative to @template/db's directory.
      //
      // Don't prefix with `node` — `.bin/prisma` is a /bin/sh wrapper, not JS,
      // so `node node_modules/.bin/prisma` errors with "SyntaxError: missing
      // ) after argument list" on the wrapper's shell syntax. The wrapper's
      // shebang invokes node on the real JS entry on its own.
      command: [
        'sh',
        '-c',
        'cd node_modules/@template/db && node_modules/.bin/prisma migrate deploy'
      ]
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

    // One-shot Fargate task that creates / promotes a staff user. Invoked
    // exclusively by .github/workflows/bootstrap-staff.yml via `aws ecs
    // run-task` with `BOOTSTRAP_STAFF_*` env overrides — never on regular
    // deploys, never with long-lived credentials baked in. Same image as the
    // migrator so the script is just a different CMD.
    const bootstrapStaffLogGroup = new LogGroup(this, 'BootstrapStaffLogs', {
      logGroupName: `/ecs/${PRODUCT}-${envName}-bootstrap`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    })

    const bootstrapStaffTaskDef = new FargateTaskDefinition(this, 'BootstrapStaffTask', {
      cpu: 256,
      memoryLimitMiB: 512,
      family: `${PRODUCT}-${envName}-bootstrap`
    })

    bootstrapStaffTaskDef.addContainer('bootstrap-staff', {
      image: ContainerImage.fromEcrRepository(this.apiRepo, imageTag),
      logging: LogDrivers.awsLogs({
        logGroup: bootstrapStaffLogGroup,
        streamPrefix: 'bootstrap-staff'
      }),
      environment: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },
      // DB to write the user; app secrets so better-auth can hash the password
      // and run its create hooks. BETTER_AUTH_URL stays at the env.ts default
      // (localhost) — this script never serves HTTP, so no callback URL is
      // exercised. Bootstrap creds are NOT injected here; they arrive at
      // run-task time as env overrides.
      secrets: { ...this.dbSecrets, ...this.appSecrets },
      command: ['node', 'dist/scripts/bootstrap-staff.js']
    })

    new CfnOutput(this, 'BootstrapStaffTaskDefArn', {
      value: bootstrapStaffTaskDef.taskDefinitionArn,
      description: 'Task definition ARN for the bootstrap-staff one-off task'
    })
    new CfnOutput(this, 'BootstrapStaffLogGroupName', {
      value: bootstrapStaffLogGroup.logGroupName,
      description: 'Log group for the bootstrap-staff task — tail this on failure'
    })

    new CfnOutput(this, 'WorkerRepoUri', {
      value: this.workerRepo.repositoryUri,
      description: 'ECR repo URI for the worker image (build-worker-image CI job pushes here)'
    })
    new CfnOutput(this, 'RedisHost', {
      value: this.redisHost,
      description: 'Primary endpoint host for ElastiCache Redis (injected as REDIS_HOST)'
    })
    new CfnOutput(this, 'RedisPort', {
      value: this.redisPort,
      description: 'Primary endpoint port for ElastiCache Redis (injected as REDIS_PORT)'
    })
  }
}
