import { beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { bookSession, cancelBooking, markAttendanceStatus, runNoShowSweep } from '@/lib/services/bookings'
import { bookings, invoices, memberships } from '@/lib/db/schema'
import { addMinutes } from '@/lib/domain/money'
import { setupTestDb, type TestContext } from './helpers/db'

let ctx: TestContext

beforeAll(async () => {
  ctx = await setupTestDb()
})

async function makeSession(capacity: number, startsInMinutes = 120, branchId?: string) {
  const { classSessions } = await import('@/lib/db/schema')
  const [session] = await ctx.db
    .insert(classSessions)
    .values({
      branchId: branchId ?? ctx.fixtures.branches.downtown.id,
      title: `Test class ${Math.random().toString(36).slice(2, 6)}`,
      trainerId: ctx.fixtures.users.trainer.id,
      startsAt: addMinutes(new Date(), startsInMinutes),
      endsAt: addMinutes(new Date(), startsInMinutes + 60),
      capacity,
      creditCost: 1,
      cancelWindowHours: 6,
      lateCancelPenaltyCents: 1500,
    })
    .returning()
  return session!
}

describe('booking capacity and waitlists', () => {
  it('seats members until capacity, then waitlists with positions', async () => {
    const session = await makeSession(1)

    const first = await bookSession(ctx.db, { memberId: ctx.fixtures.users.member.id, sessionId: session.id })
    expect(first.waitlisted).toBe(false)
    expect(first.seated).toBe(1)

    const second = await bookSession(ctx.db, { memberId: ctx.fixtures.users.packMember.id, sessionId: session.id })
    expect(second.waitlisted).toBe(true)
    expect(second.booking.waitlistPosition).toBe(1)
  })

  it('refuses a duplicate booking for the same class', async () => {
    const session = await makeSession(4)
    await bookSession(ctx.db, { memberId: ctx.fixtures.users.member.id, sessionId: session.id })
    await expect(
      bookSession(ctx.db, { memberId: ctx.fixtures.users.member.id, sessionId: session.id }),
    ).rejects.toThrow(/already booked/i)
  })

  it('refuses a booking for a lapsed member but allows a desk override', async () => {
    const session = await makeSession(4)
    await expect(
      bookSession(ctx.db, { memberId: ctx.fixtures.users.lapsedMember.id, sessionId: session.id }),
    ).rejects.toThrow(/no membership/i)

    const override = await bookSession(ctx.db, {
      memberId: ctx.fixtures.users.lapsedMember.id,
      sessionId: session.id,
      overrideEntitlement: true,
    })
    expect(override.waitlisted).toBe(false)
  })

  it('promotes the waitlist automatically when a seat frees up', async () => {
    const session = await makeSession(1)
    const seated = await bookSession(ctx.db, { memberId: ctx.fixtures.users.member.id, sessionId: session.id })
    const waiting = await bookSession(ctx.db, { memberId: ctx.fixtures.users.packMember.id, sessionId: session.id })
    expect(waiting.waitlisted).toBe(true)

    const cancellation = await cancelBooking(ctx.db, seated.booking.id, { reason: 'cannot make it', waivePenalty: true })
    expect(cancellation.promoted?.memberId).toBe(ctx.fixtures.users.packMember.id)

    const [promotedRow] = await ctx.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, waiting.booking.id))
      .limit(1)
    expect(promotedRow!.status).toBe('BOOKED')
    expect(promotedRow!.waitlistPosition).toBeNull()
    expect(cancellation.penaltyCents).toBe(0)
  })
})

describe('credits and penalties', () => {
  it('spends a class credit when a pack member books, and returns it on time', async () => {
    const readCredits = async () => {
      const [row] = await ctx.db
        .select({ credits: memberships.creditsRemaining })
        .from(memberships)
        .where(eq(memberships.id, ctx.fixtures.memberships.pack.id))
      return row!.credits ?? 0
    }

    const startingCredits = await readCredits()
    // Eight hours out: comfortably outside the six hour cancellation window.
    const session = await makeSession(4, 480)
    await bookSession(ctx.db, { memberId: ctx.fixtures.users.packMember.id, sessionId: session.id })

    // Exactly one credit leaves the pack (earlier waitlist promotions in this file may
    // have consumed others, so we compare against the balance we just read).
    expect(await readCredits()).toBe(startingCredits - 1)

    const [booking] = await ctx.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.sessionId, session.id), eq(bookings.memberId, ctx.fixtures.users.packMember.id)))
      .limit(1)

    await cancelBooking(ctx.db, booking!.id, { reason: 'changed my mind' })
    expect(await readCredits()).toBe(startingCredits)
  })

  it('charges a late-cancellation fee inside the window and keeps the credit spent', async () => {
    const unlimitedSession = await makeSession(4, 60)
    const booking = await bookSession(ctx.db, { memberId: ctx.fixtures.users.member.id, sessionId: unlimitedSession.id })

    const result = await cancelBooking(ctx.db, booking.booking.id, { reason: 'stuck at work' })
    expect(result.late).toBe(true)
    expect(result.penaltyCents).toBe(1500)

    const penalty = await ctx.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.memberId, ctx.fixtures.users.member.id), eq(invoices.status, 'OPEN')))
    expect(penalty.some((row) => row.description?.includes('Late cancellation'))).toBe(true)
  })

  it('lets staff waive the penalty but never the member themselves', async () => {
    const session = await makeSession(4, 45)
    const booking = await bookSession(ctx.db, { memberId: ctx.fixtures.users.member.id, sessionId: session.id })
    const waived = await cancelBooking(ctx.db, booking.booking.id, { reason: 'desk error', waivePenalty: true })
    expect(waived.penaltyCents).toBe(0)
    expect(waived.late).toBe(true)
  })

  it('marks no-shows and closes out attended bookings', async () => {
    // Both classes are bookable when created; the sweep later runs from a clock after
    // they have finished, exactly like the nightly cron does.
    const attendedSession = await makeSession(4, 60)
    const missedSession = await makeSession(4, 120)

    const attendedBooking = await bookSession(ctx.db, {
      memberId: ctx.fixtures.users.member.id,
      sessionId: attendedSession.id,
    })
    const missedBooking = await bookSession(ctx.db, {
      memberId: ctx.fixtures.users.packMember.id,
      sessionId: missedSession.id,
    })

    await markAttendanceStatus(ctx.db, attendedBooking.booking.id, 'ATTENDED')
    const [attended] = await ctx.db.select().from(bookings).where(eq(bookings.id, attendedBooking.booking.id)).limit(1)
    expect(attended!.status).toBe('ATTENDED')

    await runNoShowSweep(ctx.db, addMinutes(missedSession.endsAt, 60))

    const [noShow] = await ctx.db.select().from(bookings).where(eq(bookings.id, missedBooking.booking.id)).limit(1)
    const [stillAttended] = await ctx.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, attendedBooking.booking.id))
      .limit(1)
    expect(noShow!.status).toBe('NO_SHOW')
    expect(stillAttended!.status).toBe('ATTENDED')
  })

  it('blocks bookings for classes that already started', async () => {
    const started = await makeSession(4, -30)
    await expect(bookSession(ctx.db, { memberId: ctx.fixtures.users.member.id, sessionId: started.id })).rejects.toThrow(
      /already started/i,
    )
  })

  it('rebooks a member who cancelled earlier', async () => {
    const session = await makeSession(4, 300)
    const first = await bookSession(ctx.db, { memberId: ctx.fixtures.users.member.id, sessionId: session.id })
    await cancelBooking(ctx.db, first.booking.id, { reason: 'oops', waivePenalty: true })

    const again = await bookSession(ctx.db, { memberId: ctx.fixtures.users.member.id, sessionId: session.id })
    expect(again.booking.id).toBe(first.booking.id)
    expect(again.waitlisted).toBe(false)

    const rows = await ctx.db.select().from(bookings).where(eq(bookings.sessionId, session.id))
    expect(rows).toHaveLength(1)
  })

  it('returns no promotion when the queue is empty', async () => {
    const session = await makeSession(2, 200)
    const booking = await bookSession(ctx.db, { memberId: ctx.fixtures.users.member.id, sessionId: session.id })
    const result = await cancelBooking(ctx.db, booking.booking.id, { reason: 'none', waivePenalty: true })
    expect(result.promoted).toBeNull()
  })
})
