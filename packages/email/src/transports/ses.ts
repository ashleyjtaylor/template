import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import type { EmailTransport, SendEmailParams, TransportResult } from '../types.js'

// SES transport. Uses the SDK's default region resolution (reads
// AWS_REGION / AWS_DEFAULT_REGION / instance metadata) so we don't carry a
// service-specific knob. Auth via the worker task's IAM role
// (ses:SendEmail + ses:SendRawEmail granted in AppStack when emailDomain
// is configured).
export class SesSender implements EmailTransport {
  private client: SESv2Client | undefined

  private getClient(): SESv2Client {
    if (!this.client) this.client = new SESv2Client({})

    return this.client
  }

  async send(params: SendEmailParams & { from: string }): Promise<TransportResult> {
    const command = new SendEmailCommand({
      FromEmailAddress: params.from,
      Destination: { ToAddresses: [params.to] },
      Content: {
        Simple: {
          Subject: { Data: params.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: params.html, Charset: 'UTF-8' },
            ...(params.text ? { Text: { Data: params.text, Charset: 'UTF-8' } } : {})
          }
        }
      }
    })

    const result = await this.getClient().send(command)

    return { messageId: result.MessageId ?? null }
  }
}
