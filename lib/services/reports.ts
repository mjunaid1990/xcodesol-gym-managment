import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import {
  attendance,
  bookings,
  branches,
  classSessions,
  invoices,
  memberships,
  payments,
  plans,
  users,
} from '@/lib/db/schema'

export interface ReportRange {
  from: Date
  to: Date
  branchId?: string
}

const PAID_STATUSES = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const

export interface OverviewMetrics {
  revenueCents: number
  refundedCents: number
  netRevenueCents: number
  paymentsCount: number
  failedPayments: number
  newMembers: number
  activeMembers: number
  frozenMembers: number
  expiringIn7Days: number
  cancelledInRange: number
  attendanceTotal: number
  uniqueVisitors: number
  sessionsHeld: number
  seatsBooked: number
  fillRatePercent: number
  outstandingCents: number
  outstandingInvoices: number
  averageRevenuePerMemberCents: number
  churnRatePercent: number
}

export async function overviewMetrics(db: Database, range: ReportRange): Promise<OverviewMetrics> {
  const branchFilter = range.branchId

  const [revenueRow] = await db
    .select({
      revenue: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`,
      refunded: sql<number>`coalesce(sum(${payments.refundedCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(payments)
    .where(
      and(
        inArray(payments.status, [...PAID_STATUSES]),
        gte(payments.paidAt, range.from),
        lte(payments.paidAt, range.to),
        branchFilter ? eq(payments.branchId, branchFilter) : undefined,
      ),
    )

  const [failedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(payments)
    .where(
      and(
        eq(payments.status, 'FAILED'),
        gte(payments.createdAt, range.from),
        lte(payments.createdAt, range.to),
        branchFilter ? eq(payments.branchId, branchFilter) : undefined,
      ),
    )

  const [newMembersRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.role, 'MEMBER'),
        gte(users.createdAt, range.from),
        lte(users.createdAt, range.to),
        branchFilter ? eq(users.branchId, branchFilter) : undefined,
      ),
    )

  const [membershipRow] = await db
    .select({
      active: sql<number>`count(*) filter (where ${memberships.status} = 'ACTIVE')::int`,
      frozen: sql<number>`count(*) filter (where ${memberships.status} = 'FROZEN')::int`,
      cancelled: sql<number>`count(*) filter (where ${memberships.status} = 'CANCELLED' and ${memberships.cancelledAt} between ${range.from} and ${range.to})::int`,
    })
    .from(memberships)
    .where(branchFilter ? eq(memberships.branchId, branchFilter) : undefined)

  const [expiringRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .where(
      and(
        eq(memberships.status, 'ACTIVE'),
        gte(memberships.endsAt, new Date()),
        lte(memberships.endsAt, new Date(Date.now() + 7 * 86_400_000)),
        branchFilter ? eq(memberships.branchId, branchFilter) : undefined,
      ),
    )

  const [attendanceRow] = await db
    .select({
      visits: sql<number>`count(*)::int`,
      uniqueMembers: sql<number>`count(distinct ${attendance.memberId})::int`,
    })
    .from(attendance)
    .where(
      and(
        gte(attendance.checkedInAt, range.from),
        lte(attendance.checkedInAt, range.to),
        branchFilter ? eq(attendance.branchId, branchFilter) : undefined,
      ),
    )

  const [classRow] = await db
    .select({
      sessions: sql<number>`count(*)::int`,
      capacity: sql<number>`coalesce(sum(${classSessions.capacity}), 0)::int`,
      seats: sql<number>`coalesce((select count(*)::int from bookings b join class_sessions s on s.id = b.session_id where s.starts_at between ${range.from} and ${range.to} and s.status <> 'CANCELLED' and b.status in ('BOOKED','ATTENDED') ${branchFilter ? sql`and s.branch_id = ${branchFilter}` : sql``}), 0)`,
    })
    .from(classSessions)
    .where(
      and(
        gte(classSessions.startsAt, range.from),
        lte(classSessions.startsAt, range.to),
        ne(classSessions.status, 'CANCELLED'),
        branchFilter ? eq(classSessions.branchId, branchFilter) : undefined,
      ),
    )

  const [outstandingRow] = await db
    .select({
      outstanding: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.amountPaidCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.status, 'OPEN'),
        branchFilter
          ? sql`(${invoices.branchId} = ${branchFilter} or ${invoices.branchId} is null)`
          : undefined,
      ),
    )

  const activeMembers = membershipRow?.active ?? 0
  const cancelledInRange = membershipRow?.cancelled ?? 0
  const revenueCents = revenueRow?.revenue ?? 0
  const refundedCents = revenueRow?.refunded ?? 0
  const capacity = classRow?.capacity ?? 0
  const seatsBooked = classRow?.seats ?? 0

  return {
    revenueCents,
    refundedCents,
    netRevenueCents: revenueCents - refundedCents,
    paymentsCount: revenueRow?.count ?? 0,
    failedPayments: failedRow?.count ?? 0,
    newMembers: newMembersRow?.count ?? 0,
    activeMembers,
    frozenMembers: membershipRow?.frozen ?? 0,
    expiringIn7Days: expiringRow?.count ?? 0,
    cancelledInRange,
    attendanceTotal: attendanceRow?.visits ?? 0,
    uniqueVisitors: attendanceRow?.uniqueMembers ?? 0,
    sessionsHeld: classRow?.sessions ?? 0,
    seatsBooked,
    fillRatePercent: capacity > 0 ? Math.round((seatsBooked / capacity) * 100) : 0,
    outstandingCents: outstandingRow?.outstanding ?? 0,
    outstandingInvoices: outstandingRow?.count ?? 0,
    averageRevenuePerMemberCents: activeMembers > 0 ? Math.round(revenueCents / activeMembers) : 0,
    churnRatePercent:
      activeMembers + cancelledInRange > 0
        ? Math.round((cancelledInRange / (activeMembers + cancelledInRange)) * 100)
        : 0,
  }
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildDayBuckets(from: Date, to: Date): string[] {
  const days: string[] = []
  const cursor = new Date(from)
  cursor.setUTCHours(0, 0, 0, 0)
  while (cursor <= to && days.length < 400) {
    days.push(dayKey(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

export interface TimeSeriesPoint {
  date: string
  value: number
}

export async function revenueSeries(db: Database, range: ReportRange): Promise<TimeSeriesPoint[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${payments.paidAt}), 'YYYY-MM-DD')`,
      total: sql<number>`coalesce(sum(${payments.amountCents} - ${payments.refundedCents}), 0)::int`,
    })
    .from(payments)
    .where(
      and(
        inArray(payments.status, [...PAID_STATUSES]),
        gte(payments.paidAt, range.from),
        lte(payments.paidAt, range.to),
        range.branchId ? eq(payments.branchId, range.branchId) : undefined,
      ),
    )
    .groupBy(sql`date_trunc('day', ${payments.paidAt})`)
    .orderBy(asc(sql`date_trunc('day', ${payments.paidAt})`))

  const map = new Map(rows.map((row) => [row.day, row.total]))
  return buildDayBuckets(range.from, range.to).map((date) => ({ date, value: map.get(date) ?? 0 }))
}

export async function signupSeries(db: Database, range: ReportRange): Promise<TimeSeriesPoint[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${users.createdAt}), 'YYYY-MM-DD')`,
      total: sql<number>`count(*)::int`,
    })
    .from(users)
    .where(
      and(
        eq(users.role, 'MEMBER'),
        gte(users.createdAt, range.from),
        lte(users.createdAt, range.to),
        range.branchId ? eq(users.branchId, range.branchId) : undefined,
      ),
    )
    .groupBy(sql`date_trunc('day', ${users.createdAt})`)
    .orderBy(asc(sql`date_trunc('day', ${users.createdAt})`))

  const map = new Map(rows.map((row) => [row.day, row.total]))
  return buildDayBuckets(range.from, range.to).map((date) => ({ date, value: map.get(date) ?? 0 }))
}

export async function attendanceSeries(db: Database, range: ReportRange): Promise<TimeSeriesPoint[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${attendance.checkedInAt}), 'YYYY-MM-DD')`,
      total: sql<number>`count(*)::int`,
    })
    .from(attendance)
    .where(
      and(
        gte(attendance.checkedInAt, range.from),
        lte(attendance.checkedInAt, range.to),
        range.branchId ? eq(attendance.branchId, range.branchId) : undefined,
      ),
    )
    .groupBy(sql`date_trunc('day', ${attendance.checkedInAt})`)
    .orderBy(asc(sql`date_trunc('day', ${attendance.checkedInAt})`))

  const map = new Map(rows.map((row) => [row.day, row.total]))
  return buildDayBuckets(range.from, range.to).map((date) => ({ date, value: map.get(date) ?? 0 }))
}

export interface HourBucket {
  hour: number
  visits: number
}

/** Peak hours: check-ins grouped by hour of day (gym local time approximated as UTC). */
export async function peakHours(db: Database, range: ReportRange): Promise<HourBucket[]> {
  const rows = await db
    .select({
      hour: sql<number>`extract(hour from ${attendance.checkedInAt})::int`,
      visits: sql<number>`count(*)::int`,
    })
    .from(attendance)
    .where(
      and(
        gte(attendance.checkedInAt, range.from),
        lte(attendance.checkedInAt, range.to),
        range.branchId ? eq(attendance.branchId, range.branchId) : undefined,
      ),
    )
    .groupBy(sql`extract(hour from ${attendance.checkedInAt})`)

  const map = new Map(rows.map((row) => [row.hour, row.visits]))
  return Array.from({ length: 24 }, (_, hour) => ({ hour, visits: map.get(hour) ?? 0 }))
}

export interface ClassUtilizationRow {
  sessionId: string
  title: string
  startsAt: Date
  branchName: string | null
  trainerName: string | null
  capacity: number
  booked: number
  attended: number
  noShows: number
  waitlisted: number
  fillPercent: number
}

export async function classUtilization(db: Database, range: ReportRange, limit = 25): Promise<ClassUtilizationRow[]> {
  const rows = await db
    .select({
      sessionId: classSessions.id,
      title: classSessions.title,
      startsAt: classSessions.startsAt,
      branchName: branches.name,
      trainerName: sql<string | null>`(select u.first_name || ' ' || u.last_name from users u where u.id = class_sessions.trainer_id)`,
      capacity: classSessions.capacity,
      booked: sql<number>`(select count(*)::int from bookings b where b.session_id = class_sessions.id and b.status in ('BOOKED','ATTENDED'))`,
      attended: sql<number>`(select count(*)::int from bookings b where b.session_id = class_sessions.id and b.status = 'ATTENDED')`,
      noShows: sql<number>`(select count(*)::int from bookings b where b.session_id = class_sessions.id and b.status = 'NO_SHOW')`,
      waitlisted: sql<number>`(select count(*)::int from bookings b where b.session_id = class_sessions.id and b.status = 'WAITLISTED')`,
      fillPercent: sql<number>`case when ${classSessions.capacity} = 0 then 0 else round(100.0 * (select count(*) from bookings b where b.session_id = class_sessions.id and b.status in ('BOOKED','ATTENDED')) / ${classSessions.capacity})::int end`,
    })
    .from(classSessions)
    .leftJoin(branches, eq(branches.id, classSessions.branchId))
    .where(
      and(
        gte(classSessions.startsAt, range.from),
        lte(classSessions.startsAt, range.to),
        ne(classSessions.status, 'CANCELLED'),
        range.branchId ? eq(classSessions.branchId, range.branchId) : undefined,
      ),
    )
    .orderBy(desc(sql`case when ${classSessions.capacity} = 0 then 0 else (select count(*) from bookings b where b.session_id = class_sessions.id and b.status in ('BOOKED','ATTENDED')) / ${classSessions.capacity} end`))
    .limit(limit)

  return rows
}

export interface TrainerPerformanceRow {
  trainerId: string
  name: string
  sessions: number
  hours: number
  attendees: number
  noShows: number
  averageFillPercent: number
}

export async function trainerPerformance(db: Database, range: ReportRange): Promise<TrainerPerformanceRow[]> {
  const rows = await db
    .select({
      trainerId: users.id,
      name: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      sessions: sql<number>`count(distinct ${classSessions.id})::int`,
      minutes: sql<number>`coalesce(sum(extract(epoch from (${classSessions.endsAt} - ${classSessions.startsAt})) / 60), 0)::int`,
      capacity: sql<number>`coalesce(sum(${classSessions.capacity}), 0)::int`,
      attendees: sql<number>`coalesce((select count(*)::int from bookings b join class_sessions s2 on s2.id = b.session_id where s2.trainer_id = users.id and b.status = 'ATTENDED' and s2.starts_at between ${range.from} and ${range.to}), 0)`,
      noShows: sql<number>`coalesce((select count(*)::int from bookings b join class_sessions s2 on s2.id = b.session_id where s2.trainer_id = users.id and b.status = 'NO_SHOW' and s2.starts_at between ${range.from} and ${range.to}), 0)`,
      booked: sql<number>`coalesce((select count(*)::int from bookings b join class_sessions s2 on s2.id = b.session_id where s2.trainer_id = users.id and b.status in ('BOOKED','ATTENDED') and s2.starts_at between ${range.from} and ${range.to}), 0)`,
    })
    .from(users)
    .leftJoin(
      classSessions,
      and(
        eq(classSessions.trainerId, users.id),
        gte(classSessions.startsAt, range.from),
        lte(classSessions.startsAt, range.to),
        ne(classSessions.status, 'CANCELLED'),
      ),
    )
    .where(eq(users.role, 'TRAINER'))
    .groupBy(users.id, users.firstName, users.lastName)
    .orderBy(desc(sql`count(distinct ${classSessions.id})`))

  return rows.map((row) => ({
    trainerId: row.trainerId,
    name: row.name,
    sessions: row.sessions,
    hours: Number((row.minutes / 60).toFixed(2)),
    attendees: row.attendees,
    noShows: row.noShows,
    averageFillPercent: row.capacity > 0 ? Math.round((row.booked / row.capacity) * 100) : 0,
  }))
}

export interface OutstandingInvoiceRow {
  id: string
  number: string
  memberId: string
  memberName: string
  memberEmail: string
  totalCents: number
  outstandingCents: number
  issuedAt: Date
  dueAt: Date
  ageDays: number
  description: string | null
}

export async function outstandingInvoices(db: Database, branchId?: string): Promise<OutstandingInvoiceRow[]> {
  return db
    .select({
      id: invoices.id,
      number: invoices.number,
      memberId: users.id,
      memberName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      memberEmail: users.email,
      totalCents: invoices.totalCents,
      outstandingCents: sql<number>`(${invoices.totalCents} - ${invoices.amountPaidCents})::int`,
      issuedAt: invoices.issuedAt,
      dueAt: invoices.dueAt,
      ageDays: sql<number>`greatest(0, extract(day from now() - ${invoices.issuedAt}))::int`,
      description: invoices.description,
    })
    .from(invoices)
    .innerJoin(users, eq(users.id, invoices.memberId))
    .where(
      and(
        eq(invoices.status, 'OPEN'),
        branchId ? sql`(${invoices.branchId} = ${branchId} or ${invoices.branchId} is null)` : undefined,
      ),
    )
    .orderBy(asc(invoices.dueAt))
    .limit(200)
}

export interface CohortRow {
  cohort: string
  signedUp: number
  retained: number
  retentionPercent: number
}

/**
 * Simple retention cohorts: group members by the month they joined, then count how many
 * have visited in the last 30 days. Good enough to trend, cheap to compute.
 */
export async function retentionCohorts(db: Database, months = 12): Promise<CohortRow[]> {
  const rows = await db
    .select({
      cohort: sql<string>`to_char(date_trunc('month', ${users.createdAt}), 'YYYY-MM')`,
      signedUp: sql<number>`count(*)::int`,
      retained: sql<number>`count(*) filter (where exists (select 1 from attendance a where a.member_id = users.id and a.checked_in_at > now() - interval '30 days'))::int`,
    })
    .from(users)
    .where(and(eq(users.role, 'MEMBER'), sql`${users.createdAt} > now() - (${months} * interval '1 month')`))
    .groupBy(sql`date_trunc('month', ${users.createdAt})`)
    .orderBy(asc(sql`date_trunc('month', ${users.createdAt})`))

  return rows.map((row) => ({
    cohort: row.cohort,
    signedUp: row.signedUp,
    retained: row.retained,
    retentionPercent: row.signedUp > 0 ? Math.round((row.retained / row.signedUp) * 100) : 0,
  }))
}

export interface MembershipMixRow {
  planId: string
  planName: string
  planType: string
  active: number
  revenueCents: number
}

export async function membershipMix(db: Database, range: ReportRange): Promise<MembershipMixRow[]> {
  return db
    .select({
      planId: plans.id,
      planName: plans.name,
      planType: plans.type,
      active: sql<number>`(select count(*)::int from memberships m where m.plan_id = plans.id and m.status in ('ACTIVE','FROZEN'))`,
      revenueCents: sql<number>`coalesce((select sum(p.amount_cents)::int from payments p join memberships m on m.id = p.membership_id where m.plan_id = plans.id and p.status in ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') and p.paid_at between ${range.from} and ${range.to}), 0)`,
    })
    .from(plans)
    .orderBy(desc(sql`(select count(*) from memberships m where m.plan_id = plans.id and m.status in ('ACTIVE','FROZEN'))`))
}

/** Everything the dashboard home renders, in one call. */
export async function dashboardPayload(db: Database, range: ReportRange) {
  const [metrics, revenue, signups, visits, utilisation, trainers, outstanding, mix] = await Promise.all([
    overviewMetrics(db, range),
    revenueSeries(db, range),
    signupSeries(db, range),
    attendanceSeries(db, range),
    classUtilization(db, range, 6),
    trainerPerformance(db, range),
    outstandingInvoices(db, range.branchId),
    membershipMix(db, range),
  ])

  return { metrics, revenue, signups, visits, utilisation, trainers, outstanding, mix }
}

/* -------------------------------------------------------------------------- */
/* CSV export row builders                                                     */
/* -------------------------------------------------------------------------- */

export async function paymentExportRows(db: Database, range: ReportRange) {
  const rows = await db
    .select({
      paidAt: payments.paidAt,
      invoice: invoices.number,
      member: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      email: users.email,
      amountCents: payments.amountCents,
      refundedCents: payments.refundedCents,
      currency: payments.currency,
      status: payments.status,
      provider: payments.provider,
      method: payments.method,
      branch: branches.name,
    })
    .from(payments)
    .innerJoin(users, eq(users.id, payments.memberId))
    .leftJoin(invoices, eq(invoices.id, payments.invoiceId))
    .leftJoin(branches, eq(branches.id, payments.branchId))
    .where(
      and(
        gte(payments.createdAt, range.from),
        lte(payments.createdAt, range.to),
        range.branchId ? eq(payments.branchId, range.branchId) : undefined,
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(10_000)

  return rows.map((row) => ({
    date: (row.paidAt ?? new Date()).toISOString().slice(0, 10),
    invoice: row.invoice ?? '',
    member: row.member,
    email: row.email,
    amount: (row.amountCents / 100).toFixed(2),
    refunded: (row.refundedCents / 100).toFixed(2),
    currency: row.currency,
    status: row.status,
    provider: row.provider,
    method: row.method ?? '',
    branch: row.branch ?? '',
  }))
}

export async function attendanceExportRows(db: Database, range: ReportRange) {
  const rows = await db
    .select({
      checkedInAt: attendance.checkedInAt,
      member: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      email: users.email,
      method: attendance.method,
      branch: branches.name,
      session: classSessions.title,
    })
    .from(attendance)
    .innerJoin(users, eq(users.id, attendance.memberId))
    .leftJoin(branches, eq(branches.id, attendance.branchId))
    .leftJoin(classSessions, eq(classSessions.id, attendance.sessionId))
    .where(
      and(
        gte(attendance.checkedInAt, range.from),
        lte(attendance.checkedInAt, range.to),
        range.branchId ? eq(attendance.branchId, range.branchId) : undefined,
      ),
    )
    .orderBy(desc(attendance.checkedInAt))
    .limit(10_000)

  return rows.map((row) => ({
    date: row.checkedInAt.toISOString().slice(0, 16).replace('T', ' '),
    member: row.member,
    email: row.email,
    method: row.method,
    branch: row.branch ?? '',
    class: row.session ?? 'Gym floor',
  }))
}

export async function classExportRows(db: Database, range: ReportRange) {
  const rows = await classUtilization(db, range, 500)
  return rows.map((row) => ({
    date: row.startsAt.toISOString().slice(0, 16).replace('T', ' '),
    class: row.title,
    trainer: row.trainerName ?? '',
    branch: row.branchName ?? '',
    capacity: row.capacity,
    booked: row.booked,
    attended: row.attended,
    noShows: row.noShows,
    waitlisted: row.waitlisted,
    fillPercent: row.fillPercent,
  }))
}

export async function bookingExportRows(db: Database, range: ReportRange) {
  const rows = await db
    .select({
      sessionTitle: classSessions.title,
      startsAt: classSessions.startsAt,
      member: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      email: users.email,
      status: bookings.status,
      lateCancel: bookings.lateCancel,
      bookedAt: bookings.bookedAt,
    })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .innerJoin(users, eq(users.id, bookings.memberId))
    .where(
      and(
        gte(classSessions.startsAt, range.from),
        lte(classSessions.startsAt, range.to),
        range.branchId ? eq(classSessions.branchId, range.branchId) : undefined,
      ),
    )
    .orderBy(desc(classSessions.startsAt))
    .limit(10_000)

  return rows.map((row) => ({
    date: row.startsAt.toISOString().slice(0, 16).replace('T', ' '),
    class: row.sessionTitle,
    member: row.member,
    email: row.email,
    status: row.status,
    lateCancel: row.lateCancel ? 'yes' : 'no',
    bookedAt: row.bookedAt.toISOString().slice(0, 16).replace('T', ' '),
  }))
}

export function buildRange(from?: string | null, to?: string | null, defaultDays = 30): ReportRange {
  const toDate = to ? new Date(to) : new Date()
  toDate.setUTCHours(23, 59, 59, 999)
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - defaultDays * 86_400_000)
  fromDate.setUTCHours(0, 0, 0, 0)
  return { from: fromDate, to: toDate }
}
