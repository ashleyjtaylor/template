import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text
} from '@react-email/components'
import { render } from '@react-email/render'

export interface InvitationEmailProps {
  inviterName: string
  orgName: string
  acceptUrl: string
}

// React-email template. File-internal — consumers only see the factory
// `invitationEmail` below; the component is an implementation detail.
function InvitationTemplate({ inviterName, orgName, acceptUrl }: InvitationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`${inviterName} invited you to ${orgName}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>You've been invited</Heading>
          <Text style={text}>
            {inviterName} has invited you to join <strong>{orgName}</strong>.
          </Text>
          <Section style={buttonSection}>
            <Button style={button} href={acceptUrl}>
              Accept invitation
            </Button>
          </Section>
          <Text style={text}>
            Or copy this link into your browser:
            <br />
            <a href={acceptUrl} style={link}>
              {acceptUrl}
            </a>
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            This invitation expires in 7 days. If you didn't expect this email, you can ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

// Returns the full email envelope the `sendEmail` facade consumes. Each
// template module exposes one of these — keeps subject + body + plaintext
// alternative in lockstep with the template itself.
export async function invitationEmail(
  props: InvitationEmailProps
): Promise<{ subject: string; html: string; text: string; template: 'invitation' }> {
  const subject = `${props.inviterName} invited you to ${props.orgName}`
  const element = InvitationTemplate(props)
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })])

  return { subject, html, text, template: 'invitation' }
}

const body = { backgroundColor: '#f6f6f6', fontFamily: 'system-ui, -apple-system, sans-serif' }
const container = {
  margin: '40px auto',
  padding: '24px',
  maxWidth: '480px',
  backgroundColor: '#ffffff',
  borderRadius: '8px'
}
const heading = { fontSize: '20px', fontWeight: 600, color: '#111', marginBottom: '16px' }
const text = { fontSize: '14px', color: '#333', lineHeight: 1.6 }
const buttonSection = { textAlign: 'center' as const, margin: '24px 0' }
const button = {
  backgroundColor: '#111',
  color: '#fff',
  padding: '10px 20px',
  borderRadius: '6px',
  fontSize: '14px',
  textDecoration: 'none',
  display: 'inline-block'
}
const link = { color: '#0066cc', wordBreak: 'break-all' as const }
const hr = { borderColor: '#e5e5e5', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#777' }
