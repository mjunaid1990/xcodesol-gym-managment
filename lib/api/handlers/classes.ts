import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { created, notFound, readJson, readQuery } from '@/lib/api/http'
import { bookings } from '@/lib/db/schema'
import {
  cancelSession,
  createSession,
  createTemplate,
  deactivateTemplate,
  getSessionRoster,
  listSessions,
  listTemplates,
  updateSession,
  updateTemplate,
} from '@/lib/services/scheduling'
import { bookSession, cancelBooking, listBookings, markAttendanceStatus } from '@/lib/services/bookings'
import { checkIn } from '@/lib/services/attendance'
import { bookingCreateSchema, sessionCreateSchema, templateCreateSchema } from '@/lib/api/schemas'
import { numberParam } from '@/lib/api/context'
import type { ApiContext } from '@/lib/api/context'
import { actorOf } from './members'

const sessionFilterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  branchId: z.string().uuid().optional(),
  trainerId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
  status: z.enum(['SCHEDULED', 'CANCELLED', 'COMPLETED']).optional(),
  title: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export async function handleListSessions(ctx: ApiContext) {
  const query = readQuery(ctx.request, sessionFilterSchema)
  const rows = await listSessions(ctx.db, {
    ...query,
    from: query.from ? new Date(query.from) : new Date(Date.now() - 7 * 86_400_000),
    to: query.to ? new Date(query.to) : new Date(Date.now() + 30 * 86_400_000),
  })
  return { data: rows }
}

export async function handleCreateSession(ctx: ApiContext) {
  const body = await readJson(ctx.request, sessionCreateSchema)
  const session = await createSession(
    ctx.db,
    {
      ...body,
      startsAt: new Date(body.startsAt),
      trainerId: body.trainerId,
      roomId: body.roomId,
    },
    actorOf(ctx),
    { allowOverride: body.allowConflictOverride },
  )
  return created(session)
}

export async function handleGetSession(ctx: ApiContext) {
  return { data: await getSessionRoster(ctx.db, ctx.params.id!) }
}

export async function handleUpdateSession(ctx: ApiContext) {
  const body = await readJson(ctx.request, sessionCreateSchema.partial().extend({ status: z.enum(['SCHEDULED', 'CANCELLED', 'COMPLETED']).optional() }))
  const session = await updateSession(
    ctx.db,
    ctx.params.id!,
    {
      ...body,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
    },
    actorOf(ctx),
    { allowOverride: body.allowConflictOverride },
  )
  return { data: session }
}

const cancelSessionSchema = z.object({ reason: z.string().trim().min(3).max(300).default('Cancelled by staff') })

export async function handleCancelSession(ctx: ApiContext) {
  const raw = await ctx.request.json().catch(() => ({}))
  const body = cancelSessionSchema.parse(raw)
  const result = await cancelSession(ctx.db, ctx.params.id!, body.reason, actorOf(ctx))
  return { data: result }
}

export async function handleSessionCheckIn(ctx: ApiContext) {
  const body = await readJson(
    ctx.request,
    z.object({ memberId: z.string().uuid(), method: z.enum(['QR', 'MANUAL', 'NFC', 'BIOMETRIC', 'CLASS']).optional() }),
  )
  const sessionId = ctx.params.id!
  const roster = await getSessionRoster(ctx.db, sessionId)
  const result = await checkIn(ctx.db, {
    memberId: body.memberId,
    branchId: roster.session.branchId,
    sessionId,
    method: body.method ?? 'CLASS',
    actor: actorOf(ctx),
  })
  return created(result)
}

export async function handleRosterAction(ctx: ApiContext) {
  const body = await readJson(ctx.request, z.object({ status: z.enum(['ATTENDED', 'NO_SHOW']) }))
  const booking = await markAttendanceStatus(ctx.db, ctx.params.id!, body.status, actorOf(ctx))
  return { data: booking }
}

export async function handleListTemplates(ctx: ApiContext) {
  const rows = await listTemplates(ctx.db, {
    branchId: ctx.query.get('branchId') ?? undefined,
    activeOnly: ctx.query.get('activeOnly') !== 'false',
  })
  return { data: rows }
}

export async function handleCreateTemplate(ctx: ApiContext) {
  const body = await readJson(ctx.request, templateCreateSchema)
  const result = await createTemplate(ctx.db, body, actorOf(ctx))
  return created(result)
}

export async function handleUpdateTemplate(ctx: ApiContext) {
  const body = await readJson(ctx.request, templateCreateSchema.partial().extend({ isActive: z.boolean().optional() }))
  const result = await updateTemplate(ctx.db, ctx.params.id!, body, actorOf(ctx))
  return { data: result }
}

export async function handleDeleteTemplate(ctx: ApiContext) {
  const result = await deactivateTemplate(ctx.db, ctx.params.id!, actorOf(ctx))
  return { data: result }
}

export async function handleListBookings(ctx: ApiContext) {
  const rows = await listBookings(ctx.db, {
    memberId: ctx.query.get('memberId') ?? undefined,
    sessionId: ctx.query.get('sessionId') ?? undefined,
    status: ctx.query.get('status') ?? undefined,
    branchId: ctx.query.get('branchId') ?? undefined,
    from: ctx.query.get('from') ? new Date(ctx.query.get('from')!) : undefined,
    to: ctx.query.get('to') ? new Date(ctx.query.get('to')!) : undefined,
    limit: numberParam(ctx.query.get('limit'), 100),
  })
  return { data: rows }
}

export async function handleCreateBooking(ctx: ApiContext) {
  const body = await readJson(ctx.request, bookingCreateSchema)
  const memberId = body.memberId ?? ctx.user!.id
  const result = await bookSession(ctx.db, {
    memberId,
    sessionId: body.sessionId,
    overrideEntitlement: body.overrideEntitlement,
    actor: actorOf(ctx),
  })
  return created(result)
}

export async function handleCancelBooking(ctx: ApiContext) {
  const raw = await ctx.request.json().catch(() => ({}))
  const body = z
    .object({ reason: z.string().max(300).optional(), waivePenalty: z.boolean().optional() })
    .parse(raw)

  const [booking] = await ctx.db.select().from(bookings).where(eq(bookings.id, ctx.params.id!)).limit(1)
  if (!booking) throw notFound('Booking')

  // Members can never waive their own penalty: only staff can. Server-side, always.
  const isSelf = ctx.user ? booking.memberId === ctx.user.id : false
  const result = await cancelBooking(ctx.db, ctx.params.id!, {
    reason: body.reason,
    waivePenalty: isSelf ? false : Boolean(body.waivePenalty),
    actor: actorOf(ctx),
  })
  return { data: result }
}
