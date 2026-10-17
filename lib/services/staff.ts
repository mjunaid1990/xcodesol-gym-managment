import { and, asc, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { attendance, branches, classSessions, users } from '@/lib/db/schema'
import { conflict, notFound, unprocessable } from '@/lib/api/http'
import type { Role } from '@/lib/constants'
import { hashPassword } from './auth'
import { writeAudit } from './audit'

export interface StaffFilters {
  role?: string
  branchId?: string
  status?: string
  q?: string
}

export async function listStaff(db: Database, filters: StaffFilters = {}) {
  const conditions = [ne(users.role, 'MEMBER')]
  if (filters.role) conditions.push(eq(users.role, filters.role))
  if (filters.branchId) conditions.push(eq(users.branchId, filters.branchId))
  if (filters.status) conditions.push(eq(users.status, filters.status))
  if (filters.q) {
    const term = `%${filters.q.trim()}%`
    conditions.push(sql`(${users.firstName} || ' ' || ${users.lastName} || ' ' || ${users.email}) ilike ${term}`)
  }

  return db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      role: users.role,
      status: users.status,
      branchId: users.branchId,
      branchName: branches.name,
      jobTitle: users.jobTitle,
      hourlyRateCents: users.hourlyRateCents,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      sessionsThisMonth: sql<number>`(select count(*)::int from class_sessions s where s.trainer_id = users.id and s.starts_at >= date_trunc('month', now()))`,
      sessionsNext7d: sql<number>`(select count(*)::int from class_sessions s where s.trainer_id = users.id and s.starts_at between now() and now() + interval '7 days' and s.status = 'SCHEDULED')`,
    })
    .from(users)
    .leftJoin(branches, eq(branches.id, users.branchId))
    .where(and(...conditions))
    .orderBy(asc(users.role), asc(users.firstName))
}

export interface StaffInput {
  email: string
  firstName: string
  lastName: string
  role: Role
  phone?: string
  branchId?: string
  jobTitle?: string
  hourlyRateCents?: number
  password?: string
}

export async function createStaff(
  db: Database,
  input: StaffInput,
  actor?: { id?: string | null; email?: string | null },
) {
  if (input.role === 'MEMBER') throw unprocessable('Use member create for MEMBER accounts')

  const email = input.email.trim().toLowerCase()
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (existing) throw conflict('Someone already uses that email address')

  const [staff] = await db
    .insert(users)
    .values({
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      phone: input.phone ?? null,
      branchId: input.branchId ?? null,
      jobTitle: input.jobTitle ?? null,
      hourlyRateCents: input.hourlyRateCents ?? null,
      passwordHash: await hashPassword(input.password ?? 'Passw0rd!'),
      emailVerifiedAt: new Date(),
    })
    .returning()

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'staff.create',
    entity: 'user',
    entityId: staff!.id,
    branchId: staff!.branchId,
    meta: { role: staff!.role, email },
  })

  return staff!
}

export async function updateStaff(
  db: Database,
  staffId: string,
  input: Partial<StaffInput> & { status?: string },
  actor?: { id?: string | null; email?: string | null },
) {
  const [staff] = await db.select().from(users).where(eq(users.id, staffId)).limit(1)
  if (!staff) throw notFound('Staff member')
  if (staff.role === 'MEMBER') throw unprocessable('That account is a member, not staff')

  const [updated] = await db
    .update(users)
    .set({
      firstName: input.firstName ?? staff.firstName,
      lastName: input.lastName ?? staff.lastName,
      phone: input.phone ?? staff.phone,
      role: input.role ?? staff.role,
      branchId: input.branchId ?? staff.branchId,
      jobTitle: input.jobTitle ?? staff.jobTitle,
      hourlyRateCents: input.hourlyRateCents ?? staff.hourlyRateCents,
      status: input.status ?? staff.status,
      updatedAt: new Date(),
    })
    .where(eq(users.id, staffId))
    .returning()

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'staff.update',
    entity: 'user',
    entityId: staffId,
    branchId: updated!.branchId,
    meta: { role: updated!.role, status: updated!.status },
  })

  return updated!
}

export interface PayrollRow {
  staffId: string
  name: string
  role: string
  branch: string | null
  jobTitle: string | null
  sessions: number
  taughtHours: number
  hourlyRateCents: number | null
  grossPayCents: number | null
  attendees: number
}

/**
 * Payroll hours come from the published schedule: a 45 minute class counts as 0.75h,
 * plus 15 minutes of setup/prep per class (a deliberate, documented assumption).
 */
export async function payrollHours(
  db: Database,
  input: { from: Date; to: Date; branchId?: string },
): Promise<PayrollRow[]> {
  const rows = await db
    .select({
      staffId: users.id,
      name: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      role: users.role,
      branch: branches.name,
      jobTitle: users.jobTitle,
      hourlyRateCents: users.hourlyRateCents,
      sessions: sql<number>`count(${classSessions.id})::int`,
      minutes: sql<number>`coalesce(sum(extract(epoch from (${classSessions.endsAt} - ${classSessions.startsAt})) / 60), 0)::int`,
      attendees: sql<number>`coalesce((select count(*)::int from bookings b join class_sessions s2 on s2.id = b.session_id where s2.trainer_id = users.id and b.status = 'ATTENDED' and s2.starts_at between ${input.from} and ${input.to}), 0)`,
    })
    .from(users)
    .leftJoin(branches, eq(branches.id, users.branchId))
    .leftJoin(
      classSessions,
      and(
        eq(classSessions.trainerId, users.id),
        gte(classSessions.startsAt, input.from),
        lte(classSessions.startsAt, input.to),
        ne(classSessions.status, 'CANCELLED'),
      ),
    )
    .where(
      and(
        inArray(users.role, ['TRAINER', 'STAFF', 'MANAGER']),
        input.branchId ? eq(users.branchId, input.branchId) : undefined,
      ),
    )
    .groupBy(users.id, users.firstName, users.lastName, users.role, branches.name, users.jobTitle, users.hourlyRateCents)
    .orderBy(asc(users.lastName))

  return rows.map((row) => {
    const taughtHours = Number(((row.minutes + row.sessions * 15) / 60).toFixed(2))
    return {
      staffId: row.staffId,
      name: row.name,
      role: row.role,
      branch: row.branch,
      jobTitle: row.jobTitle,
      sessions: row.sessions,
      taughtHours,
      hourlyRateCents: row.hourlyRateCents,
      grossPayCents: row.hourlyRateCents ? Math.round(taughtHours * row.hourlyRateCents) : null,
      attendees: row.attendees,
    }
  })
}

export async function staffSchedule(db: Database, staffId: string, from: Date, to: Date) {
  return db
    .select({
      id: classSessions.id,
      title: classSessions.title,
      startsAt: classSessions.startsAt,
      endsAt: classSessions.endsAt,
      capacity: classSessions.capacity,
      status: classSessions.status,
      branchName: branches.name,
      booked: sql<number>`(select count(*)::int from bookings b where b.session_id = class_sessions.id and b.status in ('BOOKED','ATTENDED'))`,
    })
    .from(classSessions)
    .leftJoin(branches, eq(branches.id, classSessions.branchId))
    .where(and(eq(classSessions.trainerId, staffId), gte(classSessions.startsAt, from), lte(classSessions.startsAt, to)))
    .orderBy(asc(classSessions.startsAt))
}

/** "Who is on the floor right now" for the manager view. */
export async function staffOnShift(db: Database, branchId?: string) {
  const since = new Date(Date.now() - 8 * 3_600_000)
  return db
    .select({
      staffId: users.id,
      name: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      role: users.role,
      jobTitle: users.jobTitle,
      checkedInAt: attendance.checkedInAt,
    })
    .from(attendance)
    .innerJoin(users, eq(users.id, attendance.memberId))
    .where(
      and(
        or(eq(users.role, 'TRAINER'), eq(users.role, 'STAFF'), eq(users.role, 'MANAGER'), eq(users.role, 'ADMIN')),
        gte(attendance.checkedInAt, since),
        branchId ? eq(attendance.branchId, branchId) : undefined,
      ),
    )
    .orderBy(asc(users.firstName))
}
