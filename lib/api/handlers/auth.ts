import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { created, readJson, unauthorized, HttpError } from '@/lib/api/http'
import { assertSelfOrPermission } from '@/lib/api/auth-context'
import {
  changePassword,
  deleteAccount,
  getProfile,
  loginUser,
  registerDeviceToken,
  registerUser,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  updateProfile,
  verifyEmail,
} from '@/lib/services/auth'
import { listSessions, revokeAllSessions, revokeSessionById } from '@/lib/auth/session'
import { users } from '@/lib/db/schema'
import { emailSchema, passwordSchema, phoneSchema } from '@/lib/api/schemas'
import type { ApiContext } from '@/lib/api/context'

export const authRouteSchemas = {
  register: z.object({
    email: emailSchema,
    password: passwordSchema,
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    phone: phoneSchema.optional(),
    branchId: z.string().uuid().optional(),
    dateOfBirth: z.string().optional(),
    emergencyContactName: z.string().max(120).optional(),
    emergencyContactPhone: z.string().max(40).optional(),
    healthNotes: z.string().max(2000).optional(),
    acceptWaiver: z.boolean().optional(),
    marketingOptIn: z.boolean().optional(),
  }),
  login: z.object({ identifier: z.string().min(3), password: z.string().min(1) }),
  verify: z.object({ token: z.string().min(10) }),
  forgot: z.object({ email: emailSchema }),
  reset: z.object({ token: z.string().min(10), password: passwordSchema }),
  changePassword: z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
  device: z.object({ token: z.string().min(3), platform: z.enum(['ios', 'android', 'web']).optional() }),
  updateMe: z.object({
    firstName: z.string().min(1).max(80).optional(),
    lastName: z.string().min(1).max(80).optional(),
    phone: phoneSchema.optional(),
    avatarUrl: z.string().url().optional(),
    dateOfBirth: z.string().optional(),
    addressLine: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    postalCode: z.string().max(20).optional(),
    emergencyContactName: z.string().max(120).optional(),
    emergencyContactPhone: z.string().max(40).optional(),
    healthNotes: z.string().max(2000).optional(),
    marketingOptIn: z.boolean().optional(),
    acceptWaiver: z.boolean().optional(),
  }),
} satisfies Record<string, z.ZodTypeAny>

function requireUser(ctx: ApiContext) {
  if (!ctx.user) throw unauthorized()
  return ctx.user
}

export async function handleRegister(ctx: ApiContext) {
  const body = await readJson(ctx.request, authRouteSchemas.register)
  const result = await registerUser(ctx.db, body, {
    ip: ctx.request.headers.get('x-forwarded-for') ?? null,
    userAgent: ctx.request.headers.get('user-agent'),
  })
  return created({
    user: publicUser(result.user),
    accessToken: result.session.accessToken,
    refreshToken: result.session.refreshToken,
    // Exposed only outside production so the flow is testable without an inbox.
    verificationToken: process.env.NODE_ENV === 'production' ? undefined : result.verificationToken,
  })
}

export async function handleLogin(ctx: ApiContext) {
  const body = await readJson(ctx.request, authRouteSchemas.login)
  const result = await loginUser(ctx.db, body, {
    ip: ctx.request.headers.get('x-forwarded-for') ?? null,
    userAgent: ctx.request.headers.get('user-agent'),
  })
  return {
    data: {
      user: publicUser(result.user),
      accessToken: result.session.accessToken,
      refreshToken: result.session.refreshToken,
      sessionId: result.session.sessionId,
    },
  }
}

export async function handleCurrentSession(ctx: ApiContext) {
  const user = requireUser(ctx)
  const profile = await getProfile(ctx.db, user.id)
  return { data: profile }
}

export async function handleRefresh(ctx: ApiContext) {
  const body = (await ctx.request.json().catch(() => ({}))) as { refreshToken?: string }
  const token = body.refreshToken ?? cookieRefresh(ctx)
  if (!token) throw unauthorized('No refresh token supplied')

  const { rotateSession } = await import('@/lib/auth/session')
  const result = await rotateSession(ctx.db, token, {
    ip: ctx.request.headers.get('x-forwarded-for') ?? null,
    userAgent: ctx.request.headers.get('user-agent'),
  })
  return {
    data: {
      user: publicUser(result.user),
      accessToken: result.session.accessToken,
      refreshToken: result.session.refreshToken,
    },
  }
}

export async function handleLogout(ctx: ApiContext) {
  const body = (await ctx.request.json().catch(() => ({}))) as { refreshToken?: string; allDevices?: boolean }
  const token = body.refreshToken ?? cookieRefresh(ctx)

  if (body.allDevices && ctx.user) {
    const revoked = await revokeAllSessions(ctx.db, ctx.user.id)
    return { data: { revoked } }
  }
  if (token) {
    const { revokeSessionByToken } = await import('@/lib/auth/session')
    await revokeSessionByToken(ctx.db, token)
  }
  return { data: { revoked: 1 } }
}

export async function handleVerifyEmail(ctx: ApiContext) {
  const body = await readJson(ctx.request, authRouteSchemas.verify)
  const user = await verifyEmail(ctx.db, body.token)
  return { data: { email: user.email, verifiedAt: user.emailVerifiedAt } }
}

export async function handleResendVerification(ctx: ApiContext) {
  const body = await readJson(ctx.request, authRouteSchemas.forgot)
  const token = await resendVerification(ctx.db, body.email)
  return { data: { sent: true, verificationToken: process.env.NODE_ENV === 'production' ? undefined : token } }
}

export async function handleForgotPassword(ctx: ApiContext) {
  const body = await readJson(ctx.request, authRouteSchemas.forgot)
  const token = await requestPasswordReset(ctx.db, body.email)
  // Always the same answer: no account enumeration.
  return { data: { sent: true, resetToken: process.env.NODE_ENV === 'production' ? undefined : token } }
}

export async function handleResetPassword(ctx: ApiContext) {
  const body = await readJson(ctx.request, authRouteSchemas.reset)
  await resetPassword(ctx.db, body.token, body.password)
  return { data: { reset: true } }
}

export async function handleChangePassword(ctx: ApiContext) {
  const user = requireUser(ctx)
  const body = await readJson(ctx.request, authRouteSchemas.changePassword)
  await changePassword(ctx.db, user, body.currentPassword, body.newPassword)
  return { data: { changed: true } }
}

export async function handleSessions(ctx: ApiContext) {
  const user = requireUser(ctx)
  return { data: await listSessions(ctx.db, user.id) }
}

export async function handleRevokeSession(ctx: ApiContext) {
  const user = requireUser(ctx)
  const id = ctx.params.id!
  assertSelfOrPermission(user, user.id, 'member:write')
  await revokeSessionById(ctx.db, user.id, id)
  return { data: { revoked: id } }
}

export async function handleRevokeAllSessions(ctx: ApiContext) {
  const user = requireUser(ctx)
  const revoked = await revokeAllSessions(ctx.db, user.id)
  return { data: { revoked } }
}

export async function handleRegisterDevice(ctx: ApiContext) {
  const user = requireUser(ctx)
  const body = await readJson(ctx.request, authRouteSchemas.device)
  await registerDeviceToken(ctx.db, user.id, body.token)
  return { data: { registered: true } }
}

export async function handleGetMe(ctx: ApiContext) {
  const user = requireUser(ctx)
  return { data: await getProfile(ctx.db, user.id) }
}

export async function handleUpdateMe(ctx: ApiContext) {
  const user = requireUser(ctx)
  const body = await readJson(ctx.request, authRouteSchemas.updateMe)
  return { data: await updateProfile(ctx.db, user.id, body) }
}

export async function handleDeleteMe(ctx: ApiContext) {
  const user = requireUser(ctx)
  const body = (await ctx.request.json().catch(() => ({}))) as { reason?: string }
  await deleteAccount(ctx.db, user.id, body.reason)
  return { data: { erased: true } }
}

export async function handleLookupMembersByEmail(ctx: ApiContext) {
  const email = ctx.query.get('email')
  if (!email) throw new HttpError(400, 'bad_request', 'email is required')
  const [row] = await ctx.db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1)
  return { data: row ? publicUser(row) : null }
}

function cookieRefresh(ctx: ApiContext): string | undefined {
  const header = ctx.request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === 'ih_refresh') return decodeURIComponent(rest.join('='))
  }
  return undefined
}

function publicUser(user: {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  status: string
  branchId: string | null
  avatarUrl?: string | null
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    branchId: user.branchId,
    avatarUrl: user.avatarUrl ?? null,
  }
}
