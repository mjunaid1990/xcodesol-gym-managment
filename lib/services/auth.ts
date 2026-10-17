import bcrypt from 'bcryptjs'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import {
  memberProfiles,
  memberships,
  plans,
  users,
  verificationTokens,
  type User,
} from '@/lib/db/schema'
import { HttpError, conflict, notFound, unauthorized, badRequest } from '@/lib/api/http'
import { WAIVER_VERSION } from '@/lib/constants'
import { generateOpaqueToken, hashToken } from '@/lib/auth/tokens'
import {
  assertNotLockedOut,
  issueSession,
  recordLoginAttempt,
  revokeAllSessions,
  type IssuedSession,
  type SessionContext,
} from '@/lib/auth/session'
import { notify } from './notifications'
import { writeAudit } from './audit'

const BCRYPT_ROUNDS = 10

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export interface RegisterInput {
  email: string
  password: string
  firstName: string
  lastName: string
  phone?: string
  branchId?: string
  dateOfBirth?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
  healthNotes?: string
  acceptWaiver?: boolean
  marketingOptIn?: boolean
  role?: 'MEMBER' | 'TRAINER' | 'STAFF' | 'MANAGER' | 'ADMIN'
}

export async function registerUser(
  db: Database,
  input: RegisterInput,
  context: SessionContext = {},
): Promise<{ user: User; session: IssuedSession; verificationToken?: string }> {
  const email = input.email.trim().toLowerCase()

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(input.phone ? or(eq(users.email, email), eq(users.phone, input.phone)) : eq(users.email, email))
    .limit(1)

  if (existing.length) {
    throw conflict('An account already exists with that email or phone number')
  }

  const [user] = await db
    .insert(users)
    .values({
      email,
      phone: input.phone ?? null,
      passwordHash: await hashPassword(input.password),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      role: input.role ?? 'MEMBER',
      branchId: input.branchId ?? null,
    })
    .returning()

  await db.insert(memberProfiles).values({
    userId: user!.id,
    dateOfBirth: input.dateOfBirth ?? null,
    emergencyContactName: input.emergencyContactName ?? null,
    emergencyContactPhone: input.emergencyContactPhone ?? null,
    healthNotes: input.healthNotes ?? null,
    marketingOptIn: input.marketingOptIn ?? true,
    waiverSignedAt: input.acceptWaiver ? new Date() : null,
    waiverVersion: input.acceptWaiver ? WAIVER_VERSION : null,
  })

  // Email verification token (link is emailed; in local dev the API returns it).
  const verificationToken = generateOpaqueToken()
  await db.insert(verificationTokens).values({
    userId: user!.id,
    purpose: 'EMAIL_VERIFY',
    tokenHash: hashToken(verificationToken),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  })

  await notify(db, {
    userId: user!.id,
    type: 'ANNOUNCEMENT',
    title: 'Welcome to Ironhouse',
    body: `Confirm your email to finish setting up your account. Your verification code: ${verificationToken}`,
    channels: ['EMAIL'],
  })

  await writeAudit(db, {
    actorId: user!.id,
    actorEmail: user!.email,
    action: 'auth.register',
    entity: 'user',
    entityId: user!.id,
    branchId: user!.branchId,
    ip: context.ip,
  })

  const session = await issueSession(db, user!, context)
  return { user: user!, session, verificationToken }
}

export interface LoginInput {
  identifier: string
  password: string
}

export async function loginUser(
  db: Database,
  input: LoginInput,
  context: SessionContext = {},
): Promise<{ user: User; session: IssuedSession }> {
  const identifier = input.identifier.trim().toLowerCase()
  await assertNotLockedOut(db, identifier)

  const [user] = await db
    .select()
    .from(users)
    .where(or(eq(users.email, identifier), eq(users.phone, input.identifier.trim())))
    .limit(1)

  const passwordMatches = user ? await bcrypt.compare(input.password, user.passwordHash) : false

  if (!user || !passwordMatches) {
    await recordLoginAttempt(db, { email: identifier, ip: context.ip, success: false })
    throw unauthorized('Email/phone or password is incorrect')
  }

  if (user.status === 'SUSPENDED') {
    throw new HttpError(403, 'account_suspended', 'This account is suspended. Please talk to the front desk.')
  }
  if (user.status === 'INACTIVE') {
    throw new HttpError(403, 'account_inactive', 'This account is not active yet. Please talk to the front desk.')
  }

  await recordLoginAttempt(db, { email: identifier, ip: context.ip, success: true })
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))

  const session = await issueSession(db, user, context)
  await writeAudit(db, {
    actorId: user.id,
    actorEmail: user.email,
    action: 'auth.login',
    entity: 'user',
    entityId: user.id,
    branchId: user.branchId,
    ip: context.ip,
  })

  return { user, session }
}

export async function verifyEmail(db: Database, token: string): Promise<User> {
  const [record] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.tokenHash, hashToken(token)),
        eq(verificationTokens.purpose, 'EMAIL_VERIFY'),
        isNull(verificationTokens.usedAt),
      ),
    )
    .limit(1)

  if (!record || record.expiresAt.getTime() < Date.now()) {
    throw badRequest('That verification link is invalid or has expired')
  }

  await db.update(verificationTokens).set({ usedAt: new Date() }).where(eq(verificationTokens.id, record.id))
  const [user] = await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, record.userId))
    .returning()

  if (!user) throw notFound('Account')
  return user
}

export async function resendVerification(db: Database, email: string): Promise<string | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1)
  if (!user || user.emailVerifiedAt) return undefined

  const token = generateOpaqueToken()
  await db.insert(verificationTokens).values({
    userId: user.id,
    purpose: 'EMAIL_VERIFY',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  })
  await notify(db, {
    userId: user.id,
    type: 'ANNOUNCEMENT',
    title: 'Confirm your email',
    body: `Your verification code: ${token}`,
    channels: ['EMAIL'],
  })
  return token
}

/** Always resolves: we never reveal whether an email exists. */
export async function requestPasswordReset(db: Database, email: string): Promise<string | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1)
  if (!user) return undefined

  const token = generateOpaqueToken()
  await db.insert(verificationTokens).values({
    userId: user.id,
    purpose: 'PASSWORD_RESET',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })

  const link = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/reset-password?token=${token}`
  await notify(db, {
    userId: user.id,
    type: 'ANNOUNCEMENT',
    title: 'Reset your password',
    body: `Use this link within 60 minutes to choose a new password: ${link}`,
    channels: ['EMAIL'],
  })
  await writeAudit(db, {
    actorId: user.id,
    actorEmail: user.email,
    action: 'auth.password_reset_requested',
    entity: 'user',
    entityId: user.id,
  })
  return token
}

export async function resetPassword(db: Database, token: string, newPassword: string): Promise<void> {
  const [record] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.tokenHash, hashToken(token)),
        eq(verificationTokens.purpose, 'PASSWORD_RESET'),
        isNull(verificationTokens.usedAt),
      ),
    )
    .limit(1)

  if (!record || record.expiresAt.getTime() < Date.now()) {
    throw badRequest('That reset link is invalid or has expired')
  }

  await db.update(verificationTokens).set({ usedAt: new Date() }).where(eq(verificationTokens.id, record.id))
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, record.userId))
  // Any stolen session dies with the password change.
  await revokeAllSessions(db, record.userId)
  await writeAudit(db, {
    actorId: record.userId,
    action: 'auth.password_reset',
    entity: 'user',
    entityId: record.userId,
  })
}

export async function changePassword(
  db: Database,
  user: User,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const matches = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!matches) throw unauthorized('Your current password is incorrect')

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, user.id))
  await writeAudit(db, {
    actorId: user.id,
    actorEmail: user.email,
    action: 'auth.password_changed',
    entity: 'user',
    entityId: user.id,
  })
}

export interface ProfileSnapshot {
  user: Omit<User, 'passwordHash'>
  profile: typeof memberProfiles.$inferSelect | null
  membership: {
    status: string
    planName: string
    endsAt: Date
    creditsRemaining: number | null
    autoRenew: boolean
  } | null
}

export async function getProfile(db: Database, userId: string): Promise<ProfileSnapshot> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw notFound('Account')

  const [profile] = await db
    .select()
    .from(memberProfiles)
    .where(eq(memberProfiles.userId, userId))
    .limit(1)

  const [current] = await db
    .select({
      status: memberships.status,
      planName: plans.name,
      endsAt: memberships.endsAt,
      creditsRemaining: memberships.creditsRemaining,
      autoRenew: memberships.autoRenew,
    })
    .from(memberships)
    .innerJoin(plans, eq(plans.id, memberships.planId))
    .where(eq(memberships.memberId, userId))
    .orderBy(desc(memberships.endsAt))
    .limit(1)

  const { passwordHash: _passwordHash, ...safeUser } = user
  return { user: safeUser, profile: profile ?? null, membership: current ?? null }
}

export async function updateProfile(
  db: Database,
  userId: string,
  input: Partial<{
    firstName: string
    lastName: string
    phone: string
    avatarUrl: string
    dateOfBirth: string
    addressLine: string
    city: string
    postalCode: string
    emergencyContactName: string
    emergencyContactPhone: string
    healthNotes: string
    marketingOptIn: boolean
    acceptWaiver: boolean
  }>,
): Promise<ProfileSnapshot> {
  const userFields: Record<string, unknown> = { updatedAt: new Date() }
  if (input.firstName !== undefined) userFields.firstName = input.firstName
  if (input.lastName !== undefined) userFields.lastName = input.lastName
  if (input.phone !== undefined) userFields.phone = input.phone
  if (input.avatarUrl !== undefined) userFields.avatarUrl = input.avatarUrl

  if (Object.keys(userFields).length > 1) {
    await db.update(users).set(userFields).where(eq(users.id, userId))
  }

  const profileFields: Record<string, unknown> = { updatedAt: new Date() }
  for (const key of [
    'dateOfBirth',
    'addressLine',
    'city',
    'postalCode',
    'emergencyContactName',
    'emergencyContactPhone',
    'healthNotes',
    'marketingOptIn',
  ] as const) {
    if (input[key] !== undefined) profileFields[key] = input[key]
  }
  if (input.acceptWaiver) {
    profileFields.waiverSignedAt = new Date()
    profileFields.waiverVersion = WAIVER_VERSION
  }

  const [existingProfile] = await db
    .select({ id: memberProfiles.id })
    .from(memberProfiles)
    .where(eq(memberProfiles.userId, userId))
    .limit(1)

  if (existingProfile) {
    await db.update(memberProfiles).set(profileFields).where(eq(memberProfiles.userId, userId))
  } else {
    await db.insert(memberProfiles).values({ userId, ...profileFields })
  }

  await writeAudit(db, {
    actorId: userId,
    action: 'member.profile_updated',
    entity: 'user',
    entityId: userId,
    meta: { fields: Object.keys(input) },
  })

  return getProfile(db, userId)
}

export async function deleteAccount(db: Database, userId: string, reason?: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw notFound('Account')

  // GDPR-style erasure: anonymise rather than delete, so payment and attendance
  // history stays consistent for accounting while all personal data is removed.
  await db
    .update(users)
    .set({
      status: 'INACTIVE',
      email: `deleted+${userId.slice(0, 8)}@ironhouse.invalid`,
      phone: null,
      firstName: 'Deleted',
      lastName: 'Member',
      avatarUrl: null,
      pushTokens: [],
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))

  await db
    .update(memberProfiles)
    .set({
      emergencyContactName: null,
      emergencyContactPhone: null,
      healthNotes: null,
      addressLine: null,
      postalCode: null,
    })
    .where(eq(memberProfiles.userId, userId))

  await revokeAllSessions(db, userId)
  await writeAudit(db, {
    actorId: userId,
    action: 'member.erased',
    entity: 'user',
    entityId: userId,
    meta: { reason: reason ?? 'member request' },
  })
}

export async function registerDeviceToken(db: Database, userId: string, token: string): Promise<void> {
  const [user] = await db.select({ pushTokens: users.pushTokens }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw notFound('Account')
  const tokens = Array.from(new Set([...(user.pushTokens ?? []), token])).slice(-10)
  await db.update(users).set({ pushTokens: tokens, updatedAt: new Date() }).where(eq(users.id, userId))
}
