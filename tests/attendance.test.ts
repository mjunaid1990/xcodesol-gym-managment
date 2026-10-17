import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { checkIn, checkInByQrPass, checkInBySearch, floorStats, listVisits } from '@/lib/services/attendance'
import { signQrPass, verifyQrPass } from '@/lib/auth/tokens'
import { attendance, bookings } from '@/lib/db/schema'
import { addMinutes } from '@/lib/domain/money'
import { setupTestDb, type TestContext } from './helpers/db'

let ctx: TestContext

beforeAll(async () => {
  process.env.AUTH_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing'
  ctx = await setupTestDb()
})

describe('QR passes', () => {
  it('signs and verifies a fresh pass', () => {
    const { token, expiresAt } = signQrPass(ctx.fixtures.users.member.id)
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now())
    expect(verifyQrPass(token).memberId).toBe(ctx.fixtures.users.member.id)
  })

  it('rejects an expired pass and a tampered signature', () => {
    const issuedAt = new Date(Date.now() - 10 * 60_000)
    const { token } = signQrPass(ctx.fixtures.users.member.id, issuedAt)
    expect(() => verifyQrPass(token)).toThrow(/expired/i)

    const [memberId, issued, signature] = token.split('.')
    expect(() => verifyQrPass(`${memberId}.${issued}.${signature!.slice(0, -2)}AB`)).toThrow(/signature/i)
    expect(() => verifyQrPass('garbage')).toThrow(/valid gym pass/i)
  })
})

describe('check-in', () => {
  it('checks a member in with a QR scan', async () => {
    const pass = signQrPass(ctx.fixtures.users.packMember.id)
    const result = await checkInByQrPass(ctx.db, pass.token, { branchId: ctx.fixtures.branches.downtown.id })
    expect(result.method).toBe('QR')
    expect(result.membershipStatus).toBe('ACTIVE')
    expect(result.memberName).toContain('Pat')
  })

  it('blocks a second scan inside the cooldown window', async () => {
    await expect(
      checkIn(ctx.db, { memberId: ctx.fixtures.users.packMember.id, method: 'MANUAL' }),
    ).rejects.toThrow(/already checked in/i)
  })

  it('blocks a lapsed member unless staff override with a reason', async () => {
    await expect(
      checkIn(ctx.db, { memberId: ctx.fixtures.users.lapsedMember.id, method: 'MANUAL' }),
    ).rejects.toThrow(/membership/i)

    const override = await checkIn(ctx.db, {
      memberId: ctx.fixtures.users.lapsedMember.id,
      method: 'MANUAL',
      overrideReason: 'Guest of staff member',
    })
    expect(override.warning).toMatch(/override/i)

    const visits = await ctx.db.select().from(attendance).where(eq(attendance.memberId, ctx.fixtures.users.lapsedMember.id))
    expect(visits[0]!.note).toMatch(/Guest of staff member/)
  })

  it('finds a member by name at the front desk', async () => {
    const result = await checkInBySearch(ctx.db, 'Mia Member')
    expect(result.memberId).toBe(ctx.fixtures.users.member.id)

    await expect(checkInBySearch(ctx.db, 'Nobody Here')).rejects.toThrow(/no member matches/i)
  })

  it('marks the class booking attended when checking into a class', async () => {
    const { classSessions } = await import('@/lib/db/schema')
    const [session] = await ctx.db
      .insert(classSessions)
      .values({
        branchId: ctx.fixtures.branches.downtown.id,
        title: 'Check-in class',
        startsAt: addMinutes(new Date(), 30),
        endsAt: addMinutes(new Date(), 90),
        capacity: 5,
      })
      .returning()

    // A fresh member: anyone checked in earlier in this file is inside the cooldown window.
    const { users } = await import('@/lib/db/schema')
    const [freshMember] = await ctx.db
      .insert(users)
      .values({
        email: 'class-checkin@test.dev',
        firstName: 'Class',
        lastName: 'Checkin',
        role: 'MEMBER',
        passwordHash: 'x',
        branchId: ctx.fixtures.branches.downtown.id,
      })
      .returning()

    const [booking] = await ctx.db
      .insert(bookings)
      .values({ sessionId: session!.id, memberId: freshMember!.id, status: 'BOOKED' })
      .returning()

    const result = await checkIn(ctx.db, {
      memberId: freshMember!.id,
      sessionId: session!.id,
      method: 'CLASS',
      now: new Date(),
      overrideReason: 'attending their free trial class',
    })
    expect(result.sessionId).toBe(session!.id)

    const [updated] = await ctx.db.select().from(bookings).where(eq(bookings.id, booking!.id)).limit(1)
    expect(updated!.status).toBe('ATTENDED')
    expect(updated!.attendedAt).toBeTruthy()
  })
})

describe('visit history and floor stats', () => {
  it('paginates visits with member and branch context', async () => {
    const result = await listVisits(ctx.db, { limit: 5 })
    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.total).toBeGreaterThan(0)
    expect(result.rows[0]!.memberName).toBeTruthy()
  })

  it('reports today\'s floor activity', async () => {
    const stats = await floorStats(ctx.db, ctx.fixtures.branches.downtown.id)
    expect(stats.visitsToday).toBeGreaterThan(0)
    expect(stats.uniqueToday).toBeGreaterThan(0)
    expect(stats.recentVisits.length).toBeGreaterThan(0)
  })

  it('filters visits by method', async () => {
    const qrOnly = await listVisits(ctx.db, { method: 'QR' })
    expect(qrOnly.rows.every((row) => row.method === 'QR')).toBe(true)
  })
})
