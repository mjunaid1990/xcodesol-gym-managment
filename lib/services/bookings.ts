import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import {
  bookings,
  branches,
  classSessions,
  invoices,
  memberships,
  plans,
  users,
  type Booking,
  type ClassSession,
} from '@/lib/db/schema'
import { conflict, notFound, unprocessable } from '@/lib/api/http'
import { penaltyAmount } from '@/lib/domain/money'
import { writeAudit } from './audit'
import { notify } from './notifications'
import { getEntitlement, nextInvoiceNumber } from './memberships'

const SEATED_STATUSES = ['BOOKED', 'ATTENDED'] as const

export interface BookInput {
  memberId: string
  sessionId: string
  actor?: { id?: string | null; email?: string | null }
  /** Staff can book on behalf of a member who is standing at the desk. */
  overrideEntitlement?: boolean
}

export interface BookResult {
  booking: Booking
  waitlisted: boolean
  capacity: number
  seated: number
  message: string
}

async function seatedCount(db: Database, sessionId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.sessionId, sessionId), inArray(bookings.status, [...SEATED_STATUSES])))
  return row?.count ?? 0
}

/**
 * Booking flow. Capacity is re-counted inside the transaction so two members cannot
 * claim the last spot: the write that pushes the count over capacity waits for the
 * first transaction to commit and then sees the updated count.
 */
export async function bookSession(db: Database, input: BookInput): Promise<BookResult> {
  const [session] = await db.select().from(classSessions).where(eq(classSessions.id, input.sessionId)).limit(1)
  if (!session) throw notFound('Class session')
  if (session.status !== 'SCHEDULED') throw unprocessable(`That class is ${session.status.toLowerCase()}`)
  if (session.startsAt.getTime() < Date.now()) throw unprocessable('That class has already started')

  const entitlement = await getEntitlement(db, input.memberId)
  const usesCredits = entitlement.membership?.creditsRemaining !== null && entitlement.membership?.creditsRemaining !== undefined

  if (!entitlement.allowed && !input.overrideEntitlement) {
    throw unprocessable(`Cannot book: ${entitlement.reason}. Visit the front desk or renew in the app.`)
  }
  if (entitlement.allowed && usesCredits && (entitlement.membership!.creditsRemaining ?? 0) < session.creditCost) {
    throw unprocessable('Not enough class credits left on this pack. Top up at the front desk.')
  }

  const [existing] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.sessionId, input.sessionId), eq(bookings.memberId, input.memberId)))
    .limit(1)

  if (existing && existing.status !== 'CANCELLED' && existing.status !== 'NO_SHOW') {
    throw conflict(`Already ${existing.status.toLowerCase()} for this class`)
  }

  return db.transaction(async (tx) => {
    const seated = await seatedCount(tx as unknown as Database, input.sessionId)
    const full = seated >= session.capacity

    let waitlistPosition: number | null = null
    if (full) {
      const [last] = await tx
        .select({ max: sql<number | null>`max(waitlist_position)` })
        .from(bookings)
        .where(and(eq(bookings.sessionId, input.sessionId), eq(bookings.status, 'WAITLISTED')))
      waitlistPosition = (last?.max ?? 0) + 1
    }

    let booking: Booking | undefined
    if (existing) {
      const [updated] = await tx
        .update(bookings)
        .set({
          status: full ? 'WAITLISTED' : 'BOOKED',
          waitlistPosition,
          bookedAt: new Date(),
          cancelledAt: null,
          cancelReason: null,
          lateCancel: false,
          creditCharged: !full && usesCredits,
        })
        .where(eq(bookings.id, existing.id))
        .returning()
      booking = updated
    } else {
      const [inserted] = await tx
        .insert(bookings)
        .values({
          sessionId: input.sessionId,
          memberId: input.memberId,
          status: full ? 'WAITLISTED' : 'BOOKED',
          waitlistPosition,
          creditCharged: !full && usesCredits,
        })
        .returning()
      booking = inserted
    }

    // Credits are only consumed once the member actually has a seat.
    if (!full && usesCredits) {
      await tx
        .update(memberships)
        .set({ creditsRemaining: sql`greatest(coalesce(${memberships.creditsRemaining}, 0) - ${session.creditCost}, 0)` })
        .where(eq(memberships.id, entitlement.membership!.id))
    }

    await notify(tx as unknown as Database, {
      userId: input.memberId,
      type: 'BOOKING_CONFIRMED',
      title: full ? `Waitlisted for ${session.title}` : `Booked: ${session.title}`,
      body: full
        ? `You are number ${waitlistPosition} on the waitlist for ${session.startsAt.toUTCString()}. We will auto-book you if a spot opens.`
        : `See you at ${session.startsAt.toUTCString()}. Cancel more than ${session.cancelWindowHours}h ahead to keep your credit.`,
      channels: ['IN_APP', 'PUSH'],
      meta: { sessionId: session.id, bookingId: booking?.id },
    })

    await writeAudit(tx as unknown as Database, {
      actorId: input.actor?.id,
      actorEmail: input.actor?.email,
      action: full ? 'booking.waitlisted' : 'booking.create',
      entity: 'booking',
      entityId: booking?.id,
      branchId: session.branchId,
      meta: { sessionId: session.id, memberId: input.memberId, waitlistPosition },
    })

    return {
      booking: booking!,
      waitlisted: full,
      capacity: session.capacity,
      seated: full ? seated : seated + 1,
      message: full
        ? `Class is full - added to the waitlist at position ${waitlistPosition}`
        : 'Booked. See you there.',
    }
  })
}

/**
 * Promotion rule: when a seat frees up, the earliest waitlisted member is promoted,
 * their credit is charged at that moment, and they are notified. Members without
 * credits are skipped (and told) rather than silently blocking the queue.
 */
export async function promoteFromWaitlist(db: Database, sessionId: string): Promise<Booking | null> {
  const [session] = await db.select().from(classSessions).where(eq(classSessions.id, sessionId)).limit(1)
  if (!session) return null
  if (session.status !== 'SCHEDULED' || session.startsAt.getTime() < Date.now()) return null

  const seated = await seatedCount(db, sessionId)
  if (seated >= session.capacity) return null

  const queue = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.sessionId, sessionId), eq(bookings.status, 'WAITLISTED')))
    .orderBy(asc(bookings.waitlistPosition), asc(bookings.bookedAt))

  for (const candidate of queue) {
    const entitlement = await getEntitlement(db, candidate.memberId)
    const usesCredits = entitlement.membership?.creditsRemaining !== null && entitlement.membership?.creditsRemaining !== undefined

    if (!entitlement.allowed) {
      await db
        .update(bookings)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Membership not active at promotion time' })
        .where(eq(bookings.id, candidate.id))
      continue
    }
    if (usesCredits && (entitlement.membership!.creditsRemaining ?? 0) < session.creditCost) {
      await db
        .update(bookings)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'No class credits available at promotion time' })
        .where(eq(bookings.id, candidate.id))
      await notify(db, {
        userId: candidate.memberId,
        type: 'WAITLIST_PROMOTED',
        title: `You missed a spot in ${session.title}`,
        body: 'A seat opened but your class pack had no credits left. Top up to stay in the queue.',
        channels: ['IN_APP', 'PUSH'],
      })
      continue
    }

    const [promoted] = await db
      .update(bookings)
      .set({ status: 'BOOKED', waitlistPosition: null, creditCharged: usesCredits, bookedAt: new Date() })
      .where(eq(bookings.id, candidate.id))
      .returning()

    if (usesCredits) {
      await db
        .update(memberships)
        .set({ creditsRemaining: sql`greatest(coalesce(${memberships.creditsRemaining}, 0) - ${session.creditCost}, 0)` })
        .where(eq(memberships.id, entitlement.membership!.id))
    }

    await notify(db, {
      userId: candidate.memberId,
      type: 'WAITLIST_PROMOTED',
      title: `You're in: ${session.title}`,
      body: `A spot opened up for ${session.startsAt.toUTCString()}. Cancel early if you cannot make it.`,
      channels: ['IN_APP', 'PUSH', 'EMAIL'],
      meta: { sessionId, bookingId: candidate.id },
    })

    await writeAudit(db, {
      action: 'booking.promoted',
      entity: 'booking',
      entityId: candidate.id,
      branchId: session.branchId,
      meta: { sessionId, memberId: candidate.memberId },
    })

    return promoted!
  }

  return null
}

export interface CancelInput {
  reason?: string
  actor?: { id?: string | null; email?: string | null }
  /** Staff cancellations ignore the free-cancellation window. */
  waivePenalty?: boolean
}

export interface CancelResult {
  booking: Booking
  late: boolean
  penaltyCents: number
  promoted: Booking | null
}

export async function cancelBooking(db: Database, bookingId: string, input: CancelInput = {}): Promise<CancelResult> {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1)
  if (!booking) throw notFound('Booking')
  if (!['BOOKED', 'WAITLISTED'].includes(booking.status)) {
    throw unprocessable(`This booking is already ${booking.status.toLowerCase()}`)
  }

  const [session] = await db.select().from(classSessions).where(eq(classSessions.id, booking.sessionId)).limit(1)
  if (!session) throw notFound('Class session')

  const now = new Date()
  const cutoff = new Date(session.startsAt.getTime() - session.cancelWindowHours * 3_600_000)
  // Server clock only: never trust the device to decide whether a cancellation is late.
  const late = booking.status === 'BOOKED' && now > cutoff && now < session.startsAt
  const penaltyCents = input.waivePenalty ? 0 : penaltyAmount(session.lateCancelPenaltyCents, late)

  const [updated] = await db
    .update(bookings)
    .set({
      status: 'CANCELLED',
      cancelledAt: now,
      cancelReason: input.reason ?? (late ? 'Late cancellation' : 'Member cancelled'),
      lateCancel: late,
    })
    .where(eq(bookings.id, bookingId))
    .returning()

  // Return the credit when the member cancelled in time and had been charged.
  if (!late && booking.creditCharged) {
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.memberId, booking.memberId))
      .orderBy(desc(memberships.endsAt))
      .limit(1)
    if (membership?.creditsRemaining !== null && membership?.creditsRemaining !== undefined) {
      await db
        .update(memberships)
        .set({ creditsRemaining: membership.creditsRemaining + session.creditCost })
        .where(eq(memberships.id, membership.id))
    }
  }

  if (penaltyCents > 0) {
    const [invoice] = await db
      .insert(invoices)
      .values({
        number: await nextInvoiceNumber(db, now),
        memberId: booking.memberId,
        branchId: session.branchId,
        subtotalCents: penaltyCents,
        totalCents: penaltyCents,
        status: 'OPEN',
        dueAt: new Date(now.getTime() + 7 * 86_400_000),
        description: `Late cancellation fee - ${session.title} (${session.startsAt.toISOString().slice(0, 16).replace('T', ' ')})`,
      })
      .returning()

    await notify(db, {
      userId: booking.memberId,
      type: 'BOOKING_CANCELLED',
      title: 'Late cancellation fee',
      body: `You cancelled ${session.title} inside the ${session.cancelWindowHours}h window, so a fee of ${(penaltyCents / 100).toFixed(2)} was added to your account.`,
      channels: ['IN_APP', 'PUSH', 'EMAIL'],
      meta: { invoiceId: invoice!.id, sessionId: session.id },
    })
  } else {
    await notify(db, {
      userId: booking.memberId,
      type: 'BOOKING_CANCELLED',
      title: `Cancelled: ${session.title}`,
      body: `Your spot for ${session.startsAt.toUTCString()} was released.`,
      channels: ['IN_APP'],
      meta: { sessionId: session.id },
    })
  }

  const promoted = booking.status === 'BOOKED' ? await promoteFromWaitlist(db, session.id) : null

  await writeAudit(db, {
    actorId: input.actor?.id,
    actorEmail: input.actor?.email,
    action: 'booking.cancel',
    entity: 'booking',
    entityId: bookingId,
    branchId: session.branchId,
    meta: { late, penaltyCents, promoted: promoted?.id ?? null, reason: input.reason ?? null },
  })

  return { booking: updated!, late, penaltyCents, promoted }
}

export async function markAttendanceStatus(
  db: Database,
  bookingId: string,
  status: 'ATTENDED' | 'NO_SHOW',
  actor?: { id?: string | null; email?: string | null },
) {
  const [booking] = await db
    .update(bookings)
    .set({ status, attendedAt: status === 'ATTENDED' ? new Date() : null })
    .where(eq(bookings.id, bookingId))
    .returning()
  if (!booking) throw notFound('Booking')

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: `booking.mark_${status.toLowerCase()}`,
    entity: 'booking',
    entityId: bookingId,
    meta: { sessionId: booking.sessionId, memberId: booking.memberId },
  })

  return booking
}

export interface BookingFilters {
  memberId?: string
  sessionId?: string
  status?: string
  from?: Date
  to?: Date
  branchId?: string
  limit?: number
}

export async function listBookings(db: Database, filters: BookingFilters = {}) {
  const conditions = []
  if (filters.memberId) conditions.push(eq(bookings.memberId, filters.memberId))
  if (filters.sessionId) conditions.push(eq(bookings.sessionId, filters.sessionId))
  if (filters.status) conditions.push(eq(bookings.status, filters.status))
  if (filters.branchId) conditions.push(eq(classSessions.branchId, filters.branchId))
  if (filters.from) conditions.push(gt(classSessions.startsAt, filters.from))
  if (filters.to) conditions.push(lte(classSessions.startsAt, filters.to))

  return db
    .select({
      id: bookings.id,
      status: bookings.status,
      waitlistPosition: bookings.waitlistPosition,
      lateCancel: bookings.lateCancel,
      bookedAt: bookings.bookedAt,
      cancelledAt: bookings.cancelledAt,
      attendedAt: bookings.attendedAt,
      memberId: users.id,
      memberName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      memberEmail: users.email,
      sessionId: classSessions.id,
      sessionTitle: classSessions.title,
      startsAt: classSessions.startsAt,
      branchName: branches.name,
      planName: plans.name,
    })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .innerJoin(users, eq(users.id, bookings.memberId))
    .leftJoin(branches, eq(branches.id, classSessions.branchId))
    .leftJoin(memberships, eq(memberships.memberId, bookings.memberId))
    .leftJoin(plans, eq(plans.id, memberships.planId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(classSessions.startsAt))
    .limit(Math.min(500, filters.limit ?? 100))
}

/** Daily job: anyone still marked BOOKED after the class ended is a no-show. */
export async function runNoShowSweep(db: Database, now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 60_000)
  const stale = await db
    .select({ id: bookings.id, memberId: bookings.memberId, sessionId: bookings.sessionId, title: classSessions.title })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.status, 'BOOKED'), lte(classSessions.endsAt, cutoff), gt(classSessions.endsAt, new Date(now.getTime() - 14 * 86_400_000))))
    .limit(500)

  for (const row of stale) {
    await db.update(bookings).set({ status: 'NO_SHOW' }).where(eq(bookings.id, row.id))
  }

  return { marked: stale.length }
}

export interface MemberAttendanceStats {
  visits: number
  classesAttended: number
  noShows: number
  lateCancels: number
  lastVisitAt: Date | null
}

export async function memberBookingStats(db: Database, memberId: string, since: Date): Promise<MemberAttendanceStats> {
  const [row] = await db
    .select({
      classesAttended: sql<number>`count(*) filter (where ${bookings.status} = 'ATTENDED')::int`,
      noShows: sql<number>`count(*) filter (where ${bookings.status} = 'NO_SHOW')::int`,
      lateCancels: sql<number>`count(*) filter (where ${bookings.lateCancel})::int`,
      lastVisitAt: sql<Date | null>`max(${bookings.attendedAt})`,
    })
    .from(bookings)
    .where(and(eq(bookings.memberId, memberId), gt(bookings.bookedAt, since)))

  return {
    visits: row?.classesAttended ?? 0,
    classesAttended: row?.classesAttended ?? 0,
    noShows: row?.noShows ?? 0,
    lateCancels: row?.lateCancels ?? 0,
    lastVisitAt: row?.lastVisitAt ?? null,
  }
}

export type { ClassSession }
