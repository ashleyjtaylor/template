import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  GIT_SHA: z.preprocess((v) => v || undefined, z.string().default('unknown'))
})

export const env = schema.parse(process.env)
