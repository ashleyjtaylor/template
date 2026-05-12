import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib'
import { HostedZone } from 'aws-cdk-lib/aws-route53'
import { ConfigurationSet, EmailIdentity, Identity } from 'aws-cdk-lib/aws-ses'
import type { Construct } from 'constructs'
import { type EnvName, PRODUCT } from './config.js'

export interface EmailStackProps extends StackProps {
  envName: EnvName
  // The domain to set up SES sending for. Fork supplies this via
  // `-c emailDomain=...` context. A Route53 hosted zone for the domain must
  // already exist in the same AWS account for the DKIM lookup.
  emailDomain: string
}

// Optional stack: only instantiated when `bin/app.ts` receives an
// `emailDomain` context flag. Without it, `@template/email`'s
// `LogOnlySender` handles deployed-env sends (no actual delivery, written to
// the worker log instead).
//
// Production-access lift (out of sandbox mode) is OUT of scope — file the
// AWS support ticket separately. CDK can't automate that part.
export class EmailStack extends Stack {
  readonly identityArn: string
  readonly configurationSetName: string

  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props)

    const { envName, emailDomain } = props

    // Looks up the existing Route53 hosted zone for the email domain. The
    // EmailIdentity construct then auto-provisions DKIM CNAMEs inside it
    // — no manual record copying required.
    const zone = HostedZone.fromLookup(this, 'EmailHostedZone', {
      domainName: emailDomain
    })

    const identity = new EmailIdentity(this, 'EmailIdentity', {
      identity: Identity.publicHostedZone(zone)
    })

    // Placeholder for the bounce-handling PR — it will attach an
    // `EventDestination` to this configuration set so SNS/SQS receives
    // bounce + complaint events.
    const configurationSet = new ConfigurationSet(this, 'EmailConfigurationSet', {
      configurationSetName: `${PRODUCT}-${envName}-default`
    })

    this.identityArn = identity.emailIdentityArn
    this.configurationSetName = configurationSet.configurationSetName

    new CfnOutput(this, 'EmailDomain', {
      value: emailDomain,
      description: 'SES verified sending domain'
    })
    new CfnOutput(this, 'EmailIdentityArn', {
      value: this.identityArn,
      description: 'ARN of the SES EmailIdentity (scope for IAM ses:SendEmail grants)'
    })
    new CfnOutput(this, 'EmailConfigurationSetName', {
      value: this.configurationSetName,
      description: 'Default SES configuration set — attach bounce/complaint events here later'
    })
    new CfnOutput(this, 'EmailProductionAccessNote', {
      value: 'Sandbox mode: only sends to verified addresses. File AWS support ticket for prod.',
      description: 'Reminder — production access requires a separate AWS support request'
    })
  }
}
