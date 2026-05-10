import { createHash, randomBytes } from 'node:crypto'

const TOKEN_BYTES = 32

export const generateInviteToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url')

export const hashToken = (rawToken: string): string =>
  createHash('sha256').update(rawToken).digest('hex')
