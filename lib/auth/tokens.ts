import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { HttpError } from '@/lib/api/http'
import type { Role } from '@/lib/constants'

export const ACCESS_COOKIE = 'ih_access'
export const REFRESH_COOKIE = 'ih_refresh'
export const ACCESS_TTL_MINUTES = 15
export const REFRESH_TTL_DAYS = 30

export interface AccessClaims {
  sub: string
  email: string
  role: Role
  name: string
  branchId?: string | null
  sid?: string
}

function authSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET?.trim()
  if (secret && secret.length >= 16) return new TextEncoder().encode(secret)
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    throw new Error('AUTH_SECRET is not set (or too short). Add a 32+ character random value in your environment variables.')
  }
  return new TextEncoder().encode('development-only-secret-do-not-use-in-production')
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('ironhouse-gym')
    .setAudience('ironhouse-app')
    .setExpirationTime(`${ACCESS_TTL_MINUTES}m`)
    .sign(authSecret())
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, authSecret(), {
      issuer: 'ironhouse-gym',
      audience: 'ironhouse-app',
    })
    return {
      sub: String(payload.sub),
      email: String(payload.email ?? ''),
      role: payload.role as Role,
      name: String(payload.name ?? ''),
      branchId: (payload.branchId as string | null) ?? null,
      sid: payload.sid as string | undefined,
    }
  } catch {
    throw new HttpError(401, 'invalid_token', 'Your session has expired. Please sign in again.')
  }
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export function refreshExpiry(from = new Date()): Date {
  return new Date(from.getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000)
}

/* -------------------------------------------------------------------------- */
/* QR gym passes                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A rotating, signed check-in pass. The payload is intentionally tiny:
 * `<memberId>.<issuedAtSeconds>.<signature>`. Because it expires in ~90 seconds it
 * cannot be screenshotted and reused, and no server storage is needed to validate it.
 */
export const QR_PASS_TTL_SECONDS = 90

function qrKey(): string {
  return `${process.env.AUTH_SECRET ?? 'development-only-secret'}:qr`
}

export function signQrPass(memberId: string, now = new Date()): { token: string; expiresAt: string } {
  const issued = Math.floor(now.getTime() / 1000)
  const payload = `${memberId}.${issued}`
  const signature = createHmac('sha256', qrKey()).update(payload).digest('base64url')
  return {
    token: `${payload}.${signature}`,
    expiresAt: new Date((issued + QR_PASS_TTL_SECONDS) * 1000).toISOString(),
  }
}

export function verifyQrPass(token: string, now = new Date()): { memberId: string } {
  const parts = token.split('.')
  if (parts.length !== 3) throw new HttpError(400, 'invalid_pass', 'That QR code is not a valid gym pass')
  const [memberId, issuedRaw, signature] = parts as [string, string, string]
  const expected = createHmac('sha256', qrKey()).update(`${memberId}.${issuedRaw}`).digest('base64url')
  if (!constantTimeEquals(signature, expected)) {
    throw new HttpError(400, 'invalid_pass', 'That QR code signature is invalid')
  }
  const issued = Number(issuedRaw)
  if (!Number.isFinite(issued)) throw new HttpError(400, 'invalid_pass', 'That QR code is malformed')
  const ageSeconds = Math.floor(now.getTime() / 1000) - issued
  if (ageSeconds > QR_PASS_TTL_SECONDS) {
    throw new HttpError(400, 'expired_pass', 'That pass expired. Ask the member to refresh it.')
  }
  if (ageSeconds < -60) throw new HttpError(400, 'invalid_pass', 'Pass is not valid yet')
  return { memberId }
}
