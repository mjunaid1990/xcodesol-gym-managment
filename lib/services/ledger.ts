import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { invoices, memberships, payments, plans, users } from '@/lib/db/schema'

export interface PaymentFilters {
  status?: string
  branchId?: string
  memberId?: string
  from?: Date
  to?: Date
  limit?: number
}

/** Payments with member + invoice context and headline totals for the filter set. */
export async function listPaymentsForAdmin(db: Database, filters: PaymentFilters = {}) {
  const conditions = []
  if (filters.status) conditions.push(eq(payments.status, filters.status))
  if (filters.branchId) conditions.push(eq(payments.branchId, filters.branchId))
  if (filters.memberId) conditions.push(eq(payments.memberId, filters.memberId))
  if (filters.from) conditions.push(gte(payments.createdAt, filters.from))
  if (filters.to) conditions.push(lte(payments.createdAt, filters.to))

  const where = conditions.length ? and(...conditions) : undefined

  const rows = await db
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
    .where(where)
    .orderBy(desc(payments.createdAt))
    .limit(Math.min(200, filters.limit ?? 50))

  const [totals] = await db
    .select({
      collected: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} in ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')), 0)::int`,
      refunded: sql<number>`coalesce(sum(${payments.refundedCents}), 0)::int`,
      failed: sql<number>`count(*) filter (where ${payments.status} = 'FAILED')::int`,
      pending: sql<number>`count(*) filter (where ${payments.status} = 'PENDING')::int`,
    })
    .from(payments)
    .where(where)

  return { rows, totals: totals ?? { collected: 0, refunded: 0, failed: 0, pending: 0 } }
}

export async function listInvoicesForAdmin(
  db: Database,
  filters: { status?: string; branchId?: string; memberId?: string; limit?: number } = {},
) {
  const conditions = []
  if (filters.status) conditions.push(eq(invoices.status, filters.status))
  else conditions.push(eq(invoices.status, 'OPEN'))
  if (filters.branchId) conditions.push(eq(invoices.branchId, filters.branchId))
  if (filters.memberId) conditions.push(eq(invoices.memberId, filters.memberId))

  const where = and(...conditions)

  const rows = await db
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
    .where(where)
    .orderBy(asc(invoices.dueAt))
    .limit(Math.min(200, filters.limit ?? 25))

  const [totals] = await db
    .select({
      open: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.amountPaidCents}) filter (where ${invoices.status} = 'OPEN'), 0)::int`,
      paid: sql<number>`coalesce(sum(${invoices.amountPaidCents}), 0)::int`,
      overdue: sql<number>`count(*) filter (where ${invoices.status} = 'OPEN' and ${invoices.dueAt} < now())::int`,
    })
    .from(invoices)
    .where(filters.branchId ? eq(invoices.branchId, filters.branchId) : undefined)

  return { rows, totals: totals ?? { open: 0, paid: 0, overdue: 0 } }
}

export async function listUpcomingRenewals(db: Database, limit = 10) {
  return db
    .select({
      id: memberships.id,
      memberId: memberships.memberId,
      memberName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      planName: plans.name,
      endsAt: memberships.endsAt,
      autoRenew: memberships.autoRenew,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.memberId))
    .innerJoin(plans, eq(plans.id, memberships.planId))
    .where(
      and(
        eq(memberships.status, 'ACTIVE'),
        gte(memberships.endsAt, new Date()),
        lte(memberships.endsAt, new Date(Date.now() + 14 * 86_400_000)),
      ),
    )
    .orderBy(asc(memberships.endsAt))
    .limit(limit)
}
