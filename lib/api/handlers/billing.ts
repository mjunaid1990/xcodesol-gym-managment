import { z } from 'zod'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { created, notFound, ok, readJson, readQuery } from '@/lib/api/http'
import {
  changePlan,
  cancelMembership,
  freezeMembership,
  getMembershipDetail,
  listMemberships,
  membershipHistory,
  purchaseMembership,
  renewMembership,
  unfreezeMembership,
} from '@/lib/services/memberships'
import { refundPayment, retryFailedPayment } from '@/lib/services/payments'
import { discounts, invoices, memberships, payments, plans, users } from '@/lib/db/schema'
import {
  discountSchema,
  membershipActionSchema,
  membershipPurchaseSchema,
  planSchema,
  refundSchema,
} from '@/lib/api/schemas'
import type { ApiContext } from '@/lib/api/context'
import { actorOf } from './members'

/* ---------------------------------- plans --------------------------------- */

export async function handleListPlans(ctx: ApiContext) {
  const includeInactive = ctx.query.get('includeInactive') === 'true'
  const rows = await ctx.db
    .select({
      id: plans.id,
      name: plans.name,
      description: plans.description,
      type: plans.type,
      interval: plans.interval,
      priceCents: plans.priceCents,
      currency: plans.currency,
      classCredits: plans.classCredits,
      freezeDaysPerYear: plans.freezeDaysPerYear,
      autoRenew: plans.autoRenew,
      isActive: plans.isActive,
      branchId: plans.branchId,
      sortOrder: plans.sortOrder,
      activeMembers: sql<number>`(select count(*)::int from memberships m where m.plan_id = plans.id and m.status in ('ACTIVE','FROZEN'))`,
    })
    .from(plans)
    .where(includeInactive ? undefined : eq(plans.isActive, true))
    .orderBy(plans.sortOrder, plans.priceCents)
  return { data: rows }
}

export async function handleCreatePlan(ctx: ApiContext) {
  const body = await readJson(ctx.request, planSchema)
  const [plan] = await ctx.db.insert(plans).values({ ...body }).returning()
  const { writeAudit } = await import('@/lib/services/audit')
  await writeAudit(ctx.db, {
    ...actorOf(ctx),
    action: 'plan.create',
    entity: 'plan',
    entityId: plan!.id,
    branchId: plan!.branchId,
    meta: { name: plan!.name, priceCents: plan!.priceCents },
  })
  return created(plan)
}

export async function handleUpdatePlan(ctx: ApiContext) {
  const body = await readJson(ctx.request, planSchema.partial())
  const [plan] = await ctx.db
    .update(plans)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(plans.id, ctx.params.id!))
    .returning()
  if (!plan) throw notFound('Plan')
  const { writeAudit } = await import('@/lib/services/audit')
  await writeAudit(ctx.db, {
    ...actorOf(ctx),
    action: 'plan.update',
    entity: 'plan',
    entityId: plan.id,
    branchId: plan.branchId,
    meta: { fields: Object.keys(body) },
  })
  return { data: plan }
}

export async function handleListDiscounts(ctx: ApiContext) {
  const rows = await ctx.db.select().from(discounts).orderBy(desc(discounts.createdAt)).limit(100)
  return { data: rows }
}

export async function handleCreateDiscount(ctx: ApiContext) {
  const body = await readJson(ctx.request, discountSchema)
  const [discount] = await ctx.db
    .insert(discounts)
    .values({
      code: body.code,
      description: body.description,
      percentOff: body.percentOff ?? null,
      amountOffCents: body.amountOffCents ?? null,
      validFrom: body.validFrom ? new Date(body.validFrom) : null,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      maxRedemptions: body.maxRedemptions ?? null,
      isActive: body.isActive ?? true,
    })
    .returning()
  const { writeAudit } = await import('@/lib/services/audit')
  await writeAudit(ctx.db, { ...actorOf(ctx), action: 'discount.create', entity: 'discount', entityId: discount!.id })
  return created(discount)
}

export async function handleUpdateDiscount(ctx: ApiContext) {
  const body = await readJson(ctx.request, discountSchema.partial())
  const [discount] = await ctx.db
    .update(discounts)
    .set({
      ...body,
      validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
      validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
    })
    .where(eq(discounts.id, ctx.params.id!))
    .returning()
  if (!discount) throw notFound('Discount')
  const { writeAudit } = await import('@/lib/services/audit')
  await writeAudit(ctx.db, {
    ...actorOf(ctx),
    action: 'discount.update',
    entity: 'discount',
    entityId: discount.id,
    meta: { fields: Object.keys(body) },
  })
  return { data: discount }
}

/* ------------------------------- memberships ------------------------------ */

export async function handleListMemberships(ctx: ApiContext) {
  const result = await listMemberships(ctx.db, {
    memberId: ctx.query.get('memberId') ?? undefined,
    status: ctx.query.get('status') ?? undefined,
    planId: ctx.query.get('planId') ?? undefined,
    branchId: ctx.query.get('branchId') ?? undefined,
    expiringInDays: ctx.query.get('expiringInDays') ? Number(ctx.query.get('expiringInDays')) : undefined,
    page: ctx.query.get('page') ? Number(ctx.query.get('page')) : undefined,
    pageSize: ctx.query.get('pageSize') ? Number(ctx.query.get('pageSize')) : undefined,
  })
  return { data: result }
}

export async function handleGetMembership(ctx: ApiContext) {
  const detail = await getMembershipDetail(ctx.db, ctx.params.id!)
  const history = await membershipHistory(ctx.db, ctx.params.id!)
  return { data: { ...detail, history } }
}

export async function handlePurchaseMembership(ctx: ApiContext) {
  const body = await readJson(ctx.request, membershipPurchaseSchema)
  const result = await purchaseMembership(ctx.db, {
    memberId: body.memberId,
    planId: body.planId,
    discountCode: body.discountCode,
    autoRenew: body.autoRenew,
    skipPayment: body.skipPayment,
    startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
    actor: actorOf(ctx),
  })
  return created({
    membership: result.membership,
    invoice: result.invoice,
    payment: result.payment,
    clientSecret: result.clientSecret,
    totalCents: result.totalCents,
  })
}

export async function handleMembershipAction(ctx: ApiContext) {
  const body = await readJson(ctx.request, membershipActionSchema)
  const id = ctx.params.id!
  switch (body.action) {
    case 'renew': {
      const result = await renewMembership(ctx.db, id, {
        actor: actorOf(ctx),
        skipPayment: body.skipPayment,
        discountCode: body.discountCode,
      })
      return { data: { membership: result.membership, invoice: result.invoice, clientSecret: result.clientSecret } }
    }
    case 'freeze':
      return { data: await freezeMembership(ctx.db, id, { days: body.days, reason: body.reason, actor: actorOf(ctx) }) }
    case 'unfreeze':
      return { data: await unfreezeMembership(ctx.db, id, { actor: actorOf(ctx) }) }
    case 'cancel':
      return {
        data: await cancelMembership(ctx.db, id, { reason: body.reason, immediate: body.immediate, actor: actorOf(ctx) }),
      }
    case 'change-plan': {
      const result = await changePlan(ctx.db, id, body.newPlanId, {
        actor: actorOf(ctx),
        skipPayment: body.skipPayment,
      })
      return { data: result }
    }
  }
}

/* ---------------------------- payments & invoices -------------------------- */

export async function handleListPayments(ctx: ApiContext) {
  const conditions = []
  const status = ctx.query.get('status')
  const branchId = ctx.query.get('branchId')
  const memberId = ctx.query.get('memberId')
  const from = ctx.query.get('from')
  const to = ctx.query.get('to')
  if (status) conditions.push(eq(payments.status, status))
  if (branchId) conditions.push(eq(payments.branchId, branchId))
  if (memberId) conditions.push(eq(payments.memberId, memberId))
  if (from) conditions.push(gte(payments.createdAt, new Date(from)))
  if (to) conditions.push(lte(payments.createdAt, new Date(to)))

  const limit = Math.min(200, Number(ctx.query.get('limit') ?? 50))
  const rows = await ctx.db
    .select({
      id: payments.id,
      amountCents: payments.amountCents,
      refundedCents: payments.refundedCents,
      currency: payments.currency,
      status: payments.status,
      provider: payments.provider,
      method: payments.method,
      failureReason: payments.failureReason,
      attempts: payments.attempts,
      createdAt: payments.createdAt,
      paidAt: payments.paidAt,
      invoiceNumber: invoices.number,
      invoiceId: invoices.id,
      memberId: users.id,
      memberName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      memberEmail: users.email,
    })
    .from(payments)
    .innerJoin(users, eq(users.id, payments.memberId))
    .leftJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(limit)

  const [totals] = await ctx.db
    .select({
      collected: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} in ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')), 0)::int`,
      refunded: sql<number>`coalesce(sum(${payments.refundedCents}), 0)::int`,
      failed: sql<number>`count(*) filter (where ${payments.status} = 'FAILED')::int`,
      pending: sql<number>`count(*) filter (where ${payments.status} = 'PENDING')::int`,
    })
    .from(payments)
    .where(conditions.length ? and(...conditions) : undefined)

  return { data: { rows, totals } }
}

export async function handleGetPayment(ctx: ApiContext) {
  const [row] = await ctx.db.select().from(payments).where(eq(payments.id, ctx.params.id!)).limit(1)
  if (!row) throw notFound('Payment')
  const { refunds } = await import('@/lib/db/schema')
  const refundRows = await ctx.db.select().from(refunds).where(eq(refunds.paymentId, row.id)).orderBy(desc(refunds.createdAt))
  return { data: { ...row, refunds: refundRows } }
}

export async function handleRefundPayment(ctx: ApiContext) {
  const body = await readJson(ctx.request, refundSchema)
  const result = await refundPayment(ctx.db, {
    paymentId: ctx.params.id!,
    amountCents: body.amountCents,
    reason: body.reason,
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
  })
  return { data: result }
}

export async function handleRetryPayment(ctx: ApiContext) {
  const payment = await retryFailedPayment(ctx.db, ctx.params.id!, ctx.user?.id)
  return { data: payment }
}

export async function handleListInvoices(ctx: ApiContext) {
  const conditions = []
  const status = ctx.query.get('status')
  const memberId = ctx.query.get('memberId')
  const branchId = ctx.query.get('branchId')
  if (status) conditions.push(eq(invoices.status, status))
  if (memberId) conditions.push(eq(invoices.memberId, memberId))
  if (branchId) conditions.push(eq(invoices.branchId, branchId))

  const rows = await ctx.db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      totalCents: invoices.totalCents,
      amountPaidCents: invoices.amountPaidCents,
      currency: invoices.currency,
      issuedAt: invoices.issuedAt,
      dueAt: invoices.dueAt,
      paidAt: invoices.paidAt,
      description: invoices.description,
      memberId: users.id,
      memberName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      memberEmail: users.email,
    })
    .from(invoices)
    .innerJoin(users, eq(users.id, invoices.memberId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(invoices.issuedAt))
    .limit(Math.min(200, Number(ctx.query.get('limit') ?? 50)))

  const [totals] = await ctx.db
    .select({
      open: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.amountPaidCents}) filter (where ${invoices.status} = 'OPEN'), 0)::int`,
      paid: sql<number>`coalesce(sum(${invoices.amountPaidCents}), 0)::int`,
      overdue: sql<number>`count(*) filter (where ${invoices.status} = 'OPEN' and ${invoices.dueAt} < now())::int`,
    })
    .from(invoices)
    .where(conditions.length ? and(...conditions) : undefined)

  return { data: { rows, totals } }
}

export async function handleGetInvoice(ctx: ApiContext) {
  const [row] = await ctx.db.select().from(invoices).where(eq(invoices.id, ctx.params.id!)).limit(1)
  if (!row) throw notFound('Invoice')
  const [member] = await ctx.db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, row.memberId))
    .limit(1)
  const paymentRows = await ctx.db.select().from(payments).where(eq(payments.invoiceId, row.id))
  return { data: { ...row, member: member ?? null, payments: paymentRows } }
}

export async function handleMarkInvoicePaid(ctx: ApiContext) {
  const body = await readJson(
    ctx.request,
    z.object({ method: z.enum(['cash', 'terminal', 'transfer']).default('cash'), amountCents: z.coerce.number().int().min(1).optional() }),
  )
  const [invoice] = await ctx.db.select().from(invoices).where(eq(invoices.id, ctx.params.id!)).limit(1)
  if (!invoice) throw notFound('Invoice')

  const amount = body.amountCents ?? invoice.totalCents - invoice.amountPaidCents
  const [payment] = await ctx.db
    .insert(payments)
    .values({
      invoiceId: invoice.id,
      memberId: invoice.memberId,
      membershipId: invoice.membershipId,
      branchId: invoice.branchId,
      amountCents: amount,
      currency: invoice.currency,
      status: 'SUCCEEDED',
      provider: body.method,
      method: body.method,
      providerRef: `offline_${invoice.number}_${Date.now()}`,
      paidAt: new Date(),
      attempts: 1,
    })
    .returning()

  await ctx.db
    .update(invoices)
    .set({ status: 'PAID', paidAt: new Date(), amountPaidCents: invoice.amountPaidCents + amount })
    .where(eq(invoices.id, invoice.id))

  const { writeAudit } = await import('@/lib/services/audit')
  await writeAudit(ctx.db, {
    ...actorOf(ctx),
    action: 'invoice.mark_paid',
    entity: 'invoice',
    entityId: invoice.id,
    branchId: invoice.branchId,
    meta: { method: body.method, amountCents: amount },
  })

  return ok({ payment, invoiceId: invoice.id })
}

export async function handleVoidInvoice(ctx: ApiContext) {
  const [invoice] = await ctx.db
    .update(invoices)
    .set({ status: 'VOID' })
    .where(eq(invoices.id, ctx.params.id!))
    .returning()
  if (!invoice) throw notFound('Invoice')
  const { writeAudit } = await import('@/lib/services/audit')
  await writeAudit(ctx.db, { ...actorOf(ctx), action: 'invoice.void', entity: 'invoice', entityId: invoice.id })
  return ok(invoice)
}

export async function handleMemberMembershipSelf(ctx: ApiContext) {
  const memberId = ctx.user!.id
  const [row] = await ctx.db
    .select({ membership: memberships, plan: plans })
    .from(memberships)
    .innerJoin(plans, eq(plans.id, memberships.planId))
    .where(eq(memberships.memberId, memberId))
    .orderBy(desc(memberships.endsAt))
    .limit(1)

  if (!row) return { data: { membership: null, plan: null } }
  return { data: { membership: row.membership, plan: row.plan } }
}

export async function handleUpcomingRenewals(ctx: ApiContext) {
  const rows = await ctx.db
    .select({
      membershipId: memberships.id,
      status: memberships.status,
      endsAt: memberships.endsAt,
      autoRenew: memberships.autoRenew,
      planName: plans.name,
      priceCents: plans.priceCents,
      memberId: users.id,
      memberName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      memberEmail: users.email,
    })
    .from(memberships)
    .innerJoin(plans, eq(plans.id, memberships.planId))
    .innerJoin(users, eq(users.id, memberships.memberId))
    .where(
      and(
        eq(memberships.status, 'ACTIVE'),
        gte(memberships.endsAt, new Date()),
        lte(memberships.endsAt, new Date(Date.now() + 14 * 86_400_000)),
      ),
    )
    .orderBy(memberships.endsAt)
    .limit(100)
  return { data: rows }
}

export async function handleExpiringMembershipsByPlan(ctx: ApiContext) {
  const rows = await ctx.db
    .select({ planName: plans.name, count: sql<number>`count(*)::int` })
    .from(memberships)
    .innerJoin(plans, eq(plans.id, memberships.planId))
    .where(
      and(
        eq(memberships.status, 'ACTIVE'),
        lte(memberships.endsAt, new Date(Date.now() + 30 * 86_400_000)),
        gte(memberships.endsAt, new Date()),
      ),
    )
    .groupBy(plans.name)
  return { data: rows }
}
