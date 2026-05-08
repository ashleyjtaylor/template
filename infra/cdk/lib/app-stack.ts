import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import { type SecurityGroup, SubnetType, type Vpc } from 'aws-cdk-lib/aws-ec2'
import type { Repository } from 'aws-cdk-lib/aws-ecr'
import {
  Cluster,
  ContainerImage,
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
import type { Construct } from 'constructs'
import { type EnvName, PRODUCT } from './config.js'
import { APP_PORT } from './network-stack.js'

export interface AppStackProps extends StackProps {
  envName: EnvName
  vpc: Vpc
  albSg: SecurityGroup
  ecsSg: SecurityGroup
  apiRepo: Repository
  imageTag: string
}

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props)

    const { envName, vpc, albSg, ecsSg, apiRepo, imageTag } = props

    const cluster = new Cluster(this, 'Cluster', {
      vpc,
      clusterName: `${PRODUCT}-${envName}`
    })

    const logGroup = new LogGroup(this, 'ApiLogs', {
      logGroupName: `/ecs/${PRODUCT}-${envName}-api`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
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
      environment: {
        NODE_ENV: 'production',
        PORT: String(APP_PORT)
      },
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

    const alb = new ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: `${PRODUCT}-${envName}`
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

    new CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'Public DNS name of the ALB'
    })
  }
}
