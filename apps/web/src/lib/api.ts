import { z } from 'zod'

// Wire-shape returned by the API on 4xx/5xx — matches `formatError` in
// apps/api/src/lib/errors.ts.
const errorWireSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional()
})

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details: unknown = undefined) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
}

// Typed fetch wrapper. Sends `credentials: 'include'` so the better-auth
// session cookie travels with every request. Throws an ApiError on non-2xx
// responses; otherwise parses the JSON body against the provided schema.
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  options: ApiOptions = {}
): Promise<T> {
  const { body, headers, ...rest } = options
  const init: RequestInit = {
    credentials: 'include',
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  }

  if (body !== undefined) init.body = JSON.stringify(body)

  const res = await fetch(path, init)

  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as unknown
    const parsed = errorWireSchema.safeParse(json)

    throw new ApiError(
      res.status,
      parsed.success ? parsed.data.code : 'UnknownError',
      parsed.success ? parsed.data.message : `HTTP ${res.status}`,
      parsed.success ? parsed.data.details : undefined
    )
  }

  // 204 No Content responses (e.g. DELETE endpoints) have no body — calling
  // `res.json()` would throw a SyntaxError. Callers of such endpoints are
  // expected to pass `z.unknown()` or similar; we parse `undefined` against
  // the schema so loose schemas pass through.
  if (res.status === 204) return schema.parse(undefined)

  return schema.parse(await res.json())
}
