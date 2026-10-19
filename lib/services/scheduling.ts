import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import {
  bookings,
  branches,
  classSessions,
  classTemplates,
  rooms,
  users,
  type ClassSession,
} from '@/lib/db/schema'
import { conflict, notFound, unprocessable } from '@/lib/api/http'
import { writeAudit } from './audit'
import { notify } from './notifications'

export const DEFAULT_HORIZON_WEEKS = 8

export interface ConflictInput {
  branchId: string
  trainerId?: string | null
  roomId?: string | null
  startsAt: Date
  endsAt: Date
  excludeSessionId?: string
}

export interface ConflictReport {
  trainerConflict: ClassSession | null
  roomConflict: ClassSession | null
  hasConflict: boolean
}

/**
 * A class cannot share a trainer or a room with another class. Overlap maths is
 * `existing.starts < new.ends AND existing.ends > new.starts`, which also catches
 * sessions that fully contain the new one.
 */
export async function findConflicts(db: Database, input: ConflictInput): Promise<ConflictReport> {
  const base = and(
    ne(classSessions.status, 'CANCELLED'),
    sql`${classSessions.startsAt} < ${input.endsAt} and ${classSessions.endsAt} > ${input.startsAt}`,
    input.excludeSessionId ? ne(classSessions.id, input.excludeSessionId) : undefined,
  )

  const [trainerConflict] = input.trainerId
    ? await db
        .select()
        .from(classSessions)
        .where(and(base, eq(classSessions.trainerId, input.trainerId)))
        .limit(1)
    : [undefined]

  const [roomConflict] = input.roomId
    ? await db
        .select()
        .from(classSessions)
        .where(and(base, eq(classSessions.roomId, input.roomId), ne(classSessions.status, 'CANCELLED')))
        .limit(1)
    : [undefined]

  return {
    trainerConflict: trainerConflict ?? null,
    roomConflict: roomConflict ?? null,
    hasConflict: Boolean(trainerConflict || roomConflict),
  }
}

function assertNoConflict(report: ConflictReport, allowOverride = false) {
  if (!report.hasConflict || allowOverride) return
  const parts: string[] = []
  if (report.trainerConflict) {
    parts.push(`the trainer is already teaching ${report.trainerConflict.title} at ${report.trainerConflict.startsAt.toISOString()}`)
  }
  if (report.roomConflict) {
    parts.push(`the room is booked for ${report.roomConflict.title} at ${report.roomConflict.startsAt.toISOString()}`)
  }
  throw conflict(`Schedule clash: ${parts.join(' and ')}.`)
}

function combineDateTime(day: Date, hhmm: string, durationMin: number) {
  const [hours, minutes] = hhmm.split(':').map(Number)
  const startsAt = new Date(day)
  startsAt.setUTCHours(hours ?? 18, minutes ?? 0, 0, 0)
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000)
  return { startsAt, endsAt }
}

export interface TemplateInput {
  branchId: string
  title: string
  description?: string
  trainerId?: string
  roomId?: string
  capacity: number
  durationMin: number
  startTime: string
  dayOfWeek: number
  recurrence?: 'WEEKLY' | 'BIWEEKLY' | 'NONE'
  startsOn: string
  endsOn?: string
  creditCost?: number
  cancelWindowHours?: number
  lateCancelPenaltyCents?: number
  horizonWeeks?: number
}

export interface GenerateResult {
  created: number
  skipped: { at: string; reason: string }[]
}

export async function generateSessionsForTemplate(
  db: Database,
  templateId: string,
  from: Date,
  to: Date,
): Promise<GenerateResult> {
  const [template] = await db.select().from(classTemplates).where(eq(classTemplates.id, templateId)).limit(1)
  if (!template) throw notFound('Class template')

  const result: GenerateResult = { created: 0, skipped: [] }
  const startBoundary = new Date(`${template.startsOn}T00:00:00.000Z`)
  const endBoundary = template.endsOn ? new Date(`${template.endsOn}T23:59:59.999Z`) : null

  for (let cursor = new Date(Math.max(from.getTime(), startBoundary.getTime())); cursor <= to; cursor = new Date(cursor.getTime() + 86_400_000)) {
    if (cursor.getUTCDay() !== template.dayOfWeek) continue
    if (endBoundary && cursor > endBoundary) break

    const { startsAt, endsAt } = combineDateTime(cursor, template.startTime, template.durationMin)

    const [existing] = await db
      .select({ id: classSessions.id, status: classSessions.status })
      .from(classSessions)
      .where(and(eq(classSessions.templateId, template.id), eq(classSessions.startsAt, startsAt)))
      .limit(1)
    if (existing) continue

    const conflictReport = await findConflicts(db, {
      branchId: template.branchId,
      trainerId: template.trainerId,
      roomId: template.roomId,
      startsAt,
      endsAt,
    })
    if (conflictReport.hasConflict) {
      result.skipped.push({ at: startsAt.toISOString(), reason: 'trainer or room already booked' })
      continue
    }

    await db.insert(classSessions).values({
      templateId: template.id,
      branchId: template.branchId,
      title: template.title,
      trainerId: template.trainerId,
      roomId: template.roomId,
      startsAt,
      endsAt,
      capacity: template.capacity,
      creditCost: template.creditCost,
      cancelWindowHours: template.cancelWindowHours,
      lateCancelPenaltyCents: template.lateCancelPenaltyCents,
      status: 'SCHEDULED',
    })
    result.created++
  }

  return result
}

export async function createTemplate(
  db: Database,
  input: TemplateInput,
  actor?: { id?: string | null; email?: string | null },
) {
  if (input.dayOfWeek < 0 || input.dayOfWeek > 6) throw unprocessable('dayOfWeek must be 0 (Sunday) to 6 (Saturday)')
  if (!/^\d{2}:\d{2}$/.test(input.startTime)) throw unprocessable('startTime must look like 18:30')

  const [template] = await db
    .insert(classTemplates)
    .values({
      branchId: input.branchId,
      title: input.title,
      description: input.description ?? null,
      trainerId: input.trainerId ?? null,
      roomId: input.roomId ?? null,
      capacity: input.capacity,
      durationMin: input.durationMin,
      startTime: input.startTime,
      dayOfWeek: input.dayOfWeek,
      recurrence: input.recurrence ?? 'WEEKLY',
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      creditCost: input.creditCost ?? 1,
      cancelWindowHours: input.cancelWindowHours ?? 6,
      lateCancelPenaltyCents: input.lateCancelPenaltyCents ?? 0,
    })
    .returning()

  const from = new Date(Math.max(Date.now(), new Date(`${input.startsOn}T00:00:00.000Z`).getTime()))
  const to = new Date(Date.now() + (input.horizonWeeks ?? DEFAULT_HORIZON_WEEKS) * 7 * 86_400_000)
  const generated = await generateSessionsForTemplate(db, template!.id, from, to)

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'class.create',
    entity: 'class_template',
    entityId: template!.id,
    branchId: template!.branchId,
    meta: { title: template!.title, sessionsCreated: generated.created, skipped: generated.skipped.length },
  })

  return { template: template!, generated }
}

export async function updateTemplate(
  db: Database,
  templateId: string,
  input: Partial<TemplateInput> & { isActive?: boolean },
  actor?: { id?: string | null; email?: string | null },
) {
  const [template] = await db.select().from(classTemplates).where(eq(classTemplates.id, templateId)).limit(1)
  if (!template) throw notFound('Class template')

  const [updated] = await db
    .update(classTemplates)
    .set({
      title: input.title ?? template.title,
      description: input.description ?? template.description,
      trainerId: input.trainerId ?? template.trainerId,
      roomId: input.roomId ?? template.roomId,
      capacity: input.capacity ?? template.capacity,
      durationMin: input.durationMin ?? template.durationMin,
      startTime: input.startTime ?? template.startTime,
      dayOfWeek: input.dayOfWeek ?? template.dayOfWeek,
      startsOn: input.startsOn ?? template.startsOn,
      endsOn: input.endsOn ?? template.endsOn,
      creditCost: input.creditCost ?? template.creditCost,
      cancelWindowHours: input.cancelWindowHours ?? template.cancelWindowHours,
      lateCancelPenaltyCents: input.lateCancelPenaltyCents ?? template.lateCancelPenaltyCents,
      isActive: input.isActive ?? template.isActive,
      updatedAt: new Date(),
    })
    .where(eq(classTemplates.id, templateId))
    .returning()

  // Future sessions with nobody booked are safe to realign with the template.
  const futureSessions = await db
    .select({ id: classSessions.id, startsAt: classSessions.startsAt })
    .from(classSessions)
    .where(
      and(
        eq(classSessions.templateId, templateId),
        gte(classSessions.startsAt, new Date()),
        eq(classSessions.status, 'SCHEDULED'),
      ),
    )

  let realigned = 0
  for (const session of futureSessions) {
    const [booked] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.sessionId, session.id), inArray(bookings.status, ['BOOKED', 'WAITLISTED'])))
    if ((booked?.count ?? 0) > 0) continue

    const { startsAt, endsAt } = combineDateTime(session.startsAt, updated!.startTime, updated!.durationMin)
    if (startsAt.getTime() !== new Date(session.startsAt).getTime()) {
      const clash = await findConflicts(db, {
        branchId: updated!.branchId,
        trainerId: updated!.trainerId,
        roomId: updated!.roomId,
        startsAt,
        endsAt,
        excludeSessionId: session.id,
      })
      if (clash.hasConflict) continue
    }

    await db
      .update(classSessions)
      .set({
        title: updated!.title,
        trainerId: updated!.trainerId,
        roomId: updated!.roomId,
        capacity: updated!.capacity,
        startsAt,
        endsAt,
        creditCost: updated!.creditCost,
        cancelWindowHours: updated!.cancelWindowHours,
        lateCancelPenaltyCents: updated!.lateCancelPenaltyCents,
        updatedAt: new Date(),
      })
      .where(eq(classSessions.id, session.id))
    realigned++
  }

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'class.update',
    entity: 'class_template',
    entityId: templateId,
    branchId: updated!.branchId,
    meta: { realignedFutureSessions: realigned },
  })

  return { template: updated!, realigned }
}

/**
 * Retiring a class stops future generation but leaves already scheduled sessions alone:
 * members may be booked on them, and silently cancelling classes is never acceptable.
 */
export async function deactivateTemplate(
  db: Database,
  templateId: string,
  actor?: { id?: string | null; email?: string | null },
) {
  const [template] = await db
    .update(classTemplates)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(classTemplates.id, templateId))
    .returning()
  if (!template) throw notFound('Class template')

  const future = await db
    .select({ id: classSessions.id })
    .from(classSessions)
    .where(
      and(
        eq(classSessions.templateId, templateId),
        gte(classSessions.startsAt, new Date()),
        eq(classSessions.status, 'SCHEDULED'),
      ),
    )

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'class.deactivate',
    entity: 'class_template',
    entityId: templateId,
    branchId: template.branchId,
    meta: { remainingSessions: future.length },
  })

  return { template, remainingSessions: future.length }
}

export interface SessionInput {
  branchId: string
  title: string
  trainerId?: string
  roomId?: string
  startsAt: Date
  durationMin: number
  capacity: number
  creditCost?: number
  cancelWindowHours?: number
  lateCancelPenaltyCents?: number
  notes?: string
}

export async function createSession(
  db: Database,
  input: SessionInput,
  actor?: { id?: string | null; email?: string | null },
  options: { allowOverride?: boolean } = {},
) {
  const endsAt = new Date(input.startsAt.getTime() + input.durationMin * 60_000)
  const conflictReport = await findConflicts(db, {
    branchId: input.branchId,
    trainerId: input.trainerId,
    roomId: input.roomId,
    startsAt: input.startsAt,
    endsAt,
  })
  assertNoConflict(conflictReport, options.allowOverride)

  const [session] = await db
    .insert(classSessions)
    .values({
      branchId: input.branchId,
      title: input.title,
      trainerId: input.trainerId ?? null,
      roomId: input.roomId ?? null,
      startsAt: input.startsAt,
      endsAt,
      capacity: input.capacity,
      creditCost: input.creditCost ?? 1,
      cancelWindowHours: input.cancelWindowHours ?? 6,
      lateCancelPenaltyCents: input.lateCancelPenaltyCents ?? 0,
      notes: input.notes ?? null,
      status: 'SCHEDULED',
    })
    .returning()

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'session.create',
    entity: 'class_session',
    entityId: session!.id,
    branchId: session!.branchId,
    meta: { title: session!.title, startsAt: session!.startsAt.toISOString() },
  })

  return session!
}

export async function updateSession(
  db: Database,
  sessionId: string,
  input: Partial<SessionInput> & { status?: string },
  actor?: { id?: string | null; email?: string | null },
  options: { allowOverride?: boolean } = {},
) {
  const [session] = await db.select().from(classSessions).where(eq(classSessions.id, sessionId)).limit(1)
  if (!session) throw notFound('Class session')

  const startsAt = input.startsAt ?? session.startsAt
  const durationMin = input.durationMin ?? Math.round((session.endsAt.getTime() - session.startsAt.getTime()) / 60_000)
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000)
  const trainerId = input.trainerId ?? session.trainerId
  const roomId = input.roomId ?? session.roomId

  if (input.startsAt || input.trainerId || input.roomId) {
    const conflictReport = await findConflicts(db, {
      branchId: session.branchId,
      trainerId,
      roomId,
      startsAt,
      endsAt,
      excludeSessionId: sessionId,
    })
    assertNoConflict(conflictReport, options.allowOverride)
  }

  const [updated] = await db
    .update(classSessions)
    .set({
      title: input.title ?? session.title,
      trainerId,
      roomId,
      startsAt,
      endsAt,
      capacity: input.capacity ?? session.capacity,
      creditCost: input.creditCost ?? session.creditCost,
      cancelWindowHours: input.cancelWindowHours ?? session.cancelWindowHours,
      lateCancelPenaltyCents: input.lateCancelPenaltyCents ?? session.lateCancelPenaltyCents,
      notes: input.notes ?? session.notes,
      status: input.status ?? session.status,
      updatedAt: new Date(),
    })
    .where(eq(classSessions.id, sessionId))
    .returning()

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'session.update',
    entity: 'class_session',
    entityId: sessionId,
    branchId: session.branchId,
    meta: { startsAt: startsAt.toISOString(), status: updated!.status },
  })

  return updated!
}

/** Cancelling a class releases everyone booked and returns their credits. */
export async function cancelSession(
  db: Database,
  sessionId: string,
  reason: string,
  actor?: { id?: string | null; email?: string | null },
) {
  const [session] = await db.select().from(classSessions).where(eq(classSessions.id, sessionId)).limit(1)
  if (!session) throw notFound('Class session')
  if (session.status === 'CANCELLED') throw unprocessable('That class is already cancelled')

  const affected = await db
    .select({ id: bookings.id, memberId: bookings.memberId, status: bookings.status })
    .from(bookings)
    .where(and(eq(bookings.sessionId, sessionId), inArray(bookings.status, ['BOOKED', 'WAITLISTED'])))

  await db
    .update(bookings)
    .set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: `Class cancelled: ${reason}` })
    .where(and(eq(bookings.sessionId, sessionId), inArray(bookings.status, ['BOOKED', 'WAITLISTED'])))

  await db
    .update(classSessions)
    .set({ status: 'CANCELLED', cancellationReason: reason, updatedAt: new Date() })
    .where(eq(classSessions.id, sessionId))

  for (const booking of affected) {
    await notify(db, {
      userId: booking.memberId,
      type: 'BOOKING_CANCELLED',
      title: `${session.title} cancelled`,
      body: `The class on ${session.startsAt.toDateString()} was cancelled (${reason}). Any credit was returned.`,
      channels: ['IN_APP', 'PUSH', 'EMAIL'],
      meta: { sessionId },
    })
  }

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'session.cancel',
    entity: 'class_session',
    entityId: sessionId,
    branchId: session.branchId,
    meta: { reason, releasedBookings: affected.length },
  })

  return { released: affected.length }
}

export interface SessionFilters {
  branchId?: string
  trainerId?: string
  memberId?: string
  title?: string
  status?: string
  from?: Date
  to?: Date
  limit?: number
}

export async function listSessions(db: Database, filters: SessionFilters = {}) {
  const conditions = []
  if (filters.branchId) conditions.push(eq(classSessions.branchId, filters.branchId))
  if (filters.trainerId) conditions.push(eq(classSessions.trainerId, filters.trainerId))
  if (filters.status) conditions.push(eq(classSessions.status, filters.status))
  if (filters.title) conditions.push(sql`${classSessions.title} ilike ${`%${filters.title}%`}`)
  if (filters.from) conditions.push(gte(classSessions.startsAt, filters.from))
  if (filters.to) conditions.push(lte(classSessions.startsAt, filters.to))
  if (filters.memberId) {
    conditions.push(
      sql`exists (select 1 from bookings b where b.session_id = class_sessions.id and b.member_id = ${filters.memberId} and b.status in ('BOOKED','WAITLISTED'))`,
    )
  }

  const bookedCount = sql<number>`(select count(*)::int from bookings b where b.session_id = class_sessions.id and b.status in ('BOOKED','ATTENDED'))`
  const waitlistCount = sql<number>`(select count(*)::int from bookings b where b.session_id = class_sessions.id and b.status = 'WAITLISTED')`
  const attendedCount = sql<number>`(select count(*)::int from bookings b where b.session_id = class_sessions.id and b.status = 'ATTENDED')`

  const rows = await db
    .select({
      id: classSessions.id,
      title: classSessions.title,
      branchId: classSessions.branchId,
      branchName: branches.name,
      roomName: rooms.name,
      trainerId: classSessions.trainerId,
      trainerName: sql<string | null>`(select u.first_name || ' ' || u.last_name from users u where u.id = class_sessions.trainer_id)`,
      startsAt: classSessions.startsAt,
      endsAt: classSessions.endsAt,
      capacity: classSessions.capacity,
      status: classSessions.status,
      creditCost: classSessions.creditCost,
      cancelWindowHours: classSessions.cancelWindowHours,
      lateCancelPenaltyCents: classSessions.lateCancelPenaltyCents,
      notes: classSessions.notes,
      bookedCount,
      waitlistCount,
      attendedCount,
    })
    .from(classSessions)
    .leftJoin(branches, eq(branches.id, classSessions.branchId))
    .leftJoin(rooms, eq(rooms.id, classSessions.roomId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(classSessions.startsAt))
    .limit(Math.min(500, filters.limit ?? 200))

  return rows
}

export type SessionListItem = Awaited<ReturnType<typeof listSessions>>[number]

export async function getSessionRoster(db: Database, sessionId: string) {
  const [session] = await db.select().from(classSessions).where(eq(classSessions.id, sessionId)).limit(1)
  if (!session) throw notFound('Class session')

  const [branch] = await db.select().from(branches).where(eq(branches.id, session.branchId)).limit(1)
  const [room] = session.roomId ? await db.select().from(rooms).where(eq(rooms.id, session.roomId)).limit(1) : [undefined]
  const [trainer] = session.trainerId
    ? await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
        .from(users)
        .where(eq(users.id, session.trainerId))
        .limit(1)
    : [undefined]

  const roster = await db
    .select({
      bookingId: bookings.id,
      memberId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
      status: bookings.status,
      waitlistPosition: bookings.waitlistPosition,
      bookedAt: bookings.bookedAt,
      attendedAt: bookings.attendedAt,
      healthNotes: sql<string | null>`(select p.health_notes from member_profiles p where p.user_id = users.id)`,
      checkedIn: sql<boolean>`exists (select 1 from attendance a where a.session_id = ${sessionId} and a.member_id = users.id)`,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.memberId))
    .where(and(eq(bookings.sessionId, sessionId), inArray(bookings.status, ['BOOKED', 'WAITLISTED', 'ATTENDED', 'NO_SHOW'])))
    .orderBy(asc(bookings.waitlistPosition), asc(bookings.bookedAt))

  return { session, branch: branch ?? null, room: room ?? null, trainer: trainer ?? null, roster }
}

export async function listTemplates(db: Database, filters: { branchId?: string; activeOnly?: boolean } = {}) {
  const conditions = []
  if (filters.branchId) conditions.push(eq(classTemplates.branchId, filters.branchId))
  if (filters.activeOnly) conditions.push(eq(classTemplates.isActive, true))

  return db
    .select({
      id: classTemplates.id,
      title: classTemplates.title,
      description: classTemplates.description,
      branchId: classTemplates.branchId,
      branchName: branches.name,
      trainerId: classTemplates.trainerId,
      trainerName: sql<string | null>`(select u.first_name || ' ' || u.last_name from users u where u.id = class_templates.trainer_id)`,
      roomId: classTemplates.roomId,
      roomName: rooms.name,
      capacity: classTemplates.capacity,
      durationMin: classTemplates.durationMin,
      startTime: classTemplates.startTime,
      dayOfWeek: classTemplates.dayOfWeek,
      recurrence: classTemplates.recurrence,
      startsOn: classTemplates.startsOn,
      creditCost: classTemplates.creditCost,
      cancelWindowHours: classTemplates.cancelWindowHours,
      lateCancelPenaltyCents: classTemplates.lateCancelPenaltyCents,
      isActive: classTemplates.isActive,
      upcomingSessions: sql<number>`(select count(*)::int from class_sessions s where s.template_id = class_templates.id and s.starts_at > now() and s.status = 'SCHEDULED')`,
    })
    .from(classTemplates)
    .leftJoin(branches, eq(branches.id, classTemplates.branchId))
    .leftJoin(rooms, eq(rooms.id, classTemplates.roomId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(classTemplates.dayOfWeek), asc(classTemplates.startTime))
}

export async function listTrainers(db: Database, branchId?: string) {
  return db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      branchId: users.branchId,
      jobTitle: users.jobTitle,
      status: users.status,
    })
    .from(users)
    .where(and(eq(users.role, 'TRAINER'), branchId ? eq(users.branchId, branchId) : undefined))
    .orderBy(asc(users.firstName))
}

export async function listRooms(db: Database, branchId?: string) {
  return db
    .select()
    .from(rooms)
    .where(and(eq(rooms.isActive, true), branchId ? eq(rooms.branchId, branchId) : undefined))
    .orderBy(asc(rooms.name))
}

/** Trainer's day/week view in the mobile app. */
export async function trainerSchedule(db: Database, trainerId: string, from: Date, to: Date) {
  return listSessions(db, { trainerId, from, to, limit: 200 })
}

export async function upcomingForMember(db: Database, memberId: string, limit = 10) {
  return db
    .select({
      bookingId: bookings.id,
      bookingStatus: bookings.status,
      waitlistPosition: bookings.waitlistPosition,
      sessionId: classSessions.id,
      title: classSessions.title,
      startsAt: classSessions.startsAt,
      endsAt: classSessions.endsAt,
      branchName: branches.name,
      roomName: rooms.name,
      trainerName: sql<string | null>`(select u.first_name || ' ' || u.last_name from users u where u.id = class_sessions.trainer_id)`,
      checkedIn: sql<boolean>`exists (select 1 from attendance a where a.session_id = class_sessions.id and a.member_id = ${memberId})`,
    })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .leftJoin(branches, eq(branches.id, classSessions.branchId))
    .leftJoin(rooms, eq(rooms.id, classSessions.roomId))
    .where(
      and(
        eq(bookings.memberId, memberId),
        inArray(bookings.status, ['BOOKED', 'WAITLISTED']),
        gte(classSessions.startsAt, new Date()),
      ),
    )
    .orderBy(asc(classSessions.startsAt))
    .limit(limit)
}

export async function findSessionsNeedingCompletion(db: Database, now = new Date()) {
  return db
    .select({ id: classSessions.id, title: classSessions.title, startsAt: classSessions.startsAt })
    .from(classSessions)
    .where(and(eq(classSessions.status, 'SCHEDULED'), lte(classSessions.endsAt, now)))
    .orderBy(desc(classSessions.startsAt))
    .limit(200)
}

export async function markCompletedSessions(db: Database, now = new Date()) {
  const due = await findSessionsNeedingCompletion(db, now)
  if (!due.length) return { completed: 0 }
  await db
    .update(classSessions)
    .set({ status: 'COMPLETED', updatedAt: now })
    .where(inArray(classSessions.id, due.map((row) => row.id)))
  return { completed: due.length }
}

/** Used by the "today" dashboards: everything on the floor right now. */
export async function todaysSessions(db: Database, branchId?: string, now = new Date()) {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start.getTime() + 2 * 86_400_000)
  return listSessions(db, { branchId, from: start, to: end, limit: 100 })
}

export async function branchScheduleContext(db: Database, branchId?: string) {
  const [branchRows, trainerRows, roomRows] = await Promise.all([
    db.select().from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.name)),
    listTrainers(db, branchId),
    listRooms(db, branchId),
  ])
  return { branches: branchRows, trainers: trainerRows, rooms: roomRows }
}
