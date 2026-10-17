import { z } from 'zod'
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { created, ok, readJson, readQuery } from '@/lib/api/http'
import {
  announcementDeliveryStats,
  createAnnouncement,
  listAnnouncements,
  sendAnnouncement,
  updateAnnouncement,
} from '@/lib/services/announcements'
import { createStaff, listStaff, payrollHours, staffSchedule, updateStaff } from '@/lib/services/staff'
import {
  attendanceExportRows,
  bookingExportRows,
  buildRange,
  classExportRows,
  dashboardPayload,
  membershipMix,
  outstandingInvoices,
  paymentExportRows,
  peakHours,
  retentionCohorts,
  trainerPerformance,
  classUtilization,
} from '@/lib/services/reports'
import { getSettingSections, updateSettings } from '@/lib/services/settings'
import { listRooms, listTrainers } from '@/lib/services/scheduling'
import { auditLogs, branches, users } from '@/lib/db/schema'
import { announcementSchema, staffCreateSchema } from '@/lib/api/schemas'
import type { ApiContext } from '@/lib/api/context'
import { actorOf } from './members'

/* -------------------------------- reference -------------------------------- */

export async function handleListBranches(ctx: ApiContext) {
  const rows = await ctx.db.select().from(branches).orderBy(asc(branches.name))
  return { data: rows }
}

export async function handleCreateBranch(ctx: ApiContext) {
  const body = await readJson(
    ctx.request,
    z.object({
      name: z.string().trim().min(2).max(120),
      slug: z.string().trim().min(2).max(60),
      addressLine: z.string().max(200).optional(),
      city: z.string().max(120).optional(),
      timezone: z.string().max(60).optional(),
      phone: z.string().max(40).optional(),
    }),
  )
  const [branch] = await ctx.db
    .insert(branches)
    .values({ ...body, timezone: body.timezone ?? 'UTC' })
    .returning()
  const { writeAudit } = await import('@/lib/services/audit')
  await writeAudit(ctx.db, { ...actorOf(ctx), action: 'branch.create', entity: 'branch', entityId: branch!.id })
  return created(branch)
}

export async function handleReferenceData(ctx: ApiContext) {
  const branchId = ctx.query.get('branchId') ?? undefined
  const [branchRows, trainerRows, roomRows] = await Promise.all([
    ctx.db.select({ id: branches.id, name: branches.name, timezone: branches.timezone }).from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.name)),
    listTrainers(ctx.db, branchId),
    listRooms(ctx.db, branchId),
  ])
  return { data: { branches: branchRows, trainers: trainerRows, rooms: roomRows } }
}

/* --------------------------------- reports -------------------------------- */

const rangeQuery = z.object({ from: z.string().optional(), to: z.string().optional(), branchId: z.string().uuid().optional() })

export async function handleDashboard(ctx: ApiContext) {
  const query = readQuery(ctx.request, rangeQuery)
  const range = { ...buildRange(query.from, query.to, 30), branchId: query.branchId }
  const payload = await dashboardPayload(ctx.db, range)
  return { data: payload }
}

export async function handleReports(ctx: ApiContext) {
  const query = readQuery(ctx.request, rangeQuery.extend({ type: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }))
  const range = { ...buildRange(query.from, query.to, 30), branchId: query.branchId }

  switch (query.type ?? 'overview') {
    case 'utilisation':
      return { data: await classUtilization(ctx.db, range, query.limit ?? 25) }
    case 'trainers':
      return { data: await trainerPerformance(ctx.db, range) }
    case 'outstanding':
      return { data: await outstandingInvoices(ctx.db, query.branchId) }
    case 'cohorts':
      return { data: await retentionCohorts(ctx.db) }
    case 'peak-hours':
      return { data: await peakHours(ctx.db, range) }
    case 'mix':
      return { data: await membershipMix(ctx.db, range) }
    default: {
      const payload = await dashboardPayload(ctx.db, range)
      return { data: payload }
    }
  }
}

export async function handleExport(ctx: ApiContext) {
  const query = readQuery(ctx.request, rangeQuery.extend({ type: z.enum(['payments', 'attendance', 'classes', 'bookings', 'members']) }))
  const range = { ...buildRange(query.from, query.to, 30), branchId: query.branchId }

  switch (query.type) {
    case 'attendance':
      return { data: await attendanceExportRows(ctx.db, range) }
    case 'classes':
      return { data: await classExportRows(ctx.db, range) }
    case 'bookings':
      return { data: await bookingExportRows(ctx.db, range) }
    case 'members': {
      const { memberExportRows } = await import('@/lib/services/members')
      return { data: await memberExportRows(ctx.db, { branchId: query.branchId }) }
    }
    default:
      return { data: await paymentExportRows(ctx.db, range) }
  }
}

/* ---------------------------------- staff --------------------------------- */

export async function handleListStaff(ctx: ApiContext) {
  const rows = await listStaff(ctx.db, {
    role: ctx.query.get('role') ?? undefined,
    branchId: ctx.query.get('branchId') ?? undefined,
    status: ctx.query.get('status') ?? undefined,
    q: ctx.query.get('q') ?? undefined,
  })
  return { data: rows }
}

export async function handleCreateStaff(ctx: ApiContext) {
  const body = await readJson(ctx.request, staffCreateSchema)
  const staff = await createStaff(ctx.db, body, actorOf(ctx))
  return created(staff)
}

export async function handleUpdateStaff(ctx: ApiContext) {
  const body = await readJson(ctx.request, staffCreateSchema.partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional() }))
  const staff = await updateStaff(ctx.db, ctx.params.id!, body, actorOf(ctx))
  return { data: staff }
}

export async function handleStaffSchedule(ctx: ApiContext) {
  const from = ctx.query.get('from') ? new Date(ctx.query.get('from')!) : new Date()
  const to = ctx.query.get('to') ? new Date(ctx.query.get('to')!) : new Date(Date.now() + 14 * 86_400_000)
  return { data: await staffSchedule(ctx.db, ctx.params.id!, from, to) }
}

export async function handlePayroll(ctx: ApiContext) {
  const query = readQuery(ctx.request, rangeQuery)
  const range = buildRange(query.from, query.to, 30)
  const rows = await payrollHours(ctx.db, { ...range, branchId: query.branchId })
  return { data: { rows, totals: { hours: rows.reduce((sum, row) => sum + row.taughtHours, 0), grossCents: rows.reduce((sum, row) => sum + (row.grossPayCents ?? 0), 0) } } }
}

/* ------------------------------ announcements ------------------------------ */

export async function handleListAnnouncements(ctx: ApiContext) {
  return { data: await listAnnouncements(ctx.db, { status: ctx.query.get('status') ?? undefined }) }
}

export async function handleCreateAnnouncement(ctx: ApiContext) {
  const body = await readJson(ctx.request, announcementSchema)
  const announcement = await createAnnouncement(ctx.db, body, actorOf(ctx))
  return created(announcement)
}

export async function handleUpdateAnnouncement(ctx: ApiContext) {
  const body = await readJson(ctx.request, announcementSchema.partial())
  const announcement = await updateAnnouncement(ctx.db, ctx.params.id!, body, actorOf(ctx))
  return { data: announcement }
}

export async function handleSendAnnouncement(ctx: ApiContext) {
  const result = await sendAnnouncement(ctx.db, ctx.params.id!, actorOf(ctx))
  return ok(result)
}

export async function handleAnnouncementStats(ctx: ApiContext) {
  return { data: await announcementDeliveryStats(ctx.db, ctx.params.id!) }
}

/* ---------------------------------- audit --------------------------------- */

export async function handleListAudit(ctx: ApiContext) {
  const conditions = []
  const action = ctx.query.get('action')
  const entity = ctx.query.get('entity')
  const actorId = ctx.query.get('actorId')
  const from = ctx.query.get('from')
  const to = ctx.query.get('to')
  if (action) conditions.push(sql`${auditLogs.action} ilike ${`%${action}%`}`)
  if (entity) conditions.push(eq(auditLogs.entity, entity))
  if (actorId) conditions.push(eq(auditLogs.actorId, actorId))
  if (from) conditions.push(gte(auditLogs.createdAt, new Date(from)))
  if (to) conditions.push(lte(auditLogs.createdAt, new Date(to)))

  const limit = Math.min(200, Number(ctx.query.get('limit') ?? 100))
  const rows = await ctx.db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      meta: auditLogs.meta,
      ip: auditLogs.ip,
      createdAt: auditLogs.createdAt,
      actorEmail: auditLogs.actorEmail,
      actorName: sql<string | null>`(select u.first_name || ' ' || u.last_name from users u where u.id = audit_logs.actor_id)`,
    })
    .from(auditLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)

  const [countRow] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(auditLogs)
  return { data: { rows, total: countRow?.count ?? 0 } }
}

/* --------------------------------- settings -------------------------------- */

export async function handleGetSettings(ctx: ApiContext) {
  const settings = await getSettingSections(ctx.db)
  const sessionInfo = {
    paymentProvider: process.env.STRIPE_SECRET_KEY ? 'stripe' : 'mock',
    emailProvider: process.env.RESEND_API_KEY ? 'resend' : 'simulated',
    smsProvider: process.env.TWILIO_ACCOUNT_SID ? 'twilio' : 'simulated',
    cronConfigured: Boolean(process.env.CRON_SECRET),
  }
  return { data: { settings, integrations: sessionInfo } }
}

export async function handleUpdateSettings(ctx: ApiContext) {
  const body = await readJson(
    ctx.request,
    z.object({
      section: z.enum(['gym', 'checkin', 'billing', 'classes']),
      value: z.record(z.string(), z.unknown()),
    }),
  )
  const settings = await updateSettings(ctx.db, body.section, body.value, actorOf(ctx))
  return { data: settings }
}

export async function handleSystemInfo(ctx: ApiContext) {
  const [counts] = await ctx.db
    .select({
      members: sql<number>`count(*) filter (where ${users.role} = 'MEMBER')::int`,
      staff: sql<number>`count(*) filter (where ${users.role} <> 'MEMBER')::int`,
      suspended: sql<number>`count(*) filter (where ${users.status} = 'SUSPENDED')::int`,
    })
    .from(users)

  return {
    data: {
      counts,
      database: process.env.DATABASE_URL ? 'postgres (pooled)' : 'embedded pglite (local)',
      node: process.version,
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    },
  }
}

export async function handleUnassignedMembers(ctx: ApiContext) {
  const rows = await ctx.db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(and(eq(users.role, 'MEMBER'), sql`${users.branchId} is null`))
    .limit(50)
  return { data: rows }
}

export async function handleMembersByIds(ctx: ApiContext) {
  const ids = (ctx.query.get('ids') ?? '').split(',').filter(Boolean)
  if (!ids.length) return { data: [] }
  const rows = await ctx.db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, role: users.role })
    .from(users)
    .where(inArray(users.id, ids))
  return { data: rows }
}
