import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { can, type Permission, type Role } from '@/lib/constants'
import { loadActiveUser } from './session'
import { ACCESS_COOKIE, REFRESH_COOKIE, verifyAccessToken } from './tokens'
import type { User } from '@/lib/db/schema'

/** Reads the current user for server components. Returns null when signed out. */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies()
  const token = store.get(ACCESS_COOKIE)?.value
  if (!token) return null
  try {
    const claims = await verifyAccessToken(token)
    const db = await getDb()
    return await loadActiveUser(db, claims.sub)
  } catch {
    // Access token expired: an API call will refresh it, the page just renders signed-out.
    return null
  }
}

/** Middleware-level hint: is there any session cookie at all? */
export async function hasSessionCookie(): Promise<boolean> {
  const store = await cookies()
  return Boolean(store.get(ACCESS_COOKIE)?.value || store.get(REFRESH_COOKIE)?.value)
}

/**
 * Guard for the admin dashboard. Members are redirected to the mobile-app landing page
 * rather than shown a dashboard full of 403s.
 */
export async function requireStaffUser(permission?: Permission): Promise<User> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role === 'MEMBER') redirect('/no-access')
  if (permission && !can(user.role as Role, permission)) redirect('/no-access')
  return user
}
