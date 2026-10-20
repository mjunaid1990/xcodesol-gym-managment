import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/api/auth-context'
import { failResponse, forbidden, notFound, preflight, unauthorized, withCors } from '@/lib/api/http'
import { getDb } from '@/lib/db/client'
import { can, type Permission } from '@/lib/constants'
import type { ApiContext, ApiHandler, RouteDefinition } from '@/lib/api/context'
import * as authHandlers from '@/lib/api/handlers/auth'
import * as memberHandlers from '@/lib/api/handlers/members'
import * as billingHandlers from '@/lib/api/handlers/billing'
import * as classHandlers from '@/lib/api/handlers/classes'
import * as attendanceHandlers from '@/lib/api/handlers/attendance'
import * as selfHandlers from '@/lib/api/handlers/self'
import * as opsHandlers from '@/lib/api/handlers/ops'
import { ACCESS_COOKIE, ACCESS_TTL_MINUTES, REFRESH_COOKIE, REFRESH_TTL_DAYS } from '@/lib/auth/tokens'

const route = (
  method: RouteDefinition['method'],
  path: string,
  handler: ApiHandler,
  options: Partial<RouteDefinition> = {},
): RouteDefinition => ({ method, path, handler, description: '', ...options })

/**
 * The public API surface. Everything the mobile app and the dashboard use is listed
 * here with the permission it requires, so the contract is readable in one screen.
 * Handlers either return a `{ data }` envelope or a full `Response` (for 201s, CSV
 * downloads and pass-through bodies).
 */
export const API_ROUTES: RouteDefinition[] = [
  // --- auth -----------------------------------------------------------------
  route('POST', 'auth/register', authHandlers.handleRegister, { public: true, description: 'Create a member/trainer account and sign in' }),
  route('POST', 'auth/login', authHandlers.handleLogin, { public: true, description: 'Sign in with email/phone + password' }),
  route('POST', 'auth/refresh', authHandlers.handleRefresh, { public: true, description: 'Rotate the refresh token and mint a new access token' }),
  route('POST', 'auth/logout', authHandlers.handleLogout, { public: true, description: 'Revoke the current session (or all devices)' }),
  route('POST', 'auth/verify-email', authHandlers.handleVerifyEmail, { public: true, description: 'Confirm an email address' }),
  route('POST', 'auth/resend-verification', authHandlers.handleResendVerification, { public: true, description: 'Re-send the verification code' }),
  route('POST', 'auth/forgot-password', authHandlers.handleForgotPassword, { public: true, description: 'Request a password reset link' }),
  route('POST', 'auth/reset-password', authHandlers.handleResetPassword, { public: true, description: 'Set a new password with a reset token' }),
  route('GET', 'auth/me', authHandlers.handleGetMe, { authenticated: true, description: 'Current user profile' }),
  route('PATCH', 'auth/me', authHandlers.handleUpdateMe, { authenticated: true, description: 'Update own profile' }),
  route('DELETE', 'auth/me', authHandlers.handleDeleteMe, { authenticated: true, description: 'GDPR erasure of own account' }),
  route('POST', 'auth/me/password', authHandlers.handleChangePassword, { authenticated: true, description: 'Change own password' }),
  route('GET', 'auth/sessions', authHandlers.handleSessions, { authenticated: true, description: 'List active sessions/devices' }),
  route('DELETE', 'auth/sessions', authHandlers.handleRevokeAllSessions, { authenticated: true, description: 'Sign out everywhere' }),
  route('DELETE', 'auth/sessions/:id', authHandlers.handleRevokeSession, { authenticated: true, description: 'Sign out one device' }),
  route('POST', 'auth/device', authHandlers.handleRegisterDevice, { authenticated: true, description: 'Register an Expo push token' }),

  // --- member mobile app ----------------------------------------------------
  route('GET', 'me/home', selfHandlers.handleMyHome, { authenticated: true, description: 'Membership card, credits, next classes' }),
  route('GET', 'me/sessions', selfHandlers.handleBrowseSessions, { authenticated: true, description: 'Browse the class timetable' }),
  route('GET', 'me/bookings', selfHandlers.handleMyBookings, { authenticated: true, description: 'My bookings' }),
  route('POST', 'me/bookings', selfHandlers.handleMyBookingAction, { authenticated: true, description: 'Book a class (or join the waitlist)' }),
  route('DELETE', 'me/bookings/:id', selfHandlers.handleMyBookingAction, { authenticated: true, description: 'Cancel a booking' }),
  route('GET', 'me/visits', selfHandlers.handleMyVisits, { authenticated: true, description: 'My attendance history' }),
  route('GET', 'me/payments', selfHandlers.handleMyPayments, { authenticated: true, description: 'My invoices and payments' }),
  route('POST', 'me/purchase', selfHandlers.handleMyPurchase, { authenticated: true, description: 'Buy or renew a plan in the app' }),
  route('GET', 'me/notifications', selfHandlers.handleMyNotifications, { authenticated: true, description: 'My notifications' }),
  route('POST', 'me/notifications/:id/read', selfHandlers.handleReadNotification, { authenticated: true, description: 'Mark a notification read' }),
  route('GET', 'me/pass', selfHandlers.handleMyPass, { authenticated: true, description: 'Rotating QR check-in pass (90s)' }),
  route('GET', 'me/today', selfHandlers.handleMyToday, { authenticated: true, description: "Today's sessions and my check-in state" }),

  // --- trainer --------------------------------------------------------------
  route('GET', 'trainer/day', selfHandlers.handleTrainerDay, { permission: 'class:read', description: "Trainer's classes for a day" }),
  route('POST', 'trainer/sessions/:id/check-in', selfHandlers.handleTrainerCheckIn, { permission: 'attendance:write', description: 'Check an attendee into a class' }),

  // --- reference data ------------------------------------------------------
  route('GET', 'branches', opsHandlers.handleListBranches, { permission: 'branch:read', description: 'List branches' }),
  route('POST', 'branches', opsHandlers.handleCreateBranch, { permission: 'branch:write', description: 'Create a branch' }),
  route('GET', 'reference', opsHandlers.handleReferenceData, { permission: 'member:read', description: 'Branches, trainers and rooms for pickers' }),
  route('GET', 'members/search', opsHandlers.handleMembersByIds, { permission: 'member:read', description: 'Look up members by id list' }),

  // --- members -------------------------------------------------------------
  route('GET', 'members', memberHandlers.handleListMembers, { permission: 'member:read', description: 'Search/filter/paginate members' }),
  route('POST', 'members', memberHandlers.handleCreateMember, { permission: 'member:write', description: 'Create a member (optionally selling a plan)' }),
  route('GET', 'members/:id', memberHandlers.handleGetMember, { permission: 'member:read', description: 'Member 360: profile, money, visits, notes' }),
  route('PATCH', 'members/:id', memberHandlers.handleUpdateMember, { permission: 'member:write', description: 'Update member details' }),
  route('DELETE', 'members/:id', memberHandlers.handleArchiveMember, { permission: 'member:delete', description: 'Archive (deactivate) a member' }),
  route('GET', 'members/:id/notes', memberHandlers.handleMemberTimeline, { permission: 'member:read', description: 'Member timeline' }),
  route('POST', 'members/:id/notes', memberHandlers.handleAddMemberNote, { permission: 'member:write', description: 'Add a staff note' }),
  route('DELETE', 'members/:id/notes/:noteId', memberHandlers.handleDeleteMemberNote, { permission: 'member:write', description: 'Delete a staff note' }),
  route('GET', 'members/:id/timeline', memberHandlers.handleMemberTimeline, { permission: 'member:read', description: 'Member activity timeline' }),
  route('POST', 'members/bulk', memberHandlers.handleBulkMembers, { permission: 'member:write', description: 'Bulk activate/deactivate/note/credits' }),
  route('GET', 'members/unassigned', opsHandlers.handleUnassignedMembers, { permission: 'member:read', description: 'Members without a home branch' }),

  // --- plans & discounts ---------------------------------------------------
  route('GET', 'plans', billingHandlers.handleListPlans, { permission: 'plan:read', description: 'List plans and how many members are on each' }),
  route('POST', 'plans', billingHandlers.handleCreatePlan, { permission: 'plan:write', description: 'Create a plan' }),
  route('PATCH', 'plans/:id', billingHandlers.handleUpdatePlan, { permission: 'plan:write', description: 'Update a plan (price, credits, freeze days)' }),
  route('GET', 'discounts', billingHandlers.handleListDiscounts, { permission: 'plan:read', description: 'List discount codes' }),
  route('POST', 'discounts', billingHandlers.handleCreateDiscount, { permission: 'plan:write', description: 'Create a discount code' }),
  route('PATCH', 'discounts/:id', billingHandlers.handleUpdateDiscount, { permission: 'plan:write', description: 'Update or disable a discount code' }),

  // --- memberships ---------------------------------------------------------
  route('GET', 'memberships', billingHandlers.handleListMemberships, { permission: 'membership:read', description: 'List memberships (filter by status/plan/expiry)' }),
  route('POST', 'memberships', billingHandlers.handlePurchaseMembership, { permission: 'membership:write', description: 'Sell a membership and take payment' }),
  route('GET', 'memberships/renewals', billingHandlers.handleUpcomingRenewals, { permission: 'membership:read', description: 'Renewals due in the next 14 days' }),
  route('GET', 'memberships/:id', billingHandlers.handleGetMembership, { permission: 'membership:read', description: 'Membership detail with events' }),
  route('POST', 'memberships/:id/actions', billingHandlers.handleMembershipAction, { permission: 'membership:write', description: 'renew | freeze | unfreeze | cancel | change-plan' }),

  // --- money ---------------------------------------------------------------
  route('GET', 'payments', billingHandlers.handleListPayments, { permission: 'payment:read', description: 'Payment ledger with totals' }),
  route('GET', 'payments/:id', billingHandlers.handleGetPayment, { permission: 'payment:read', description: 'Single payment with refunds' }),
  route('POST', 'payments/:id/refund', billingHandlers.handleRefundPayment, { permission: 'payment:refund', description: 'Refund full or part of a payment' }),
  route('POST', 'payments/:id/retry', billingHandlers.handleRetryPayment, { permission: 'payment:write', description: 'Retry a failed payment' }),
  route('GET', 'invoices', billingHandlers.handleListInvoices, { permission: 'invoice:read', description: 'Invoices with outstanding totals' }),
  route('GET', 'invoices/:id', billingHandlers.handleGetInvoice, { permission: 'invoice:read', description: 'Invoice detail' }),
  route('POST', 'invoices/:id/mark-paid', billingHandlers.handleMarkInvoicePaid, { permission: 'payment:write', description: 'Settle an invoice at the desk (cash/terminal)' }),
  route('POST', 'invoices/:id/void', billingHandlers.handleVoidInvoice, { permission: 'payment:refund', description: 'Void an invoice' }),

  // --- classes -------------------------------------------------------------
  route('GET', 'classes', classHandlers.handleListSessions, { permission: 'class:read', description: 'Sessions in a date range with fill counts' }),
  route('POST', 'classes', classHandlers.handleCreateSession, { permission: 'class:write', description: 'Create a one-off class (checked for clashes)' }),
  route('GET', 'classes/templates', classHandlers.handleListTemplates, { permission: 'class:read', description: 'Recurring class templates' }),
  route('POST', 'classes/templates', classHandlers.handleCreateTemplate, { permission: 'class:write', description: 'Create a recurring class and generate sessions' }),
  route('PATCH', 'classes/templates/:id', classHandlers.handleUpdateTemplate, { permission: 'class:write', description: 'Update a recurring class' }),
  route('DELETE', 'classes/templates/:id', classHandlers.handleDeleteTemplate, { permission: 'class:write', description: 'Retire a recurring class' }),
  route('GET', 'classes/:id', classHandlers.handleGetSession, { permission: 'class:read', description: 'Session with full roster' }),
  route('PATCH', 'classes/:id', classHandlers.handleUpdateSession, { permission: 'class:write', description: 'Update a session' }),
  route('POST', 'classes/:id/cancel', classHandlers.handleCancelSession, { permission: 'class:write', description: 'Cancel a class and release bookings' }),
  route('POST', 'classes/:id/check-in', classHandlers.handleSessionCheckIn, { permission: 'attendance:write', description: 'Check a booked member into the class' }),

  // --- bookings ------------------------------------------------------------
  route('GET', 'bookings', classHandlers.handleListBookings, { permission: 'booking:read', description: 'Booking list (member/session/date filters)' }),
  route('POST', 'bookings', classHandlers.handleCreateBooking, { permission: 'booking:write', description: 'Book a member into a class' }),
  route('PATCH', 'bookings/:id', classHandlers.handleRosterAction, { permission: 'booking:write', description: 'Mark attended / no-show' }),
  route('DELETE', 'bookings/:id', classHandlers.handleCancelBooking, { permission: 'booking:write', description: 'Cancel a booking (penalty aware)' }),

  // --- attendance ----------------------------------------------------------
  route('GET', 'attendance', attendanceHandlers.handleListVisits, { permission: 'attendance:read', description: 'Visit log with filters' }),
  route('POST', 'attendance/check-in', attendanceHandlers.handleCheckIn, { permission: 'attendance:write', description: 'Check in by QR, member id, name or self' }),
  route('GET', 'attendance/floor', attendanceHandlers.handleFloor, { permission: 'attendance:read', description: 'Live floor: visits today, next classes' }),
  route('POST', 'attendance/pass', attendanceHandlers.handleGeneratePass, { authenticated: true, description: 'Generate your own QR pass' }),

  // --- reporting -----------------------------------------------------------
  route('GET', 'reports/dashboard', opsHandlers.handleDashboard, { permission: 'report:read', description: 'Dashboard payload (metrics + series)' }),
  route('GET', 'reports', opsHandlers.handleReports, { permission: 'report:read', description: 'Report by type: overview|utilisation|trainers|outstanding|cohorts|peak-hours|mix' }),
  route('GET', 'reports/export', opsHandlers.handleExport, { permission: 'report:read', description: 'Row data for CSV export' }),

  // --- staff & payroll -----------------------------------------------------
  route('GET', 'staff', opsHandlers.handleListStaff, { permission: 'staff:read', description: 'Staff and trainer directory' }),
  route('POST', 'staff', opsHandlers.handleCreateStaff, { permission: 'staff:write', description: 'Create a staff/trainer account' }),
  route('PATCH', 'staff/:id', opsHandlers.handleUpdateStaff, { permission: 'staff:write', description: 'Update role, branch, pay rate or status' }),
  route('GET', 'staff/:id/schedule', opsHandlers.handleStaffSchedule, { permission: 'staff:read', description: 'Scheduled classes for a trainer' }),
  route('GET', 'payroll', opsHandlers.handlePayroll, { permission: 'report:read', description: 'Hours and gross pay from the schedule' }),

  // --- communications ------------------------------------------------------
  route('GET', 'announcements', opsHandlers.handleListAnnouncements, { permission: 'announcement:read', description: 'Announcement history' }),
  route('POST', 'announcements', opsHandlers.handleCreateAnnouncement, { permission: 'announcement:write', description: 'Draft an announcement' }),
  route('PATCH', 'announcements/:id', opsHandlers.handleUpdateAnnouncement, { permission: 'announcement:write', description: 'Edit a draft' }),
  route('POST', 'announcements/:id/send', opsHandlers.handleSendAnnouncement, { permission: 'announcement:write', description: 'Send to the audience (push/email/SMS)' }),
  route('GET', 'announcements/:id/stats', opsHandlers.handleAnnouncementStats, { permission: 'announcement:read', description: 'Delivery stats' }),

  // --- governance ----------------------------------------------------------
  route('GET', 'audit', opsHandlers.handleListAudit, { permission: 'audit:read', description: 'Audit trail' }),
  route('GET', 'settings', opsHandlers.handleGetSettings, { permission: 'setting:read', description: 'Settings and integration status' }),
  route('PATCH', 'settings', opsHandlers.handleUpdateSettings, { permission: 'setting:write', description: 'Update a settings section' }),
  route('GET', 'settings/system', opsHandlers.handleSystemInfo, { permission: 'setting:read', description: 'Runtime and database info' }),
]

function matchPath(pattern: string, segments: string[]): Record<string, string> | null {
  const patternSegments = pattern.split('/')
  if (patternSegments.length !== segments.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < patternSegments.length; i++) {
    const patternSegment = patternSegments[i]!
    const actual = segments[i]!
    if (patternSegment.startsWith(':')) {
      params[patternSegment.slice(1)] = actual
      continue
    }
    if (patternSegment !== actual) return null
  }
  return params
}

function isEnvelope(value: unknown): value is { data: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'data' in value && Object.keys(value).length <= 2
}

const COOKIE_SESSION_ROUTES = new Set(['auth/login', 'auth/register'])
const SESSION_COOKIE_ROUTES = new Set(['auth/refresh'])
const CLEAR_COOKIE_ROUTES = new Set(['auth/logout'])

/** Entry point used by the catch-all route handler under /api/v1. */
export async function handleApiRequest(request: Request, segments: string[]): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight()

  const path = segments.join('/')
  const method = request.method as RouteDefinition['method']
  const routeDef = API_ROUTES.find((candidate) => candidate.method === method && matchPath(candidate.path, segments))
  const params = routeDef ? matchPath(routeDef.path, segments) ?? {} : {}

  if (!routeDef) {
    const known = API_ROUTES.some((candidate) => candidate.method === method && candidate.path === path)
    return withCors(
      failResponse(notFound(known ? 'Route' : `${method} /api/v1/${path}`)),
    )
  }

  try {
    // Auth is resolved for every route: `auth === null` means anonymous, which is only
    // acceptable for public endpoints (login, register, password reset).
    const auth = await getAuthContext(request).catch(() => null)

    if (!routeDef.public && !auth) {
      return withCors(failResponse(unauthorized('Sign in to continue')))
    }

    if (routeDef.permission && auth) {
      if (!can(auth.user.role as never, routeDef.permission as Permission)) {
        return withCors(failResponse(forbidden(`Your role cannot perform ${routeDef.permission}`)))
      }
    }
    if (routeDef.anyPermission && auth) {
      const allowed = routeDef.anyPermission.some((permission) => can(auth.user.role as never, permission))
      if (!allowed) return withCors(failResponse(forbidden()))
    }

    const ctx: ApiContext = {
      request,
      db: auth?.db ?? (await getDb()),
      user: auth?.user ?? null,
      params,
      query: new URL(request.url).searchParams,
      url: new URL(request.url),
    }

    const result = await routeDef.handler(ctx)

    if (result instanceof Response) {
      const response = result
      if (COOKIE_SESSION_ROUTES.has(routeDef.path) || SESSION_COOKIE_ROUTES.has(routeDef.path)) {
        await attachCookies(response, result)
      } else if (CLEAR_COOKIE_ROUTES.has(routeDef.path)) {
        clearAuthCookies(response)
      }
      return withCors(response)
    }

    const response = NextResponse.json(isEnvelope(result) ? result : { data: result })
    if (COOKIE_SESSION_ROUTES.has(routeDef.path) || SESSION_COOKIE_ROUTES.has(routeDef.path)) {
      await attachCookies(response, result)
    } else if (CLEAR_COOKIE_ROUTES.has(routeDef.path)) {
      clearAuthCookies(response)
    }
    return withCors(response)
  } catch (error) {
    return withCors(failResponse(error))
  }
}

function clearAuthCookies(response: Response): void {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)
  const nextResponse = response as NextResponse
  nextResponse.cookies?.set(ACCESS_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  })
  nextResponse.cookies?.set(REFRESH_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/api/v1/auth',
    maxAge: 0,
    expires: new Date(0),
  })
  nextResponse.cookies?.set(REFRESH_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  })
}

async function attachCookies(response: Response, payload: unknown): Promise<void> {
  const data = isEnvelope(payload) ? (payload.data as Record<string, unknown>) : (payload as Record<string, unknown>)
  const accessToken = data?.accessToken
  const refreshToken = data?.refreshToken
  if (typeof accessToken !== 'string') return

  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)
  const nextResponse = response as NextResponse
  nextResponse.cookies?.set(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: ACCESS_TTL_MINUTES * 60,
  })
  if (typeof refreshToken === 'string') {
    nextResponse.cookies?.set(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/api/v1/auth',
      maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60,
    })
  }
}

export function routeIndex() {
  return API_ROUTES.map(({ method, path, permission, authenticated, public: isPublic, description }) => ({
    method,
    path: `/api/v1/${path}`,
    permission: permission ?? null,
    authenticated: Boolean(authenticated),
    public: Boolean(isPublic),
    description,
  }))
}
