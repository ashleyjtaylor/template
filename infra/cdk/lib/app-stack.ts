import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  ViewerProtocolPolicy
} from 'aws-cdk-lib/aws-cloudfront'
import { LoadBalancerV2Origin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins'
import { type SecurityGroup, SubnetType, type Vpc } from 'aws-cdk-lib/aws-ec2'
import type { Repository } from 'aws-cdk-lib/aws-ecr'
import {
  type Cluster,
  ContainerImage,
  type Secret as EcsSecret,
  FargateService,
  FargateTaskDefinition,
  LogDrivers
} from 'aws-cdk-lib/aws-ecs'
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  Protocol,
  TargetType
} from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'
import { type EnvName, PRODUCT } from './config.js'
import { APP_PORT } from './network-stack.js'

export interface AppStackProps extends StackProps {
  envName: EnvName
  vpc: Vpc
  albSg: SecurityGroup
  ecsSg: SecurityGroup
  apiRepo: Repository
  workerRepo: Repository
  cluster: Cluster
  dbSecrets: Record<string, EcsSecret>
  appSecrets: Record<string, EcsSecret>
  redisHost: string
  redisPort: string
  imageTag: string
}

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props)

    const {
      envName,
      vpc,
      albSg,
      ecsSg,
      apiRepo,
      workerRepo,
      cluster,
      dbSecrets,
      appSecrets,
      redisHost,
      redisPort,
      imageTag
    } = props

    const logGroup = new LogGroup(this, 'ApiLogs', {
      logGroupName: `/ecs/${PRODUCT}-${envName}-api`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    })

    // ALB is constructed first so it can be referenced by both the CloudFront
    // distribution (as the /api/* origin) and the API task's env (where the
    // ALB DNS is the fallback for direct-to-ALB testing).
    const alb = new ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: `${PRODUCT}-${envName}`
    })

    // Each SPA gets its own private S3 bucket + CloudFront distribution.
    // Both distributions front the same ALB at `/api/*` so the API stays a
    // single deployment; the SPA bundle differs per app.
    const spaBucketProps = {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          // Cancel any abandoned multipart uploads after a day so they don't
          // accumulate billable storage.
          enabled: true,
          abortIncompleteMultipartUploadAfter: Duration.days(1)
        }
      ]
    }

    const internalSpaBucket = new Bucket(this, 'InternalSpaBucket', {
      bucketName: `${PRODUCT}-${envName}-internal-spa`,
      ...spaBucketProps
    })

    const webSpaBucket = new Bucket(this, 'WebSpaBucket', {
      bucketName: `${PRODUCT}-${envName}-web-spa`,
      ...spaBucketProps
    })

    // CloudFront fronts everything. Default behavior serves the SPA bundle
    // from S3; `/api/*` proxies to the ALB. Browser sees a single origin
    // per distribution, so the SPA's session cookie travels same-origin to
    // the API — no CORS, no cross-domain cookie dance. Each SPA has its
    // own distribution + cookie scope.
    const apiBehavior = {
      origin: new LoadBalancerV2Origin(alb, {
        protocolPolicy: OriginProtocolPolicy.HTTP_ONLY,
        httpPort: 80
      }),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      // Forward cookies, Origin, Authorization etc. to the API. We exclude
      // Host so CF rewrites it to the ALB's hostname (otherwise the ALB
      // doesn't know how to route).
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER
    }

    // SPA routing: any path not in S3 (e.g. /accept-invite, /audit/<id>)
    // returns index.html so the React Router can take over client-side. S3
    // with OAC returns 403 for missing keys; CloudFront returns 404 for the
    // rest.
    const spaErrorResponses = [
      {
        httpStatus: 404,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.minutes(0)
      },
      {
        httpStatus: 403,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.minutes(0)
      }
    ]

    const internalDistribution = new Distribution(this, 'InternalSpaDistribution', {
      comment: `${PRODUCT}-${envName} apps/internal + api`,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(internalSpaBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // Hashed Vite assets (`/assets/*-<hash>.js|css`) cache forever; the
        // CI step uploads `index.html` with explicit Cache-Control: no-cache
        // so SPA-shell updates ship on the next request.
        cachePolicy: CachePolicy.CACHING_OPTIMIZED
      },
      additionalBehaviors: { '/api/*': apiBehavior },
      errorResponses: spaErrorResponses
    })

    const webDistribution = new Distribution(this, 'WebSpaDistribution', {
      comment: `${PRODUCT}-${envName} apps/web + api`,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(webSpaBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED
      },
      additionalBehaviors: { '/api/*': apiBehavior },
      errorResponses: spaErrorResponses
    })

    const taskDef = new FargateTaskDefinition(this, 'ApiTask', {
      cpu: 256,
      memoryLimitMiB: 512
    })

    const container = taskDef.addContainer('api', {
      image: ContainerImage.fromEcrRepository(apiRepo, imageTag),
      logging: LogDrivers.awsLogs({ logGroup, streamPrefix: 'api' }),
      // GIT_SHA is intentionally not set here — it is baked into the image at
      // build time via the Dockerfile's GIT_SHA build arg, so the image is
      // self-describing. Injecting it here too would let the values disagree.
      //
      // BETTER_AUTH_URL stays on the internal CloudFront — single canonical
      // base for any future OAuth callback / email link. CORS_ORIGINS lists
      // every SPA distribution that must pass better-auth's Origin check;
      // each SPA's session cookie is scoped to its own distribution host so
      // sessions don't bleed across the staff / customer apps. Once
      // Route53/ACM land, swap to the real `https://internal.<domain>` etc.
      environment: {
        NODE_ENV: 'production',
        // APP_ENV (not NODE_ENV) is what tells the app which AWS environment
        // it is running in — staging and production both want NODE_ENV=production
        // for the runtime optimisations, so a separate signal is needed. See
        // the APP_ENV comment in apps/api/src/env.ts.
        APP_ENV: envName,
        PORT: String(APP_PORT),
        // Redis connection. The API talks to Redis for Bull Board (queue
        // inspection at /api/admin/queues). REDIS_AUTH_TOKEN arrives via the
        // secrets block below; `@template/events` composes the rediss:// URL.
        REDIS_HOST: redisHost,
        REDIS_PORT: redisPort,
        BETTER_AUTH_URL: `https://${internalDistribution.distributionDomainName}`,
        CORS_ORIGINS: [
          `https://${internalDistribution.distributionDomainName}`,
          `https://${webDistribution.distributionDomainName}`
        ].join(',')
      },
      secrets: { ...dbSecrets, ...appSecrets },
      // Window between SIGTERM and SIGKILL. Must stay >= SHUTDOWN_TIMEOUT_MS
      // in apps/api/src/env.ts so the app can drain in-flight requests
      // before ECS force-kills the container.
      stopTimeout: Duration.seconds(30),
      healthCheck: {
        command: [
          'CMD-SHELL',
          `node -e "fetch('http://localhost:${APP_PORT}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60)
      }
    })

    container.addPortMappings({ containerPort: APP_PORT })

    const service = new FargateService(this, 'ApiService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      assignPublicIp: false,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS }
    })

    const targetGroup = new ApplicationTargetGroup(this, 'ApiTargets', {
      vpc,
      port: APP_PORT,
      protocol: ApplicationProtocol.HTTP,
      targetType: TargetType.IP,
      targets: [service],
      deregistrationDelay: Duration.seconds(30),
      healthCheck: {
        path: '/health',
        protocol: Protocol.HTTP,
        port: String(APP_PORT),
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200'
      }
    })

    alb.addListener('HttpListener', {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup]
    })

    // Worker: BullMQ consumer + scheduled jobs. No HTTP server, no ALB target
    // group, no port mapping — health is "the task is up". Same SG as the API
    // (it's outbound only that matters for Redis + DB; the SG's inbound rules
    // don't apply since nothing tries to connect to the worker).
    const workerLogGroup = new LogGroup(this, 'WorkerLogs', {
      logGroupName: `/ecs/${PRODUCT}-${envName}-worker`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    })

    const workerTaskDef = new FargateTaskDefinition(this, 'WorkerTask', {
      cpu: 256,
      memoryLimitMiB: 512
    })

    workerTaskDef.addContainer('worker', {
      image: ContainerImage.fromEcrRepository(workerRepo, imageTag),
      logging: LogDrivers.awsLogs({ logGroup: workerLogGroup, streamPrefix: 'worker' }),
      environment: {
        NODE_ENV: 'production',
        APP_ENV: envName,
        REDIS_HOST: redisHost,
        REDIS_PORT: redisPort
      },
      secrets: { ...dbSecrets, ...appSecrets },
      // Window between SIGTERM and SIGKILL. Must stay >= SHUTDOWN_TIMEOUT_MS
      // in apps/worker/src/env.ts so BullMQ Workers can drain in-flight jobs
      // before ECS force-kills the container.
      stopTimeout: Duration.seconds(30)
    })

    new FargateService(this, 'WorkerService', {
      cluster,
      taskDefinition: workerTaskDef,
      desiredCount: 1,
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      assignPublicIp: false,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS }
    })

    new CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'Public DNS name of the ALB (direct origin; canonical entry is CloudFront)'
    })
    new CfnOutput(this, 'InternalSpaUrl', {
      value: `https://${internalDistribution.distributionDomainName}`,
      description: 'CloudFront URL serving apps/internal + proxied /api/*'
    })
    new CfnOutput(this, 'InternalSpaBucketName', {
      value: internalSpaBucket.bucketName,
      description: 'S3 bucket the CI deploy-internal-spa job syncs the apps/internal bundle into'
    })
    new CfnOutput(this, 'InternalSpaDistributionId', {
      value: internalDistribution.distributionId,
      description: 'CloudFront distribution ID for cache invalidations on apps/internal deploy'
    })
    new CfnOutput(this, 'WebSpaUrl', {
      value: `https://${webDistribution.distributionDomainName}`,
      description: 'CloudFront URL serving apps/web + proxied /api/*'
    })
    new CfnOutput(this, 'WebSpaBucketName', {
      value: webSpaBucket.bucketName,
      description: 'S3 bucket the CI deploy-web-spa job syncs the apps/web bundle into'
    })
    new CfnOutput(this, 'WebSpaDistributionId', {
      value: webDistribution.distributionId,
      description: 'CloudFront distribution ID for cache invalidations on apps/web deploy'
    })
  }
}
