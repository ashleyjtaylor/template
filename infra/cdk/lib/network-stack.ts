import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib'
import { IpAddresses, Peer, Port, SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2'
import type { Construct } from 'constructs'

export const APP_PORT = 3000
export const DB_PORT = 5432
export const REDIS_PORT = 6379

export class NetworkStack extends Stack {
  readonly vpc: Vpc
  readonly albSg: SecurityGroup
  readonly ecsSg: SecurityGroup
  readonly rdsSg: SecurityGroup
  readonly redisSg: SecurityGroup

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)

    this.vpc = new Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      ipAddresses: IpAddresses.cidr('10.0.0.0/16'),
      subnetConfiguration: [
        { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: 'private',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24
        }
      ]
    })

    this.albSg = new SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      description: 'ALB: inbound HTTP from internet',
      allowAllOutbound: true
    })
    this.albSg.addIngressRule(Peer.anyIpv4(), Port.tcp(80), 'HTTP from internet')

    this.ecsSg = new SecurityGroup(this, 'EcsSg', {
      vpc: this.vpc,
      description: 'ECS tasks: inbound app port from ALB SG only',
      allowAllOutbound: true
    })
    this.ecsSg.addIngressRule(this.albSg, Port.tcp(APP_PORT), 'app port from ALB')

    this.rdsSg = new SecurityGroup(this, 'RdsSg', {
      vpc: this.vpc,
      description: 'RDS Postgres: inbound 5432 from ECS SG only',
      allowAllOutbound: false
    })
    this.rdsSg.addIngressRule(this.ecsSg, Port.tcp(DB_PORT), 'Postgres from ECS')

    this.redisSg = new SecurityGroup(this, 'RedisSg', {
      vpc: this.vpc,
      description: 'ElastiCache Redis: inbound 6379 from ECS SG only',
      allowAllOutbound: false
    })
    this.redisSg.addIngressRule(this.ecsSg, Port.tcp(REDIS_PORT), 'Redis from ECS')

    // CFN outputs consumed by the migrate-db CI step (it needs to start a
    // one-off ECS task in the right subnets with the right SG).
    new CfnOutput(this, 'PrivateSubnetIds', {
      value: this.vpc
        .selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS })
        .subnetIds.join(','),
      description: 'Comma-separated private subnet IDs for run-task network config'
    })
    new CfnOutput(this, 'EcsSecurityGroupId', {
      value: this.ecsSg.securityGroupId,
      description: 'Security group ID for ECS tasks (used by run-task and the migrator)'
    })
  }
}
