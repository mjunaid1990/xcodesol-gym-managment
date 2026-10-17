import { NextResponse } from 'next/server'
import { ZodError, type ZodType } from 'zod'

export class HttpError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details)
export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, 'unauthorized', message)
export const forbidden = (message = 'You do not have permission to do that') =>
  new HttpError(403, 'forbidden', message)
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`)
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, 'conflict', message, details)
export const unprocessable = (message: string, details?: unknown) =>
  new HttpError(422, 'unprocessable', message, details)
export const tooManyRequests = (message = 'Too many requests, slow down') =>
  new HttpError(429, 'rate_limited', message)

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init)
}

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 })
}

export function noContent() {
  return new NextResponse(null, { status: 204 })
}

export function failResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    )
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Some fields need attention',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      { status: 422 },
    )
  }
  const message = error instanceof Error ? error.message : 'Unexpected error'
  console.error('[api] unhandled error:', error)
  const isConfig = /AUTH_SECRET|DATABASE_URL/.test(message)
  return NextResponse.json(
    {
      error: {
        code: isConfig ? 'configuration_error' : 'internal_error',
        message: isConfig ? message : 'Something went wrong on our side',
      },
    },
    { status: isConfig ? 500 : 500 },
  )
}

/** Wrap a route handler so thrown HttpError/ZodError become clean JSON responses. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args)
    } catch (error) {
      return failResponse(error)
    }
  }
}

export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    throw badRequest('Request body must be valid JSON')
  }
  return schema.parse(payload)
}

export function readQuery<T>(request: Request, schema: ZodType<T>): T {
  const url = new URL(request.url)
  const raw: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    raw[key] = value
  })
  return schema.parse(raw)
}

export function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim()
  return request.headers.get('x-real-ip') ?? undefined
}

/**
 * CORS for the mobile app: token-based requests only, never cookies, so a wildcard
 * origin without credentials is both sufficient and safe. The web dashboard is
 * same-origin and does not rely on CORS at all.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Branch-Id',
  'Access-Control-Max-Age': '86400',
}

export function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value)
  }
  return response
}

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
