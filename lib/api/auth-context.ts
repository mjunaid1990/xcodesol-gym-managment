import type { Database } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { forbidden, unauthorized } from '@/lib/api/http'
import { can, type Permission, type Role } from '@/lib/constants'
import { loadActiveUser } from '@/lib/auth/session'
import { ACCESS_COOKIE, verifyAccessToken } from '@/lib/auth/tokens'
import type { User } from '@/lib/db/schema'

export interface AuthContext {
  db: Database
  user: User
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

/**
 * Web uses httpOnly cookies, mobile uses `Authorization: Bearer <access token>`.
 * Both are verified the same way, and the user row is re-read so role/status changes
 * take effect immediately rather than when the token expires.
 */
export async function getAuthContext(request: Request): Promise<AuthContext | null> {
  const header = request.headers.get('authorization')
  const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined
  const token = bearer ?? cookieValue(request, ACCESS_COOKIE)
  if (!token) return null

  try {
    const claims = await verifyAccessToken(token)
    const db = await getDb()
    const user = await loadActiveUser(db, claims.sub)
    return { db, user }
  } catch {
    return null
  }
}

export async function requireAuth(request: Request): Promise<AuthContext> {
  const context = await getAuthContext(request)
  if (!context) throw unauthorized()
  return context
}

export async function requirePermission(request: Request, permission: Permission): Promise<AuthContext> {
  const context = await requireAuth(request)
  if (!can(context.user.role as Role, permission)) {
    throw forbidden(`Your role (${context.user.role}) cannot perform ${permission}`)
  }
  return context
}

/** Requires ANY of the listed permissions (used by pages that span two domains). */
export async function requireAnyPermission(
  request: Request,
  permissions: Permission[],
): Promise<AuthContext> {
  const context = await requireAuth(request)
  const allowed = permissions.some((permission) => can(context.user.role as Role, permission))
  if (!allowed) throw forbidden()
  return context
}

export function isPrivileged(role: string): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'STAFF'
}

/** Members/trainers may only ever act on their own records. */
export function assertSelfOrPermission(user: User, ownerId: string, permission: Permission): void {
  if (user.id === ownerId) return
  if (can(user.role as Role, permission)) return
  throw forbidden('You can only access your own records')
}
