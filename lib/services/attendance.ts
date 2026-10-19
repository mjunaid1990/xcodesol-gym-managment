import { and, asc, desc, eq, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { attendance, bookings, branches, classSessions, users } from '@/lib/db/schema'
import { conflict, notFound, unprocessable } from '@/lib/api/http'
import { CHECKIN_COOLDOWN_MINUTES } from '@/lib/constants'
import { verifyQrPass } from '@/lib/auth/tokens'
import { writeAudit } from './audit'
import { notify } from './notifications'
import { getEntitlement } from './memberships'

export type CheckInMethod = 'QR' | 'MANUAL' | 'NFC' | 'BIOMETRIC' | 'CLASS'

export interface CheckInInput {
  memberId: string
  branchId?: string | null
  method: CheckInMethod
  sessionId?: string | null
  note?: string
  /** Front-desk override for lapsed memberships (recorded in the audit trail). */
  overrideReason?: string
  actor?: { id?: string | null; email?: string | null }
  now?: Date
}

export interface CheckInResult {
  attendanceId: string
  memberId: string
  memberName: string
  branchId: string
  checkedInAt: Date
  method: CheckInMethod
  membershipStatus: string
  warning?: string
  sessionId: string | null
  isFirstVisitToday: boolean
}

/**
 * The 5-second front-desk flow: validate entitlement, block duplicate scans inside a
 * short cooldown, write the visit, and if the member is here for a class mark that
 * booking as attended in the same call.
 */
export async function checkIn(db: Database, input: CheckInInput): Promise<CheckInResult> {
  const now = input.now ?? new Date()

  const [member] = await db.select().from(users).where(eq(users.id, input.memberId)).limit(1)
  if (!member) throw notFound('Member')
  if (member.status === 'SUSPENDED') throw unprocessable('This member is suspended. Talk to a manager.')

  const entitlement = await getEntitlement(db, member.id, now)
  if (!entitlement.allowed && !input.overrideReason) {
    throw unprocessable(`Check-in blocked: ${entitlement.reason}. Use an override to admit anyway.`)
  }

  const cooldownStart = new Date(now.getTime() - CHECKIN_COOLDOWN_MINUTES * 60_000)
  const [recent] = await db
    .select({ id: attendance.id, checkedInAt: attendance.checkedInAt })
    .from(attendance)
    .where(and(eq(attendance.memberId, member.id), gte(attendance.checkedInAt, cooldownStart)))
    .orderBy(desc(attendance.checkedInAt))
    .limit(1)
  if (recent) {
    throw conflict(
      `Already checked in at ${new Date(recent.checkedInAt).toISOString().slice(11, 16)} (${CHECKIN_COOLDOWN_MINUTES} minute cooldown).`,
    )
  }

  const branchId = input.branchId ?? member.branchId
  if (!branchId) throw unprocessable('This member has no home branch. Set one before checking in.')

  const [visit] = await db
    .insert(attendance)
    .values({
      memberId: member.id,
      branchId,
      sessionId: input.sessionId ?? null,
      method: input.method,
      checkedInAt: now,
      checkedInBy: input.actor?.id ?? null,
      note: input.overrideReason ? `Override: ${input.overrideReason}` : (input.note ?? null),
    })
    .returning()

  let sessionId: string | null = input.sessionId ?? null
  if (sessionId) {
    await db
      .update(bookings)
      .set({ status: 'ATTENDED', attendedAt: now })
      .where(and(eq(bookings.sessionId, sessionId), eq(bookings.memberId, member.id), inArray(bookings.status, ['BOOKED', 'WAITLISTED'])))
  }

  await writeAudit(db, {
    actorId: input.actor?.id,
    actorEmail: input.actor?.email,
    action: 'attendance.check_in',
    entity: 'attendance',
    entityId: visit!.id,
    branchId,
    meta: {
      memberId: member.id,
      method: input.method,
      membershipStatus: entitlement.membership?.status ?? 'NONE',
      override: input.overrideReason ?? null,
    },
  })

  return {
    attendanceId: visit!.id,
    memberId: member.id,
    memberName: `${member.firstName} ${member.lastName}`,
    branchId,
    checkedInAt: now,
    method: input.method,
    membershipStatus: entitlement.membership?.status ?? 'NONE',
    warning: entitlement.allowed ? undefined : `Admitted with override: ${entitlement.reason}`,
    sessionId,
    isFirstVisitToday: true,
  }
}

export async function checkInByQrPass(
  db: Database,
  token: string,
  input: { branchId?: string | null; actor?: { id?: string | null; email?: string | null } } = {},
): Promise<CheckInResult> {
  const { memberId } = verifyQrPass(token)
  return checkIn(db, {
    memberId,
    branchId: input.branchId,
    method: 'QR',
    actor: input.actor,
  })
}

/** Front desk types a name/email/phone, we resolve the member and check them in. */
export async function checkInBySearch(
  db: Database,
  query: string,
  input: { branchId?: string | null; actor?: { id?: string | null; email?: string | null }; overrideReason?: string } = {},
): Promise<CheckInResult> {
  const term = query.trim()
  const [member] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.role, 'MEMBER'),
        or(
          eq(users.email, term.toLowerCase()),
          eq(users.phone, term),
          sql`(${users.firstName} || ' ' || ${users.lastName}) ilike ${term}`,
        ),
      ),
    )
    .limit(1)

  if (!member) throw notFound(`No member matches "${term}"`)

  return checkIn(db, {
    memberId: member.id,
    branchId: input.branchId ?? member.branchId,
    method: 'MANUAL',
    overrideReason: input.overrideReason,
    actor: input.actor,
  })
}

export interface VisitFilters {
  memberId?: string
  branchId?: string
  method?: string
  from?: Date
  to?: Date
  sessionId?: string
  limit?: number
  page?: number
}

export async function listVisits(db: Database, filters: VisitFilters = {}) {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, filters.limit ?? 50))

  const conditions = []
  if (filters.memberId) conditions.push(eq(attendance.memberId, filters.memberId))
  if (filters.branchId) conditions.push(eq(attendance.branchId, filters.branchId))
  if (filters.method) conditions.push(eq(attendance.method, filters.method))
  if (filters.sessionId) conditions.push(eq(attendance.sessionId, filters.sessionId))
  if (filters.from) conditions.push(gte(attendance.checkedInAt, filters.from))
  if (filters.to) conditions.push(lte(attendance.checkedInAt, filters.to))

  const where = conditions.length ? and(...conditions) : undefined

  const rows = await db
    .select({
      id: attendance.id,
      checkedInAt: attendance.checkedInAt,
      method: attendance.method,
      note: attendance.note,
      memberId: users.id,
      memberName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      memberEmail: users.email,
      memberPhone: users.phone,
      branchName: branches.name,
      sessionTitle: classSessions.title,
      sessionStartsAt: classSessions.startsAt,
    })
    .from(attendance)
    .innerJoin(users, eq(users.id, attendance.memberId))
    .leftJoin(branches, eq(branches.id, attendance.branchId))
    .leftJoin(classSessions, eq(classSessions.id, attendance.sessionId))
    .where(where)
    .orderBy(desc(attendance.checkedInAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(attendance).where(where)

  return { rows, total: countRow?.count ?? 0, page, pageSize }
}

export interface FloorStats {
  visitsToday: number
  uniqueToday: number
  visitsLastHour: number
  classesToday: number
  classSeatsBooked: number
  upcomingClasses: {
    id: string
    title: string
    startsAt: Date
    capacity: number
    booked: number
    trainer: string | null
    room: string | null
  }[]
  recentVisits: {
    id: string
    memberName: string
    checkedInAt: Date
    method: string
    membershipStatus: string | null
  }[]
}

/** Everything the front-desk "live floor" screen needs in one request. */
export async function floorStats(db: Database, branchId?: string, now = new Date()): Promise<FloorStats> {
  const startOfDay = new Date(now)
  startOfDay.setUTCHours(0, 0, 0, 0)
  const branchFilter = branchId ? eq(attendance.branchId, branchId) : undefined

  const [todayRow] = await db
    .select({
      visits: sql<number>`count(*)::int`,
      uniqueMembers: sql<number>`count(distinct ${attendance.memberId})::int`,
    })
    .from(attendance)
    .where(and(gte(attendance.checkedInAt, startOfDay), branchFilter))

  const [hourRow] = await db
    .select({ visits: sql<number>`count(*)::int` })
    .from(attendance)
    .where(and(gte(attendance.checkedInAt, new Date(now.getTime() - 3_600_000)), branchFilter))

  const sessionBranchFilter = branchId ? eq(classSessions.branchId, branchId) : undefined
  const [classRow] = await db
    .select({ classes: sql<number>`count(*)::int` })
    .from(classSessions)
    .where(
      and(
        gte(classSessions.startsAt, startOfDay),
        lt(classSessions.startsAt, new Date(startOfDay.getTime() + 86_400_000)),
        ne(classSessions.status, 'CANCELLED'),
        sessionBranchFilter,
      ),
    )

  const upcoming = await db
    .select({
      id: classSessions.id,
      title: classSessions.title,
      startsAt: classSessions.startsAt,
      capacity: classSessions.capacity,
      booked: sql<number>`(select count(*)::int from bookings b where b.session_id = class_sessions.id and b.status in ('BOOKED','ATTENDED'))`,
      trainer: sql<string | null>`(select u.first_name || ' ' || u.last_name from users u where u.id = class_sessions.trainer_id)`,
      room: sql<string | null>`(select r.name from rooms r where r.id = class_sessions.room_id)`,
    })
    .from(classSessions)
    .where(
      and(
        gte(classSessions.startsAt, new Date(now.getTime() - 15 * 60_000)),
        lt(classSessions.startsAt, new Date(now.getTime() + 8 * 3_600_000)),
        ne(classSessions.status, 'CANCELLED'),
        sessionBranchFilter,
      ),
    )
    .orderBy(asc(classSessions.startsAt))
    .limit(10)

  const recent = await db
    .select({
      id: attendance.id,
      memberName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      checkedInAt: attendance.checkedInAt,
      method: attendance.method,
      membershipStatus: sql<string | null>`(select m.status from memberships m where m.member_id = users.id order by m.ends_at desc limit 1)`,
    })
    .from(attendance)
    .innerJoin(users, eq(users.id, attendance.memberId))
    .where(branchFilter)
    .orderBy(desc(attendance.checkedInAt))
    .limit(12)

  return {
    visitsToday: todayRow?.visits ?? 0,
    uniqueToday: todayRow?.uniqueMembers ?? 0,
    visitsLastHour: hourRow?.visits ?? 0,
    classesToday: classRow?.classes ?? 0,
    classSeatsBooked: upcoming.reduce((total, row) => total + row.booked, 0),
    upcomingClasses: upcoming,
    recentVisits: recent,
  }
}

export async function memberCheckInSummary(db: Database, memberId: string) {
  const [row] = await db
    .select({
      totalVisits: sql<number>`count(*)::int`,
      firstVisit: sql<Date | null>`min(${attendance.checkedInAt})`,
      lastVisit: sql<Date | null>`max(${attendance.checkedInAt})`,
      visits30d: sql<number>`count(*) filter (where ${attendance.checkedInAt} > now() - interval '30 days')::int`,
    })
    .from(attendance)
    .where(eq(attendance.memberId, memberId))

  const [todayRow] = await db
    .select({ id: attendance.id })
    .from(attendance)
    .where(
      and(
        eq(attendance.memberId, memberId),
        gte(attendance.checkedInAt, new Date(new Date().setUTCHours(0, 0, 0, 0))),
      ),
    )
    .limit(1)

  return {
    totalVisits: row?.totalVisits ?? 0,
    firstVisit: row?.firstVisit ?? null,
    lastVisit: row?.lastVisit ?? null,
    visits30d: row?.visits30d ?? 0,
    checkedInToday: Boolean(todayRow),
  }
}

/** Reception nudges members who signed in but have not visited for a while. */
export async function sendWinBackNudge(db: Database, memberId: string, message: string) {
  await notify(db, {
    userId: memberId,
    type: 'ANNOUNCEMENT',
    title: 'We miss you at Ironhouse',
    body: message,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
  })
  return { sent: true }
}
