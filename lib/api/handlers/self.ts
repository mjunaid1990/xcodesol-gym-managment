import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { created, notFound, readJson, readQuery } from '@/lib/api/http'
import { z } from 'zod'
import { attendance, bookings, classSessions, invoices, memberships, notifications, payments, plans, users } from '@/lib/db/schema'
import { listSessions, todaysSessions, trainerSchedule, upcomingForMember } from '@/lib/services/scheduling'
import { getEntitlement, purchaseMembership } from '@/lib/services/memberships'
import { bookSession, cancelBooking, listBookings, memberBookingStats } from '@/lib/services/bookings'
import { listVisits } from '@/lib/services/attendance'
import { markRead, unreadCount } from '@/lib/services/notifications'
import { checkInSchema, membershipPurchaseSchema } from '@/lib/api/schemas'
import type { ApiContext } from '@/lib/api/context'
import { actorOf } from './members'

/* --------------------------------- member --------------------------------- */

export async function handleMyHome(ctx: ApiContext) {
  const memberId = ctx.user!.id
  const entitlement = await getEntitlement(ctx.db, memberId)
  const [upcoming, stats, unread, recentVisits] = await Promise.all([
    upcomingForMember(ctx.db, memberId, 5),
    memberBookingStats(ctx.db, memberId, new Date(Date.now() - 30 * 86_400_000)),
    unreadCount(ctx.db, memberId),
    listVisits(ctx.db, { memberId, limit: 5 }),
  ])

  const [plan] = entitlement.membership
    ? await ctx.db
        .select({ name: plans.name, type: plans.type, interval: plans.interval, priceCents: plans.priceCents })
        .from(plans)
        .where(eq(plans.id, entitlement.membership.planId))
        .limit(1)
    : [null]

  return {
    data: {
      entitlement: {
        allowed: entitlement.allowed,
        reason: entitlement.reason,
        creditsRemaining: entitlement.creditsRemaining ?? null,
        status: entitlement.membership?.status ?? null,
        endsAt: entitlement.membership?.endsAt ?? null,
        autoRenew: entitlement.membership?.autoRenew ?? false,
        frozenUntil: entitlement.membership?.freezeEndsAt ?? null,
      },
      plan: plan ?? null,
      upcoming,
      stats,
      unreadNotifications: unread,
      recentVisits: recentVisits.rows,
    },
  }
}

export async function handleBrowseSessions(ctx: ApiContext) {
  const from = ctx.query.get('from') ? new Date(ctx.query.get('from')!) : new Date()
  const to = ctx.query.get('to') ? new Date(ctx.query.get('to')!) : new Date(Date.now() + 14 * 86_400_000)
  const memberId = ctx.user!.id

  const rows = await listSessions(ctx.db, {
    from,
    to: new Date(Math.max(to.getTime(), Date.now())),
    branchId: ctx.query.get('branchId') ?? undefined,
    title: ctx.query.get('q') ?? undefined,
    limit: 200,
  })

  const myBookings = await ctx.db
    .select({ sessionId: bookings.sessionId, status: bookings.status, id: bookings.id, waitlistPosition: bookings.waitlistPosition })
    .from(bookings)
    .where(and(eq(bookings.memberId, memberId), inArray(bookings.status, ['BOOKED', 'WAITLISTED'])))

  const bySession = new Map(myBookings.map((row) => [row.sessionId, row]))

  return {
    data: rows.map((row) => ({
      ...row,
      myBooking: bySession.get(row.id) ?? null,
      spotsLeft: Math.max(0, row.capacity - row.bookedCount),
    })),
  }
}

export async function handleMyBookings(ctx: ApiContext) {
  const rows = await listBookings(ctx.db, { memberId: ctx.user!.id, limit: 100 })
  return { data: rows }
}

const myBookingSchema = z.object({
  action: z.enum(['book', 'cancel']).optional(),
  sessionId: z.string().uuid().optional(),
  reason: z.string().max(300).optional(),
})

/**
 * One endpoint for the app's two booking gestures:
 *   POST   /me/bookings { sessionId }  -> book (or join the waitlist)
 *   DELETE /me/bookings/:id            -> cancel
 */
export async function handleMyBookingAction(ctx: ApiContext) {
  const raw = await ctx.request.json().catch(() => ({}))
  const body = myBookingSchema.parse(raw)
  const bookingId = ctx.params.id

  if (bookingId || body.action === 'cancel') {
    if (!bookingId) throw notFound('Booking')
    const [booking] = await ctx.db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1)
    if (!booking || booking.memberId !== ctx.user!.id) throw notFound('Booking')
    const result = await cancelBooking(ctx.db, bookingId, { reason: body.reason ?? 'Cancelled in app', actor: actorOf(ctx) })
    return { data: result }
  }

  if (!body.sessionId) throw notFound('Session')
  const result = await bookSession(ctx.db, { memberId: ctx.user!.id, sessionId: body.sessionId, actor: actorOf(ctx) })
  return created(result)
}

export async function handleMyVisits(ctx: ApiContext) {
  const page = Number(ctx.query.get('page') ?? 1)
  return { data: await listVisits(ctx.db, { memberId: ctx.user!.id, page }) }
}

export async function handleMyPayments(ctx: ApiContext) {
  const memberId = ctx.user!.id
  const [paymentRows, invoiceRows, membershipRows] = await Promise.all([
    ctx.db
      .select({
        id: payments.id,
        amountCents: payments.amountCents,
        refundedCents: payments.refundedCents,
        currency: payments.currency,
        status: payments.status,
        method: payments.method,
        provider: payments.provider,
        createdAt: payments.createdAt,
        paidAt: payments.paidAt,
        invoiceNumber: invoices.number,
        description: invoices.description,
      })
      .from(payments)
      .leftJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(eq(payments.memberId, memberId))
      .orderBy(desc(payments.createdAt))
      .limit(50),
    ctx.db.select().from(invoices).where(eq(invoices.memberId, memberId)).orderBy(desc(invoices.issuedAt)).limit(50),
    ctx.db
      .select({ id: memberships.id, status: memberships.status, endsAt: memberships.endsAt, planName: plans.name, priceCents: payments.amountCents })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .leftJoin(payments, eq(payments.membershipId, memberships.id))
      .where(eq(memberships.memberId, memberId))
      .orderBy(desc(memberships.endsAt))
      .limit(10),
  ])

  const [totals] = await ctx.db
    .select({
      lifetimeCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`,
      refundedCents: sql<number>`coalesce(sum(${payments.refundedCents}), 0)::int`,
      failedCount: sql<number>`count(*) filter (where ${payments.status} = 'FAILED')::int`,
    })
    .from(payments)
    .where(eq(payments.memberId, memberId))

  return { data: { payments: paymentRows, invoices: invoiceRows, memberships: membershipRows, totals } }
}

export async function handleMyPurchase(ctx: ApiContext) {
  const body = await readJson(
    ctx.request,
    membershipPurchaseSchema.omit({ memberId: true, skipPayment: true }),
  )
  const result = await purchaseMembership(ctx.db, {
    memberId: ctx.user!.id,
    planId: body.planId,
    discountCode: body.discountCode,
    autoRenew: body.autoRenew,
    actor: actorOf(ctx),
  })
  return created({
    membership: result.membership,
    invoice: result.invoice,
    clientSecret: result.clientSecret,
    totalCents: result.totalCents,
  })
}

export async function handleMyNotifications(ctx: ApiContext) {
  const rows = await ctx.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, ctx.user!.id))
    .orderBy(desc(notifications.createdAt))
    .limit(50)
  return { data: { rows, unread: await unreadCount(ctx.db, ctx.user!.id) } }
}

export async function handleReadNotification(ctx: ApiContext) {
  await markRead(ctx.db, ctx.user!.id, ctx.params.id!)
  return { data: { read: true } }
}

/* --------------------------------- trainer -------------------------------- */

export async function handleTrainerDay(ctx: ApiContext) {
  const now = new Date()
  const from = ctx.query.get('date') ? new Date(ctx.query.get('date')!) : new Date(now.setUTCHours(0, 0, 0, 0))
  const to = new Date(from.getTime() + 86_400_000)

  const [sessions, stats] = await Promise.all([
    trainerSchedule(ctx.db, ctx.user!.id, from, to),
    ctx.db
      .select({
        trainings: sql<number>`count(*)::int`,
      })
      .from(classSessions)
      .where(and(eq(classSessions.trainerId, ctx.user!.id), gte(classSessions.startsAt, from))),
  ])

  return {
    data: {
      date: from.toISOString().slice(0, 10),
      sessions,
      upcomingTotal: stats[0]?.trainings ?? 0,
    },
  }
}

export async function handleTrainerCheckIn(ctx: ApiContext) {
  const body = await readJson(ctx.request, checkInSchema)
  const sessionId = ctx.params.id!

  const [session] = await ctx.db.select().from(classSessions).where(eq(classSessions.id, sessionId)).limit(1)
  if (!session) throw notFound('Class session')

  const { checkIn } = await import('@/lib/services/attendance')
  const memberId =
    body.memberId ??
    (body.search
      ? (await ctx.db.select({ id: users.id }).from(users).where(sql`(${users.firstName} || ' ' || ${users.lastName}) ilike ${body.search}`).limit(1))[0]?.id
      : undefined)

  if (!memberId) throw notFound('Member')

  const result = await checkIn(ctx.db, {
    memberId,
    branchId: session.branchId,
    sessionId,
    method: body.method ?? 'CLASS',
    actor: actorOf(ctx),
  })
  return created(result)
}

export async function handleMyToday(ctx: ApiContext) {
  const [sessions, visits] = await Promise.all([
    todaysSessions(ctx.db, ctx.user?.branchId ?? undefined),
    ctx.db
      .select({ id: attendance.id, checkedInAt: attendance.checkedInAt })
      .from(attendance)
      .where(and(eq(attendance.memberId, ctx.user!.id), gte(attendance.checkedInAt, new Date(new Date().setUTCHours(0, 0, 0, 0)))))
      .limit(1),
  ])
  return { data: { sessions: sessions.slice(0, 20), checkedInToday: visits.length > 0 } }
}

export async function handleMemberSearch(ctx: ApiContext) {
  const q = ctx.query.get('q')
  if (!q) return { data: [] }
  const term = `%${q}%`
  const rows = await ctx.db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      membershipStatus: sql<string | null>`(select m.status from memberships m where m.member_id = users.id order by m.ends_at desc limit 1)`,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(and(eq(users.role, 'MEMBER'), sql`(${users.firstName} || ' ' || ${users.lastName} || ' ' || ${users.email}) ilike ${term}`))
    .limit(10)
  return { data: rows }
}

export async function handleMyPass(ctx: ApiContext) {
  const { signQrPass } = await import('@/lib/auth/tokens')
  const pass = signQrPass(ctx.user!.id)
  return { data: { token: pass.token, expiresAt: pass.expiresAt } }
}

export type { ApiContext }
