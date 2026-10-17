import { signAccessToken as sign } from '@/lib/auth/tokens'
import { ACCESS_COOKIE } from '@/lib/auth/tokens'
import type { User } from '@/lib/db/schema'

/** Signs a real access token for a fixture user (same code path as the app). */
export async function signAccessToken(user: Pick<User, 'id' | 'email' | 'role' | 'firstName' | 'lastName' | 'branchId'>) {
  return sign({
    sub: user.id,
    email: user.email,
    role: user.role as never,
    name: `${user.firstName} ${user.lastName}`,
    branchId: user.branchId,
  })
}

export function sessionCookieHeader(token: string): string {
  return `${ACCESS_COOKIE}=${encodeURIComponent(token)}`
}
