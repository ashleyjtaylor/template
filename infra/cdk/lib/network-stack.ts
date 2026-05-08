import { Stack, type StackProps } from 'aws-cdk-lib'
import { IpAddresses, Peer, Port, SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2'
import type { Construct } from 'constructs'

export const APP_PORT = 3000

export class NetworkStack extends Stack {
  readonly vpc: Vpc
  readonly albSg: SecurityGroup
  readonly ecsSg: SecurityGroup

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
  }
}
