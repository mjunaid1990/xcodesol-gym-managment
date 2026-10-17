import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import {
  discounts,
  invoices,
  membershipEvents,
  memberships,
  payments,
  plans,
  users,
  type Membership,
  type Plan,
  type User,
} from '@/lib/db/schema'
import { badRequest, conflict, notFound, unprocessable } from '@/lib/api/http'
import type { PlanInterval } from '@/lib/constants'
import { daysBetween, invoiceTotals, nextPeriodEnd, prorationCreditCents } from '@/lib/domain/money'
import { writeAudit } from './audit'
import { notify } from './notifications'
import { activeProvider, createCharge, markPaymentSucceeded } from './payments'

let invoiceSequence = 0

/** INV-2026-0142: human readable, stable, and unique per year. */
export async function nextInvoiceNumber(db: Database, now = new Date()): Promise<string> {
  const year = now.getUTCFullYear()
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(sql`${invoices.number} like ${`INV-${year}-%`}`)
  invoiceSequence = (row?.count ?? 0) + 1
  return `INV-${year}-${String(invoiceSequence + 1).padStart(4, '0')}`
}

interface ActorInfo {
  id?: string | null
  email?: string | null
}

export interface MembershipDetail extends Membership {
  plan: Plan
  member: Pick<User, 'id' | 'firstName' | 'lastName' | 'email' | 'phone' | 'branchId'>
}

export interface PurchaseInput {
  memberId: string
  planId: string
  discountCode?: string
  autoRenew?: boolean
  startsAt?: Date
  actor?: ActorInfo
  /** Staff can take cash or mark a comp, bypassing the card intent. */
  skipPayment?: boolean
}

export interface PurchaseResult {
  membership: Membership
  invoice: typeof invoices.$inferSelect
  payment: typeof payments.$inferSelect | null
  clientSecret: string | null
  discountCents: number
  totalCents: number
}

export async function purchaseMembership(db: Database, input: PurchaseInput): Promise<PurchaseResult> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, input.planId)).limit(1)
  if (!plan) throw notFound('Plan')
  if (!plan.isActive) throw unprocessable('That plan is no longer available')

  const [member] = await db.select().from(users).where(eq(users.id, input.memberId)).limit(1)
  if (!member) throw notFound('Member')
  if (member.role !== 'MEMBER') throw unprocessable('Only members can hold a membership')

  const existing = await db
    .select({ id: memberships.id, status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.memberId, member.id), inArray(memberships.status, ['ACTIVE', 'FROZEN'])))
    .limit(1)
  if (existing.length) {
    throw conflict('This member already has an active membership. Use renew, change plan, or cancel instead.')
  }

  const startsAt = input.startsAt ?? new Date()
  const endsAt = plan.interval === 'ONE_TIME' ? new Date(startsAt.getTime() + 180 * 86_400_000) : nextPeriodEnd(startsAt, plan.interval as PlanInterval)

  let discountCents = 0
  let appliedDiscountId: string | null = null
  if (input.discountCode) {
    const [discount] = await db
      .select()
      .from(discounts)
      .where(eq(discounts.code, input.discountCode.trim().toUpperCase()))
      .limit(1)
    if (!discount || !discount.isActive) throw unprocessable('That discount code is not valid')
    if (discount.validUntil && discount.validUntil.getTime() < Date.now()) throw unprocessable('That discount code has expired')
    if (discount.validFrom && discount.validFrom.getTime() > Date.now()) throw unprocessable('That discount code is not active yet')
    if (discount.maxRedemptions && discount.redemptions >= discount.maxRedemptions) {
      throw unprocessable('That discount code has reached its limit')
    }
    discountCents =
      discount.percentOff
        ? Math.round((plan.priceCents * discount.percentOff) / 100)
        : Math.min(discount.amountOffCents ?? 0, plan.priceCents)
    appliedDiscountId = discount.id
  }

  const totals = invoiceTotals(plan.priceCents, discountCents)

  const [membership] = await db
    .insert(memberships)
    .values({
      memberId: member.id,
      planId: plan.id,
      branchId: member.branchId ?? plan.branchId ?? null,
      status: 'PENDING',
      priceCents: totals.totalCents,
      currency: plan.currency,
      startsAt,
      endsAt,
      autoRenew: input.autoRenew ?? plan.autoRenew,
      creditsRemaining: plan.classCredits,
    })
    .returning()

  const [invoice] = await db
    .insert(invoices)
    .values({
      number: await nextInvoiceNumber(db),
      memberId: member.id,
      membershipId: membership!.id,
      branchId: membership!.branchId,
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      currency: plan.currency,
      status: 'OPEN',
      dueAt: new Date(startsAt.getTime() + 7 * 86_400_000),
      description: `${plan.name}${input.discountCode ? ` (${input.discountCode.toUpperCase()})` : ''}`,
    })
    .returning()

  await db.insert(membershipEvents).values({
    membershipId: membership!.id,
    type: 'CREATED',
    toStatus: 'PENDING',
    amountCents: totals.totalCents,
    note: plan.name,
    actorId: input.actor?.id ?? null,
  })

  if (appliedDiscountId) {
    await db
      .update(discounts)
      .set({ redemptions: sql`${discounts.redemptions} + 1` })
      .where(eq(discounts.id, appliedDiscountId))
  }

  let payment: typeof payments.$inferSelect | null = null
  let clientSecret: string | null = null
  const idempotencyKey = `purchase_${membership!.id}`

  if (input.skipPayment) {
    const [created] = await db
      .insert(payments)
      .values({
        invoiceId: invoice!.id,
        memberId: member.id,
        membershipId: membership!.id,
        branchId: membership!.branchId,
        amountCents: totals.totalCents,
        currency: plan.currency,
        status: 'SUCCEEDED',
        provider: 'cash',
        method: 'cash',
        providerRef: `cash_${idempotencyKey}`,
        idempotencyKey,
        paidAt: new Date(),
      })
      .returning()
    payment = created!
    await markPaymentSucceeded(db, created!.id)
  } else {
    const charge = await createCharge({
      amountCents: totals.totalCents,
      currency: plan.currency,
      memberId: member.id,
      invoiceId: invoice!.id,
      invoiceNumber: invoice!.number,
      description: invoice!.description ?? plan.name,
      idempotencyKey,
    })

    const [created] = await db
      .insert(payments)
      .values({
        invoiceId: invoice!.id,
        memberId: member.id,
        membershipId: membership!.id,
        branchId: membership!.branchId,
        amountCents: totals.totalCents,
        currency: plan.currency,
        status: 'PENDING',
        provider: charge.provider,
        providerRef: charge.providerRef,
        clientSecret: charge.clientSecret,
        method: 'card',
        idempotencyKey,
      })
      .returning()
    payment = created!
    clientSecret = charge.clientSecret
    if (charge.status === 'SUCCEEDED') await markPaymentSucceeded(db, created!.id)
  }

  // Payment settlement updated the invoice row, so return the settled copy rather than
  // the stale INSERT result (clients render the invoice status directly).
  const [fresh] = await db.select().from(memberships).where(eq(memberships.id, membership!.id)).limit(1)
  const [freshInvoice] = await db.select().from(invoices).where(eq(invoices.id, invoice!.id)).limit(1)
  const settledPayment = payment
    ? (await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1))[0] ?? payment
    : null

  await writeAudit(db, {
    actorId: input.actor?.id,
    actorEmail: input.actor?.email,
    action: 'membership.purchase',
    entity: 'membership',
    entityId: membership!.id,
    branchId: membership!.branchId,
    meta: { plan: plan.name, totalCents: totals.totalCents, provider: activeProvider() },
  })

  await notify(db, {
    userId: member.id,
    type: 'PAYMENT_SUCCEEDED',
    title: `Welcome to ${plan.name}`,
    body: `Your membership is active until ${endsAt.toDateString()}.`,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    meta: { membershipId: membership!.id },
  })

  return {
    membership: fresh ?? membership!,
    invoice: freshInvoice ?? invoice!,
    payment: settledPayment,
    clientSecret,
    discountCents,
    totalCents: totals.totalCents,
  }
}

export async function renewMembership(
  db: Database,
  membershipId: string,
  input: { actor?: ActorInfo; skipPayment?: boolean; discountCode?: string } = {},
): Promise<PurchaseResult> {
  const [membership] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1)
  if (!membership) throw notFound('Membership')
  if (membership.status === 'CANCELLED') throw unprocessable('This membership was cancelled. Buy a new one instead.')

  const [plan] = await db.select().from(plans).where(eq(plans.id, membership.planId)).limit(1)
  if (!plan) throw notFound('Plan')

  const now = new Date()
  // Renewals stack: renewing early extends from the current end date, never truncates it.
  const base = membership.endsAt.getTime() > now.getTime() ? membership.endsAt : now
  const newStart = base
  const newEnd = plan.interval === 'ONE_TIME' ? new Date(newStart.getTime() + 180 * 86_400_000) : nextPeriodEnd(newStart, plan.interval as PlanInterval)

  const totals = invoiceTotals(plan.priceCents, 0)
  const [invoice] = await db
    .insert(invoices)
    .values({
      number: await nextInvoiceNumber(db),
      memberId: membership.memberId,
      membershipId: membership.id,
      branchId: membership.branchId,
      subtotalCents: totals.subtotalCents,
      totalCents: totals.totalCents,
      currency: plan.currency,
      status: 'OPEN',
      dueAt: new Date(now.getTime() + 7 * 86_400_000),
      description: `Renewal - ${plan.name}`,
    })
    .returning()

  await db
    .update(memberships)
    .set({
      status: 'PENDING',
      startsAt: membership.startsAt,
      endsAt: newEnd,
      priceCents: totals.totalCents,
      creditsRemaining: plan.classCredits ?? membership.creditsRemaining,
      cancelledAt: null,
      cancelReason: null,
      updatedAt: now,
    })
    .where(eq(memberships.id, membership.id))

  await db.insert(membershipEvents).values({
    membershipId: membership.id,
    type: 'RENEWED',
    fromStatus: membership.status,
    toStatus: 'PENDING',
    amountCents: totals.totalCents,
    note: `Extended to ${newEnd.toISOString().slice(0, 10)}`,
    actorId: input.actor?.id ?? null,
  })

  const idempotencyKey = `renew_${membership.id}_${newStart.getTime()}`
  let payment: typeof payments.$inferSelect | null = null
  let clientSecret: string | null = null

  if (input.skipPayment) {
    const [created] = await db
      .insert(payments)
      .values({
        invoiceId: invoice!.id,
        memberId: membership.memberId,
        membershipId: membership.id,
        branchId: membership.branchId,
        amountCents: totals.totalCents,
        currency: plan.currency,
        status: 'SUCCEEDED',
        provider: 'cash',
        method: 'cash',
        providerRef: `cash_${idempotencyKey}`,
        idempotencyKey,
        paidAt: now,
      })
      .returning()
    payment = created!
    await markPaymentSucceeded(db, created!.id)
  } else {
    const charge = await createCharge({
      amountCents: totals.totalCents,
      currency: plan.currency,
      memberId: membership.memberId,
      invoiceId: invoice!.id,
      invoiceNumber: invoice!.number,
      description: invoice!.description ?? 'Renewal',
      idempotencyKey,
    })
    const [created] = await db
      .insert(payments)
      .values({
        invoiceId: invoice!.id,
        memberId: membership.memberId,
        membershipId: membership.id,
        branchId: membership.branchId,
        amountCents: totals.totalCents,
        currency: plan.currency,
        status: 'PENDING',
        provider: charge.provider,
        providerRef: charge.providerRef,
        clientSecret: charge.clientSecret,
        method: 'card',
        idempotencyKey,
      })
      .returning()
    payment = created!
    clientSecret = charge.clientSecret
    if (charge.status === 'SUCCEEDED') await markPaymentSucceeded(db, created!.id)
  }

  const [fresh] = await db.select().from(memberships).where(eq(memberships.id, membership.id)).limit(1)
  const [freshInvoice] = await db.select().from(invoices).where(eq(invoices.id, invoice!.id)).limit(1)
  const settledPayment = payment
    ? (await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1))[0] ?? payment
    : null

  await writeAudit(db, {
    actorId: input.actor?.id,
    actorEmail: input.actor?.email,
    action: 'membership.renew',
    entity: 'membership',
    entityId: membership.id,
    branchId: membership.branchId,
    meta: { until: newEnd.toISOString(), totalCents: totals.totalCents },
  })

  return {
    membership: fresh ?? membership,
    invoice: freshInvoice ?? invoice!,
    payment: settledPayment,
    clientSecret,
    discountCents: 0,
    totalCents: totals.totalCents,
  }
}

export async function freezeMembership(
  db: Database,
  membershipId: string,
  input: { days: number; reason?: string; actor?: ActorInfo },
): Promise<Membership> {
  const [membership] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1)
  if (!membership) throw notFound('Membership')
  if (membership.status !== 'ACTIVE') throw unprocessable(`Only active memberships can be frozen (this one is ${membership.status})`)

  const [plan] = await db.select().from(plans).where(eq(plans.id, membership.planId)).limit(1)
  const allowed = plan?.freezeDaysPerYear ?? 0
  if (allowed <= 0) throw unprocessable('This plan does not allow freezes')
  const requested = Math.max(1, Math.round(input.days))
  if (membership.frozenDaysUsed + requested > allowed) {
    throw unprocessable(
      `Only ${allowed - membership.frozenDaysUsed} freeze day(s) left this year on ${plan?.name ?? 'this plan'}`,
    )
  }

  const now = new Date()
  const freezeEndsAt = new Date(now.getTime() + requested * 86_400_000)

  const [updated] = await db
    .update(memberships)
    .set({
      status: 'FROZEN',
      frozenAt: now,
      freezeEndsAt,
      frozenDaysUsed: membership.frozenDaysUsed + requested,
      // Freezing always pushes the end date out by the same number of days.
      endsAt: new Date(membership.endsAt.getTime() + requested * 86_400_000),
      updatedAt: now,
    })
    .where(eq(memberships.id, membershipId))
    .returning()

  await db.insert(membershipEvents).values({
    membershipId,
    type: 'FROZEN',
    fromStatus: 'ACTIVE',
    toStatus: 'FROZEN',
    note: `${requested} day(s)${input.reason ? ` - ${input.reason}` : ''}`,
    actorId: input.actor?.id ?? null,
  })

  await writeAudit(db, {
    actorId: input.actor?.id,
    actorEmail: input.actor?.email,
    action: 'membership.freeze',
    entity: 'membership',
    entityId: membershipId,
    branchId: membership.branchId,
    meta: { days: requested, reason: input.reason ?? null },
  })

  await notify(db, {
    userId: membership.memberId,
    type: 'MEMBERSHIP_EXPIRING',
    title: 'Membership frozen',
    body: `Your membership is frozen until ${freezeEndsAt.toDateString()}. Your new end date is ${updated!.endsAt.toDateString()}.`,
    channels: ['IN_APP', 'PUSH'],
  })

  return updated!
}

export async function unfreezeMembership(
  db: Database,
  membershipId: string,
  input: { actor?: ActorInfo } = {},
): Promise<Membership> {
  const [membership] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1)
  if (!membership) throw notFound('Membership')
  if (membership.status !== 'FROZEN') throw unprocessable('This membership is not frozen')

  const now = new Date()
  // Early unfreeze only costs whole days actually used; the rest goes back in the bank.
  // Whole days are counted with floor() so unfreezing an hour after freezing is free.
  const plannedDays = membership.freezeEndsAt
    ? Math.round((membership.freezeEndsAt.getTime() - (membership.frozenAt ?? now).getTime()) / 86_400_000)
    : 0
  const usedDays = membership.frozenAt
    ? Math.max(0, Math.floor((now.getTime() - membership.frozenAt.getTime()) / 86_400_000))
    : 0
  const refundableDays = Math.max(0, plannedDays - usedDays)

  const [updated] = await db
    .update(memberships)
    .set({
      status: 'ACTIVE',
      frozenAt: null,
      freezeEndsAt: null,
      frozenDaysUsed: Math.max(0, membership.frozenDaysUsed - refundableDays),
      endsAt: new Date(membership.endsAt.getTime() - refundableDays * 86_400_000),
      updatedAt: now,
    })
    .where(eq(memberships.id, membershipId))
    .returning()

  await db.insert(membershipEvents).values({
    membershipId,
    type: 'UNFROZEN',
    fromStatus: 'FROZEN',
    toStatus: 'ACTIVE',
    note: `${usedDays} day(s) used, ${refundableDays} returned`,
    actorId: input.actor?.id ?? null,
  })

  await writeAudit(db, {
    actorId: input.actor?.id,
    actorEmail: input.actor?.email,
    action: 'membership.unfreeze',
    entity: 'membership',
    entityId: membershipId,
    branchId: membership.branchId,
    meta: { usedDays, refundableDays },
  })

  return updated!
}

export async function cancelMembership(
  db: Database,
  membershipId: string,
  input: { reason: string; immediate?: boolean; actor?: ActorInfo },
): Promise<Membership> {
  const [membership] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1)
  if (!membership) throw notFound('Membership')
  if (membership.status === 'CANCELLED') throw unprocessable('This membership is already cancelled')

  const now = new Date()
  const [updated] = await db
    .update(memberships)
    .set({
      status: 'CANCELLED',
      autoRenew: false,
      cancelledAt: now,
      cancelReason: input.reason,
      endsAt: input.immediate ? now : membership.endsAt,
      updatedAt: now,
    })
    .where(eq(memberships.id, membershipId))
    .returning()

  await db.insert(membershipEvents).values({
    membershipId,
    type: 'CANCELLED',
    fromStatus: membership.status,
    toStatus: 'CANCELLED',
    note: input.immediate ? `${input.reason} (immediate)` : `${input.reason} (at period end)`,
    actorId: input.actor?.id ?? null,
  })

  await writeAudit(db, {
    actorId: input.actor?.id,
    actorEmail: input.actor?.email,
    action: 'membership.cancel',
    entity: 'membership',
    entityId: membershipId,
    branchId: membership.branchId,
    meta: { reason: input.reason, immediate: Boolean(input.immediate) },
  })

  await notify(db, {
    userId: membership.memberId,
    type: 'MEMBERSHIP_EXPIRED',
    title: 'Membership cancelled',
    body: input.immediate
      ? 'Your membership has been cancelled today.'
      : `We cancelled your renewal. You have access until ${membership.endsAt.toDateString()}.`,
    channels: ['IN_APP', 'EMAIL'],
  })

  return updated!
}

export interface ChangePlanResult {
  membership: Membership
  invoice: typeof invoices.$inferSelect
  creditCents: number
  totalCents: number
}

export async function changePlan(
  db: Database,
  membershipId: string,
  newPlanId: string,
  input: { actor?: ActorInfo; skipPayment?: boolean; now?: Date } = {},
): Promise<ChangePlanResult> {
  const [membership] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1)
  if (!membership) throw notFound('Membership')
  const [newPlan] = await db.select().from(plans).where(eq(plans.id, newPlanId)).limit(1)
  if (!newPlan) throw notFound('Plan')
  if (!newPlan.isActive) throw unprocessable('That plan is not available')
  if (membership.planId === newPlanId) throw unprocessable('The member is already on that plan')

  const now = input.now ?? new Date()
  const creditCents = prorationCreditCents(membership.priceCents, membership.startsAt, membership.endsAt, now)
  const totals = invoiceTotals(newPlan.priceCents, creditCents)
  const newEnd = newPlan.interval === 'ONE_TIME' ? new Date(now.getTime() + 180 * 86_400_000) : nextPeriodEnd(now, newPlan.interval as PlanInterval)

  const [invoice] = await db
    .insert(invoices)
    .values({
      number: await nextInvoiceNumber(db, now),
      memberId: membership.memberId,
      membershipId: membership.id,
      branchId: membership.branchId,
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      totalCents: totals.totalCents,
      currency: newPlan.currency,
      status: 'OPEN',
      dueAt: new Date(now.getTime() + 7 * 86_400_000),
      description: `Plan change to ${newPlan.name} (credit ${(creditCents / 100).toFixed(2)})`,
    })
    .returning()

  await db
    .update(memberships)
    .set({
      planId: newPlan.id,
      status: 'PENDING',
      priceCents: totals.totalCents,
      currency: newPlan.currency,
      startsAt: now,
      endsAt: newEnd,
      autoRenew: newPlan.autoRenew,
      creditsRemaining: newPlan.classCredits,
      updatedAt: now,
    })
    .where(eq(memberships.id, membership.id))

  await db.insert(membershipEvents).values({
    membershipId: membership.id,
    type: 'CHANGED',
    fromStatus: membership.status,
    toStatus: 'PENDING',
    amountCents: totals.totalCents,
    note: `Credited ${(creditCents / 100).toFixed(2)} for unused time, new plan ${newPlan.name}`,
    actorId: input.actor?.id ?? null,
  })

  let payment: typeof payments.$inferSelect | null = null
  const idempotencyKey = `change_${membership.id}_${now.getTime()}`
  if (totals.totalCents > 0) {
    if (input.skipPayment) {
      const [created] = await db
        .insert(payments)
        .values({
          invoiceId: invoice!.id,
          memberId: membership.memberId,
          membershipId: membership.id,
          branchId: membership.branchId,
          amountCents: totals.totalCents,
          currency: newPlan.currency,
          status: 'SUCCEEDED',
          provider: 'cash',
          method: 'cash',
          providerRef: `cash_${idempotencyKey}`,
          idempotencyKey,
          paidAt: now,
        })
        .returning()
      payment = created!
      await markPaymentSucceeded(db, created!.id)
    } else {
      const charge = await createCharge({
        amountCents: totals.totalCents,
        currency: newPlan.currency,
        memberId: membership.memberId,
        invoiceId: invoice!.id,
        invoiceNumber: invoice!.number,
        description: invoice!.description ?? 'Plan change',
        idempotencyKey,
      })
      const [created] = await db
        .insert(payments)
        .values({
          invoiceId: invoice!.id,
          memberId: membership.memberId,
          membershipId: membership.id,
          branchId: membership.branchId,
          amountCents: totals.totalCents,
          currency: newPlan.currency,
          status: 'PENDING',
          provider: charge.provider,
          providerRef: charge.providerRef,
          clientSecret: charge.clientSecret,
          method: 'card',
          idempotencyKey,
        })
        .returning()
      payment = created!
      if (charge.status === 'SUCCEEDED') await markPaymentSucceeded(db, created!.id)
    }
  } else {
    // Credit covers the new plan entirely: no charge, activate straight away.
    await db.update(invoices).set({ status: 'PAID', amountPaidCents: 0, paidAt: now }).where(eq(invoices.id, invoice!.id))
    await db.update(memberships).set({ status: 'ACTIVE' }).where(eq(memberships.id, membership.id))
  }

  void payment

  await writeAudit(db, {
    actorId: input.actor?.id,
    actorEmail: input.actor?.email,
    action: 'membership.change_plan',
    entity: 'membership',
    entityId: membership.id,
    branchId: membership.branchId,
    meta: { newPlan: newPlan.name, creditCents, totalCents: totals.totalCents },
  })

  const [fresh] = await db.select().from(memberships).where(eq(memberships.id, membership.id)).limit(1)
  return { membership: fresh!, invoice: invoice!, creditCents, totalCents: totals.totalCents }
}

/* -------------------------------------------------------------------------- */
/* Queries & jobs                                                             */
/* -------------------------------------------------------------------------- */

export interface MembershipFilters {
  memberId?: string
  status?: string
  planId?: string
  branchId?: string
  expiringInDays?: number
  page?: number
  pageSize?: number
}

export async function listMemberships(db: Database, filters: MembershipFilters) {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25))

  const conditions = []
  if (filters.memberId) conditions.push(eq(memberships.memberId, filters.memberId))
  if (filters.status) conditions.push(eq(memberships.status, filters.status))
  if (filters.planId) conditions.push(eq(memberships.planId, filters.planId))
  if (filters.branchId) conditions.push(eq(memberships.branchId, filters.branchId))
  if (filters.expiringInDays) {
    conditions.push(lte(memberships.endsAt, new Date(Date.now() + filters.expiringInDays * 86_400_000)))
    conditions.push(gte(memberships.endsAt, new Date()))
  }

  const where = conditions.length ? and(...conditions) : undefined

  const rows = await db
    .select({
      id: memberships.id,
      status: memberships.status,
      startsAt: memberships.startsAt,
      endsAt: memberships.endsAt,
      priceCents: memberships.priceCents,
      autoRenew: memberships.autoRenew,
      creditsRemaining: memberships.creditsRemaining,
      frozenUntil: memberships.freezeEndsAt,
      planName: plans.name,
      planType: plans.type,
      memberId: users.id,
      memberName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      memberEmail: users.email,
    })
    .from(memberships)
    .innerJoin(plans, eq(plans.id, memberships.planId))
    .innerJoin(users, eq(users.id, memberships.memberId))
    .where(where)
    .orderBy(desc(memberships.endsAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .where(where)

  return { rows, total: countRow?.count ?? 0, page, pageSize }
}

/** Membership state that matters at the door: active, frozen, or lapsed. */
export async function getEntitlement(db: Database, memberId: string, at = new Date()) {
  const [membership] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.memberId, memberId))
    .orderBy(desc(memberships.endsAt))
    .limit(1)

  if (!membership) {
    return { membership: null, allowed: false, reason: 'No membership on file', creditsRemaining: null }
  }
  if (membership.status === 'ACTIVE' && membership.endsAt.getTime() >= at.getTime()) {
    return { membership, allowed: true, reason: 'Active membership', creditsRemaining: membership.creditsRemaining }
  }
  if (membership.status === 'FROZEN') {
    return { membership, allowed: false, reason: 'Membership frozen', creditsRemaining: membership.creditsRemaining }
  }
  if (membership.status === 'CANCELLED' && membership.endsAt.getTime() >= at.getTime()) {
    return { membership, allowed: true, reason: 'Cancelled but still in paid period', creditsRemaining: membership.creditsRemaining }
  }
  return { membership, allowed: false, reason: 'Membership expired', creditsRemaining: membership.creditsRemaining }
}

export async function getMembershipDetail(db: Database, membershipId: string): Promise<MembershipDetail> {
  const [row] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1)
  if (!row) throw notFound('Membership')

  const [plan] = await db.select().from(plans).where(eq(plans.id, row.planId)).limit(1)
  const [member] = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      branchId: users.branchId,
    })
    .from(users)
    .where(eq(users.id, row.memberId))
    .limit(1)

  if (!plan || !member) throw notFound('Membership detail')
  return { ...row, plan, member }
}

export async function membershipHistory(db: Database, membershipId: string) {
  const [events, relatedInvoices, relatedPayments] = await Promise.all([
    db
      .select()
      .from(membershipEvents)
      .where(eq(membershipEvents.membershipId, membershipId))
      .orderBy(desc(membershipEvents.createdAt)),
    db.select().from(invoices).where(eq(invoices.membershipId, membershipId)).orderBy(desc(invoices.issuedAt)),
    db.select().from(payments).where(eq(payments.membershipId, membershipId)).orderBy(desc(payments.createdAt)),
  ])
  return { events, invoices: relatedInvoices, payments: relatedPayments }
}

/**
 * Daily job: expire lapsed memberships and queue the reminder ladder
 * (7 days before expiry, on expiry, and 3 days after with a win-back nudge).
 */
export async function runMembershipSweep(db: Database, now = new Date()) {
  const expired = await db
    .update(memberships)
    .set({ status: 'EXPIRED', updatedAt: now })
    .where(
      and(
        inArray(memberships.status, ['ACTIVE', 'PENDING']),
        lte(memberships.endsAt, now),
        sql`${memberships.autoRenew} = false or ${memberships.status} = 'PENDING' or ${memberships.endsAt} < now() - interval '3 days'`,
      ),
    )
    .returning()

  for (const membership of expired) {
    await db.insert(membershipEvents).values({
      membershipId: membership.id,
      type: 'EXPIRED',
      fromStatus: 'ACTIVE',
      toStatus: 'EXPIRED',
      note: 'Automatic expiry sweep',
    })
    await notify(db, {
      userId: membership.memberId,
      type: 'MEMBERSHIP_EXPIRED',
      title: 'Your membership has expired',
      body: 'Renew in the app in two taps to keep your streak going.',
      channels: ['IN_APP', 'PUSH', 'EMAIL'],
      meta: { membershipId: membership.id },
    })
  }

  const soon = await db
    .select({
      id: memberships.id,
      memberId: memberships.memberId,
      endsAt: memberships.endsAt,
      autoRenew: memberships.autoRenew,
      planName: plans.name,
    })
    .from(memberships)
    .innerJoin(plans, eq(plans.id, memberships.planId))
    .where(
      and(
        inArray(memberships.status, ['ACTIVE']),
        gte(memberships.endsAt, now),
        lte(memberships.endsAt, new Date(now.getTime() + 7 * 86_400_000)),
      ),
    )

  for (const membership of soon) {
    await notify(db, {
      userId: membership.memberId,
      type: 'MEMBERSHIP_EXPIRING',
      title: `${membership.planName} ends soon`,
      body: membership.autoRenew
        ? `We will renew your ${membership.planName} on ${membership.endsAt.toDateString()}.`
        : `Your ${membership.planName} ends on ${membership.endsAt.toDateString()}. Renew to keep access.`,
      channels: ['IN_APP', 'PUSH'],
      meta: { membershipId: membership.id },
    })
  }

  return { expired: expired.length, expiringSoon: soon.length }
}

/** Failed-payment chase: creates a fresh attempt for invoices that are past due. */
export async function retryOverduePayments(db: Database, now = new Date()) {
  const overdue = await db
    .select({ payment: payments })
    .from(payments)
    .where(and(eq(payments.status, 'FAILED'), lte(payments.createdAt, new Date(now.getTime() - 86_400_000))))
    .limit(50)

  let retried = 0
  for (const row of overdue) {
    if (row.payment.attempts >= 3) continue
    try {
      const { retryFailedPayment } = await import('./payments')
      await retryFailedPayment(db, row.payment.id, null)
      retried++
    } catch (error) {
      console.error('[billing] retry failed', row.payment.id, error)
    }
  }
  return { retried, considered: overdue.length }
}

export async function bulkMembershipAction(
  db: Database,
  membershipIds: string[],
  action: 'freeze' | 'unfreeze' | 'cancel',
  input: { days?: number; reason?: string; actor?: ActorInfo } = {},
) {
  const results: { id: string; ok: boolean; error?: string }[] = []
  for (const id of membershipIds) {
    try {
      if (action === 'freeze') await freezeMembership(db, id, { days: input.days ?? 14, reason: input.reason, actor: input.actor })
      else if (action === 'unfreeze') await unfreezeMembership(db, id, { actor: input.actor })
      else await cancelMembership(db, id, { reason: input.reason ?? 'Bulk cancellation', actor: input.actor })
      results.push({ id, ok: true })
    } catch (error) {
      results.push({ id, ok: false, error: error instanceof Error ? error.message : 'failed' })
    }
  }
  return results
}

export function assertNotExpired(membership: Membership, at = new Date()): void {
  if (membership.endsAt.getTime() < at.getTime()) throw badRequest('That membership has already ended')
}
