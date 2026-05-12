import { createTransport, type Transporter } from 'nodemailer'
import { env } from '../env.js'
import type { EmailTransport, SendEmailParams, TransportResult } from '../types.js'

// Local SMTP transport pointed at Mailpit (docker-compose service on
// :1025). No AUTH, no TLS. Deployed envs use SesSender instead.
export class MailpitSender implements EmailTransport {
  private transporter: Transporter | undefined

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = createTransport({
        host: env.MAILPIT_HOST,
        port: env.MAILPIT_PORT,
        secure: false,
        // Mailpit accepts anything; explicit ignoreTLS removes the
        // upgrade-to-TLS handshake which Mailpit doesn't speak.
        ignoreTLS: true
      })
    }

    return this.transporter
  }

  async send(params: SendEmailParams & { from: string }): Promise<TransportResult> {
    const info = await this.getTransporter().sendMail({
      from: params.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text
    })

    return { messageId: info.messageId ?? null }
  }
}
