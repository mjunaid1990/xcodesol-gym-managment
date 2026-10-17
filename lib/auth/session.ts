import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { loginAttempts, sessions, users, type User } from '@/lib/db/schema'
import { HttpError, tooManyRequests, unauthorized } from '@/lib/api/http'
import type { Role } from '@/lib/constants'
import { generateOpaqueToken, hashToken, refreshExpiry, signAccessToken } from './tokens'

export interface SessionContext {
  userAgent?: string | null
  ip?: string | null
}

export interface IssuedSession {
  accessToken: string
  refreshToken: string
  refreshExpiresAt: Date
  sessionId: string
}

export async function issueSession(
  db: Database,
  user: Pick<User, 'id' | 'email' | 'role' | 'firstName' | 'lastName' | 'branchId'>,
  context: SessionContext = {},
): Promise<IssuedSession> {
  const refreshToken = generateOpaqueToken()
  const expiresAt = refreshExpiry()

  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      userAgent: context.userAgent ?? null,
      ip: context.ip ?? null,
      expiresAt,
    })
    .returning()

  const accessToken = await signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role as Role,
    name: `${user.firstName} ${user.lastName}`,
    branchId: user.branchId,
    sid: session!.id,
  })

  return { accessToken, refreshToken, refreshExpiresAt: expiresAt, sessionId: session!.id }
}

export async function rotateSession(
  db: Database,
  refreshToken: string,
  context: SessionContext = {},
): Promise<{ session: IssuedSession; user: User }> {
  const [existing] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(refreshToken)))
    .limit(1)

  if (!existing || existing.revokedAt || existing.expiresAt.getTime() < Date.now()) {
    throw unauthorized('Your session has expired. Please sign in again.')
  }

  const [user] = await db.select().from(users).where(eq(users.id, existing.userId)).limit(1)
  if (!user) throw unauthorized()
  if (user.status !== 'ACTIVE') {
    throw new HttpError(403, 'account_inactive', 'This account is not active. Contact the front desk.')
  }

  // Rotation: the presented token is single-use.
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, existing.id))

  const session = await issueSession(db, user, context)
  return { session, user }
}

export async function revokeSessionByToken(db: Database, refreshToken: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(refreshToken)), isNull(sessions.revokedAt)))
}

export async function revokeAllSessions(db: Database, userId: string): Promise<number> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning()
  return revoked.length
}

export async function revokeSessionById(db: Database, userId: string, sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
}

export async function listSessions(db: Database, userId: string) {
  return db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ip: sessions.ip,
      createdAt: sessions.createdAt,
      lastActiveAt: sessions.lastActiveAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastActiveAt))
    .limit(25)
}

/** Load the freshest user row behind an access token, so role/status changes apply at once. */
export async function loadActiveUser(db: Database, userId: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw unauthorized()
  if (user.status !== 'ACTIVE') {
    throw new HttpError(403, 'account_inactive', 'This account is not active. Contact the front desk.')
  }
  return user
}

/* -------------------------------------------------------------------------- */
/* Brute-force protection (DB backed: no sticky sessions required on Vercel)   */
/* -------------------------------------------------------------------------- */

const MAX_FAILED_ATTEMPTS = 8
const LOCKOUT_MINUTES = 15

export async function assertNotLockedOut(db: Database, email: string): Promise<void> {
  const since = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000)
  const [row] = await db
    .select({ failures: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, email.toLowerCase()),
        eq(loginAttempts.success, false),
        gt(loginAttempts.createdAt, since),
      ),
    )

  if ((row?.failures ?? 0) >= MAX_FAILED_ATTEMPTS) {
    throw tooManyRequests(
      `Too many failed sign-in attempts. Try again in ${LOCKOUT_MINUTES} minutes or reset your password.`,
    )
  }
}

export async function recordLoginAttempt(
  db: Database,
  input: { email: string; ip?: string | null; success: boolean },
): Promise<void> {
  await db.insert(loginAttempts).values({
    email: input.email.toLowerCase(),
    ip: input.ip ?? null,
    success: input.success,
  })
}
