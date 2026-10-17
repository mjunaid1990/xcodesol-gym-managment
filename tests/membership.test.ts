import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  cancelMembership,
  changePlan,
  freezeMembership,
  getEntitlement,
  purchaseMembership,
  renewMembership,
  runMembershipSweep,
  unfreezeMembership,
} from '@/lib/services/memberships'
import { memberships, payments } from '@/lib/db/schema'
import { addDays, prorationCreditCents } from '@/lib/domain/money'
import { setupTestDb, type TestContext } from './helpers/db'

let ctx: TestContext

beforeAll(async () => {
  ctx = await setupTestDb()
  // The mock provider needs no Stripe key: local purchases settle immediately.
  delete process.env.STRIPE_SECRET_KEY
})

describe('purchase', () => {
  it('sells a plan, raises an invoice and activates the membership', async () => {
    const result = await purchaseMembership(ctx.db, {
      memberId: ctx.fixtures.users.lapsedMember.id,
      planId: ctx.fixtures.plans.unlimited.id,
    })

    expect(result.totalCents).toBe(9900)
    expect(result.membership.status).toBe('ACTIVE')
    expect(result.invoice.status).toBe('PAID')
    expect(result.payment?.status).toBe('SUCCEEDED')
  })

  it('applies a percentage discount and refuses an expired code', async () => {
    const { discounts, users: usersTable } = await import('@/lib/db/schema')

    await ctx.db.insert(discounts).values([
      { code: 'EXPIRED10', percentOff: 10, validUntil: addDays(new Date(), -1) },
      { code: 'HALF', percentOff: 50, maxRedemptions: 5 },
    ])

    const createBuyer = async (email: string) => {
      const [buyer] = await ctx.db
        .insert(usersTable)
        .values({ email, firstName: 'Discount', lastName: 'Buyer', role: 'MEMBER', passwordHash: 'x' })
        .returning()
      return buyer!
    }

    const buyer = await createBuyer('discount-buyer@test.dev')
    const discounted = await purchaseMembership(ctx.db, {
      memberId: buyer.id,
      planId: ctx.fixtures.plans.dayPass.id,
      discountCode: 'HALF',
    })
    expect(discounted.discountCents).toBe(750)
    expect(discounted.totalCents).toBe(750)

    const secondBuyer = await createBuyer('expired-code-buyer@test.dev')
    await expect(
      purchaseMembership(ctx.db, {
        memberId: secondBuyer.id,
        planId: ctx.fixtures.plans.dayPass.id,
        discountCode: 'EXPIRED10',
      }),
    ).rejects.toThrow(/expired/i)
  })

  it('will not sell a second active membership', async () => {
    await expect(
      purchaseMembership(ctx.db, { memberId: ctx.fixtures.users.member.id, planId: ctx.fixtures.plans.dayPass.id }),
    ).rejects.toThrow(/already has an active membership/i)
  })
})

describe('renewal', () => {
  it('stacks a renewal onto the existing period instead of truncating it', async () => {
    const [before] = await ctx.db
      .select()
      .from(memberships)
      .where(eq(memberships.id, ctx.fixtures.memberships.unlimited.id))
      .limit(1)

    const result = await renewMembership(ctx.db, ctx.fixtures.memberships.unlimited.id)
    expect(result.membership.endsAt.getTime()).toBeGreaterThan(before!.endsAt.getTime())
    expect(result.membership.endsAt.getTime() - before!.endsAt.getTime()).toBeGreaterThan(25 * 86_400_000)
  })
})

describe('freeze', () => {
  /** A dedicated member + membership so freeze maths is not tangled with other tests. */
  const createFreezableMembership = async (freezeDaysPerYear: number) => {
    const { users, plans, memberships } = await import('@/lib/db/schema')
    const [plan] = await ctx.db
      .insert(plans)
      .values({
        name: `Freeze plan ${freezeDaysPerYear}`,
        type: 'MEMBERSHIP',
        interval: 'MONTHLY',
        priceCents: 5000,
        freezeDaysPerYear,
      })
      .returning()
    const [person] = await ctx.db
      .insert(users)
      .values({
        email: `freeze-${freezeDaysPerYear}-${Math.random().toString(36).slice(2, 7)}@test.dev`,
        firstName: 'Frosty',
        lastName: 'Fee',
        role: 'MEMBER',
        passwordHash: 'x',
      })
      .returning()
    const [membership] = await ctx.db
      .insert(memberships)
      .values({
        memberId: person!.id,
        planId: plan!.id,
        branchId: ctx.fixtures.branches.downtown.id,
        status: 'ACTIVE',
        priceCents: 5000,
        startsAt: addDays(new Date(), -10),
        endsAt: addDays(new Date(), 20),
      })
      .returning()
    return { person: person!, membership: membership! }
  }

  it('freezes within the plan allowance, pushes the end date and records an event', async () => {
    const { person, membership } = await createFreezableMembership(10)
    const frozen = await freezeMembership(ctx.db, membership.id, { days: 5, reason: 'travel' })

    expect(frozen.status).toBe('FROZEN')
    expect(frozen.frozenDaysUsed).toBe(5)
    expect(frozen.freezeEndsAt).toBeTruthy()
    // The end date moves out by exactly the frozen days.
    expect(frozen.endsAt.getTime() - membership.endsAt.getTime()).toBe(5 * 86_400_000)

    const { membershipEvents } = await import('@/lib/db/schema')
    const events = await ctx.db.select().from(membershipEvents).where(eq(membershipEvents.membershipId, frozen.id))
    expect(events.some((event) => event.type === 'FROZEN')).toBe(true)

    const entitlement = await getEntitlement(ctx.db, person.id)
    expect(entitlement.allowed).toBe(false)
    expect(entitlement.reason).toMatch(/frozen/i)
  })

  it('returns unused freeze days on an early unfreeze', async () => {
    const { membership } = await createFreezableMembership(10)
    await freezeMembership(ctx.db, membership.id, { days: 6, reason: 'injury' })
    const unfrozen = await unfreezeMembership(ctx.db, membership.id)

    expect(unfrozen.status).toBe('ACTIVE')
    expect(unfrozen.freezeEndsAt).toBeNull()
    // Unfrozen the same day: every planned day goes back in the bank.
    expect(unfrozen.frozenDaysUsed).toBe(0)
    expect(unfrozen.endsAt.getTime()).toBe(membership.endsAt.getTime())
  })

  it('refuses a freeze longer than the plan allows, and plans that allow none', async () => {
    const { membership } = await createFreezableMembership(3)
    await expect(freezeMembership(ctx.db, membership.id, { days: 10 })).rejects.toThrow(/freeze day/i)

    await expect(
      freezeMembership(ctx.db, ctx.fixtures.memberships.pack.id, { days: 2 }),
    ).rejects.toThrow(/does not allow freezes/i)
  })
})

describe('plan changes', () => {
  it('credits unused time when switching mid-term', async () => {
    const [membership] = await ctx.db
      .select()
      .from(memberships)
      .where(eq(memberships.id, ctx.fixtures.memberships.unlimited.id))
      .limit(1)

    const credit = prorationCreditCents(membership!.priceCents, membership!.startsAt, membership!.endsAt, new Date())
    expect(credit).toBeGreaterThan(0)
    expect(credit).toBeLessThanOrEqual(membership!.priceCents)

    const result = await changePlan(ctx.db, membership!.id, ctx.fixtures.plans.classPack.id)
    expect(result.creditCents).toBe(credit)
    expect(result.membership.planId).toBe(ctx.fixtures.plans.classPack.id)
    // 15000 plan price minus the prorated credit.
    expect(result.invoice.discountCents).toBe(credit)
    expect(result.totalCents).toBe(15000 - credit)
  })

  it('rejects changing to the same plan', async () => {
    await expect(
      changePlan(ctx.db, ctx.fixtures.memberships.pack.id, ctx.fixtures.plans.classPack.id),
    ).rejects.toThrow(/already on that plan/i)
  })
})

describe('cancellation and expiry', () => {
  it('cancels at period end by default, keeping access until then', async () => {
    const cancelled = await cancelMembership(ctx.db, ctx.fixtures.memberships.pack.id, { reason: 'moving away' })
    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.autoRenew).toBe(false)

    const entitlement = await getEntitlement(ctx.db, ctx.fixtures.users.packMember.id)
    expect(entitlement.allowed).toBe(true)
    expect(entitlement.reason).toMatch(/paid period/i)
  })

  it('cancels immediately when asked', async () => {
    const [fresh] = await ctx.db
      .select()
      .from(memberships)
      .where(eq(memberships.id, ctx.fixtures.memberships.unlimited.id))
      .limit(1)
    const cancelled = await cancelMembership(ctx.db, fresh!.id, { reason: 'refund requested', immediate: true })
    const entitlement = await getEntitlement(ctx.db, ctx.fixtures.users.member.id)
    expect(cancelled.status).toBe('CANCELLED')
    expect(entitlement.allowed).toBe(false)
  })

  it('expires lapsed memberships on the daily sweep and queues reminders', async () => {
    const [created] = await ctx.db
      .insert(memberships)
      .values({
        memberId: ctx.fixtures.users.lapsedMember.id,
        planId: ctx.fixtures.plans.unlimited.id,
        branchId: ctx.fixtures.branches.downtown.id,
        status: 'ACTIVE',
        priceCents: 9900,
        startsAt: addDays(new Date(), -40),
        endsAt: addDays(new Date(), -5),
        autoRenew: false,
      })
      .returning()

    const [expiringSoon] = await ctx.db
      .insert(memberships)
      .values({
        memberId: ctx.fixtures.users.packMember.id,
        planId: ctx.fixtures.plans.unlimited.id,
        branchId: ctx.fixtures.branches.riverside.id,
        status: 'ACTIVE',
        priceCents: 9900,
        startsAt: addDays(new Date(), -25),
        endsAt: addDays(new Date(), 3),
      })
      .returning()

    const result = await runMembershipSweep(ctx.db)
    expect(result.expired).toBeGreaterThan(0)
    expect(result.expiringSoon).toBeGreaterThan(0)

    const [expiredRow] = await ctx.db.select().from(memberships).where(eq(memberships.id, created!.id)).limit(1)
    expect(expiredRow!.status).toBe('EXPIRED')

    const { notifications } = await import('@/lib/db/schema')
    const messages = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ctx.fixtures.users.packMember.id))
    expect(messages.some((row) => row.type === 'MEMBERSHIP_EXPIRING')).toBe(true)

    void expiringSoon
  })

  it('records every payment attempt in the ledger', async () => {
    const rows = await ctx.db.select().from(payments)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.amountCents >= 0)).toBe(true)
  })
})
