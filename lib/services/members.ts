import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import {
  attendance,
  auditLogs,
  bookings,
  classSessions,
  invoices,
  memberNotes,
  memberProfiles,
  memberships,
  payments,
  plans,
  users,
  type User,
} from '@/lib/db/schema'
import { conflict, notFound } from '@/lib/api/http'
import { WAIVER_VERSION } from '@/lib/constants'
import { hashPassword } from './auth'
import { writeAudit } from './audit'
import { getEntitlement, purchaseMembership } from './memberships'

/* Reusable correlated sub-selects: cheap on Postgres with the indexes we created, and
   they keep the list endpoint a single round trip for 10k+ members. */
const membershipStatusExpr = () => sql<string | null>`(select m.status from memberships m where m.member_id = users.id order by m.ends_at desc limit 1)`
const planNameExpr = () => sql<string | null>`(select p.name from memberships m join plans p on p.id = m.plan_id where m.member_id = users.id order by m.ends_at desc limit 1)`
const membershipEndsExpr = () => sql<string | null>`(select m.ends_at from memberships m where m.member_id = users.id order by m.ends_at desc limit 1)`
const lastVisitExpr = () => sql<string | null>`(select max(a.checked_in_at) from attendance a where a.member_id = users.id)`
const visits30dExpr = () => sql<number>`(select count(*)::int from attendance a where a.member_id = users.id and a.checked_in_at > now() - interval '30 days')`
const outstandingExpr = () => sql<number>`(select coalesce(sum(i.total_cents - i.amount_paid_cents), 0)::int from invoices i where i.member_id = users.id and i.status = 'OPEN')`

export interface MemberListFilters {
  q?: string
  status?: string
  membershipStatus?: string
  branchId?: string
  hasWaiver?: boolean
  inactiveForDays?: number
  page?: number
  pageSize?: number
  sort?: 'recent' | 'name' | 'expiring' | 'outstanding'
}

export async function listMembers(db: Database, filters: MemberListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25))

  const conditions = [eq(users.role, 'MEMBER')]
  if (filters.status) conditions.push(eq(users.status, filters.status))
  if (filters.branchId) conditions.push(eq(users.branchId, filters.branchId))
  if (filters.q) {
    const term = `%${filters.q.trim()}%`
    conditions.push(
      sql`(${users.firstName} || ' ' || ${users.lastName} || ' ' || ${users.email} || ' ' || coalesce(${users.phone}, '')) ilike ${term}`,
    )
  }
  if (filters.membershipStatus) conditions.push(sql`${membershipStatusExpr()} = ${filters.membershipStatus}`)
  if (filters.hasWaiver === true) {
    conditions.push(sql`exists (select 1 from member_profiles p where p.user_id = users.id and p.waiver_signed_at is not null)`)
  }
  if (filters.hasWaiver === false) {
    conditions.push(sql`not exists (select 1 from member_profiles p where p.user_id = users.id and p.waiver_signed_at is not null)`)
  }
  if (filters.inactiveForDays) {
    conditions.push(
      sql`coalesce(${lastVisitExpr()}, users.created_at) < now() - (${filters.inactiveForDays} * interval '1 day')`,
    )
  }

  const where = and(...conditions)
  const orderBy = (() => {
    switch (filters.sort) {
      case 'name':
        return [users.firstName, users.lastName]
      case 'expiring':
        return [sql`${membershipEndsExpr()} asc nulls last`]
      case 'outstanding':
        return [sql`${outstandingExpr()} desc`]
      default:
        return [desc(users.createdAt)]
    }
  })()

  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      status: users.status,
      branchId: users.branchId,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      membershipStatus: membershipStatusExpr(),
      planName: planNameExpr(),
      membershipEndsAt: membershipEndsExpr(),
      lastVisitAt: lastVisitExpr(),
      visits30d: visits30dExpr(),
      outstandingCents: outstandingExpr(),
    })
    .from(users)
    .where(where)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(where)

  return {
    rows,
    total: countRow?.count ?? 0,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil((countRow?.count ?? 0) / pageSize)),
  }
}

export async function getMember(db: Database, memberId: string) {
  const [member] = await db.select().from(users).where(eq(users.id, memberId)).limit(1)
  if (!member) throw notFound('Member')

  const [profile] = await db.select().from(memberProfiles).where(eq(memberProfiles.userId, memberId)).limit(1)
  const entitlement = await getEntitlement(db, memberId)

  const [membershipRows, invoiceRows, paymentRows, visitRows, bookingRows, noteRows] = await Promise.all([
    db
      .select({
        id: memberships.id,
        status: memberships.status,
        startsAt: memberships.startsAt,
        endsAt: memberships.endsAt,
        priceCents: memberships.priceCents,
        autoRenew: memberships.autoRenew,
        creditsRemaining: memberships.creditsRemaining,
        freezeEndsAt: memberships.freezeEndsAt,
        planId: memberships.planId,
        planName: plans.name,
        planType: plans.type,
      })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .where(eq(memberships.memberId, memberId))
      .orderBy(desc(memberships.endsAt)),
    db.select().from(invoices).where(eq(invoices.memberId, memberId)).orderBy(desc(invoices.issuedAt)).limit(25),
    db.select().from(payments).where(eq(payments.memberId, memberId)).orderBy(desc(payments.createdAt)).limit(25),
    db
      .select({
        id: attendance.id,
        checkedInAt: attendance.checkedInAt,
        method: attendance.method,
        sessionId: attendance.sessionId,
        sessionTitle: classSessions.title,
      })
      .from(attendance)
      .leftJoin(classSessions, eq(classSessions.id, attendance.sessionId))
      .where(eq(attendance.memberId, memberId))
      .orderBy(desc(attendance.checkedInAt))
      .limit(25),
    db
      .select({
        id: bookings.id,
        status: bookings.status,
        bookedAt: bookings.bookedAt,
        sessionId: classSessions.id,
        title: classSessions.title,
        startsAt: classSessions.startsAt,
        endsAt: classSessions.endsAt,
      })
      .from(bookings)
      .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
      .where(eq(bookings.memberId, memberId))
      .orderBy(desc(classSessions.startsAt))
      .limit(25),
    db
      .select({
        id: memberNotes.id,
        body: memberNotes.body,
        isPinned: memberNotes.isPinned,
        createdAt: memberNotes.createdAt,
        authorId: memberNotes.authorId,
        authorName: sql<string>`coalesce(${users.firstName} || ' ' || ${users.lastName}, 'System')`,
      })
      .from(memberNotes)
      .leftJoin(users, eq(users.id, memberNotes.authorId))
      .where(eq(memberNotes.memberId, memberId))
      .orderBy(desc(memberNotes.isPinned), desc(memberNotes.createdAt)),
  ])

  const { passwordHash: _hash, ...safeMember } = member

  return {
    member: safeMember,
    profile: profile ?? null,
    entitlement,
    memberships: membershipRows,
    invoices: invoiceRows,
    payments: paymentRows,
    visits: visitRows,
    bookings: bookingRows,
    notes: noteRows,
  }
}

export interface CreateMemberInput {
  email: string
  phone?: string
  firstName: string
  lastName: string
  password?: string
  branchId?: string
  dateOfBirth?: string
  addressLine?: string
  city?: string
  postalCode?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
  healthNotes?: string
  acceptWaiver?: boolean
  planId?: string
  takePayment?: boolean
  actor?: { id?: string | null; email?: string | null }
}

export async function createMember(db: Database, input: CreateMemberInput) {
  const email = input.email.trim().toLowerCase()
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (existing.length) throw conflict('A member with that email already exists')

  const [member] = await db
    .insert(users)
    .values({
      email,
      phone: input.phone ?? null,
      passwordHash: await hashPassword(input.password ?? 'Passw0rd!'),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      role: 'MEMBER',
      branchId: input.branchId ?? null,
      emailVerifiedAt: new Date(),
    })
    .returning()

  await db.insert(memberProfiles).values({
    userId: member!.id,
    dateOfBirth: input.dateOfBirth ?? null,
    addressLine: input.addressLine ?? null,
    city: input.city ?? null,
    postalCode: input.postalCode ?? null,
    emergencyContactName: input.emergencyContactName ?? null,
    emergencyContactPhone: input.emergencyContactPhone ?? null,
    healthNotes: input.healthNotes ?? null,
    waiverSignedAt: input.acceptWaiver ? new Date() : null,
    waiverVersion: input.acceptWaiver ? WAIVER_VERSION : null,
  })

  await writeAudit(db, {
    actorId: input.actor?.id,
    actorEmail: input.actor?.email,
    action: 'member.create',
    entity: 'user',
    entityId: member!.id,
    branchId: member!.branchId,
    meta: { email, source: 'admin' },
  })

  let membershipResult = null
  if (input.planId) {
    membershipResult = await purchaseMembership(db, {
      memberId: member!.id,
      planId: input.planId,
      skipPayment: !input.takePayment,
      actor: input.actor,
    })
  }

  return { member: member!, membershipResult }
}

export async function updateMember(
  db: Database,
  memberId: string,
  input: Partial<CreateMemberInput> & { status?: string; avatarUrl?: string; marketingOptIn?: boolean },
) {
  const [member] = await db.select().from(users).where(eq(users.id, memberId)).limit(1)
  if (!member) throw notFound('Member')

  const userFields: Record<string, unknown> = { updatedAt: new Date() }
  if (input.firstName) userFields.firstName = input.firstName
  if (input.lastName) userFields.lastName = input.lastName
  if (input.phone !== undefined) userFields.phone = input.phone
  if (input.status) userFields.status = input.status
  if (input.branchId !== undefined) userFields.branchId = input.branchId
  if (input.avatarUrl !== undefined) userFields.avatarUrl = input.avatarUrl

  await db.update(users).set(userFields).where(eq(users.id, memberId))

  const profileFields: Record<string, unknown> = { updatedAt: new Date() }
  for (const key of [
    'dateOfBirth',
    'addressLine',
    'city',
    'postalCode',
    'emergencyContactName',
    'emergencyContactPhone',
    'healthNotes',
    'marketingOptIn',
  ] as const) {
    if (input[key] !== undefined) profileFields[key] = input[key]
  }
  if (input.acceptWaiver) {
    profileFields.waiverSignedAt = new Date()
    profileFields.waiverVersion = WAIVER_VERSION
  }

  const [profile] = await db.select({ id: memberProfiles.id }).from(memberProfiles).where(eq(memberProfiles.userId, memberId)).limit(1)
  if (profile) {
    await db.update(memberProfiles).set(profileFields).where(eq(memberProfiles.userId, memberId))
  } else {
    await db.insert(memberProfiles).values({ userId: memberId, ...profileFields })
  }

  await writeAudit(db, {
    actorId: input.actor?.id,
    actorEmail: input.actor?.email,
    action: 'member.update',
    entity: 'user',
    entityId: memberId,
    branchId: member.branchId,
    meta: { fields: Object.keys(input).filter((key) => key !== 'actor') },
  })

  return getMember(db, memberId)
}

export async function setMemberStatus(
  db: Database,
  memberId: string,
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  actor?: { id?: string | null; email?: string | null },
) {
  const [member] = await db
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(eq(users.id, memberId))
    .returning()
  if (!member) throw notFound('Member')

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'member.status',
    entity: 'user',
    entityId: memberId,
    branchId: member.branchId,
    meta: { status },
  })
  return member
}

export async function addMemberNote(
  db: Database,
  memberId: string,
  body: string,
  input: { authorId?: string | null; isPinned?: boolean } = {},
) {
  const [note] = await db
    .insert(memberNotes)
    .values({ memberId, body, authorId: input.authorId ?? null, isPinned: input.isPinned ?? false })
    .returning()

  await writeAudit(db, {
    actorId: input.authorId,
    action: 'member.note_added',
    entity: 'member_note',
    entityId: note!.id,
    meta: { memberId },
  })
  return note!
}

export async function deleteMemberNote(db: Database, noteId: string, actor?: { id?: string | null; email?: string | null }) {
  await db.delete(memberNotes).where(eq(memberNotes.id, noteId))
  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'member.note_deleted',
    entity: 'member_note',
    entityId: noteId,
  })
}

export type BulkMemberAction = 'activate' | 'deactivate' | 'suspend' | 'note' | 'grant-credits'

export async function bulkMemberAction(
  db: Database,
  memberIds: string[],
  action: BulkMemberAction,
  input: { note?: string; credits?: number; actor?: { id?: string | null; email?: string | null } } = {},
) {
  const results: { id: string; ok: boolean; message?: string }[] = []

  for (const memberId of memberIds) {
    try {
      switch (action) {
        case 'activate':
          await setMemberStatus(db, memberId, 'ACTIVE', input.actor)
          break
        case 'deactivate':
          await setMemberStatus(db, memberId, 'INACTIVE', input.actor)
          break
        case 'suspend':
          await setMemberStatus(db, memberId, 'SUSPENDED', input.actor)
          break
        case 'note':
          if (!input.note) throw new Error('A note is required')
          await addMemberNote(db, memberId, input.note, { authorId: input.actor?.id })
          break
        case 'grant-credits': {
          const credits = Math.max(0, Math.round(input.credits ?? 0))
          if (credits <= 0) throw new Error('Credits must be greater than zero')
          const [active] = await db
            .select({ id: memberships.id, creditsRemaining: memberships.creditsRemaining })
            .from(memberships)
            .where(and(eq(memberships.memberId, memberId), inArray(memberships.status, ['ACTIVE', 'FROZEN'])))
            .limit(1)
          if (!active) throw new Error('No active membership')
          await db
            .update(memberships)
            .set({ creditsRemaining: (active.creditsRemaining ?? 0) + credits, updatedAt: new Date() })
            .where(eq(memberships.id, active.id))
          break
        }
      }
      results.push({ id: memberId, ok: true })
    } catch (error) {
      results.push({ id: memberId, ok: false, message: error instanceof Error ? error.message : 'failed' })
    }
  }

  await writeAudit(db, {
    actorId: input.actor?.id,
    actorEmail: input.actor?.email,
    action: `member.bulk_${action}`,
    entity: 'user',
    meta: { count: memberIds.length, succeeded: results.filter((r) => r.ok).length },
  })

  return results
}

export async function memberTimeline(db: Database, memberId: string, limit = 50) {
  const [audit, notes, visits] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entity: auditLogs.entity,
        entityId: auditLogs.entityId,
        meta: auditLogs.meta,
        createdAt: auditLogs.createdAt,
        actorEmail: auditLogs.actorEmail,
      })
      .from(auditLogs)
      .where(
        or(
          and(eq(auditLogs.entity, 'user'), eq(auditLogs.entityId, memberId)),
          sql`${auditLogs.meta}->>'memberId' = ${memberId}`,
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit),
    db
      .select({
        id: memberNotes.id,
        body: memberNotes.body,
        createdAt: memberNotes.createdAt,
      })
      .from(memberNotes)
      .where(eq(memberNotes.memberId, memberId))
      .orderBy(desc(memberNotes.createdAt))
      .limit(limit),
    db
      .select({ id: attendance.id, checkedInAt: attendance.checkedInAt, method: attendance.method })
      .from(attendance)
      .where(eq(attendance.memberId, memberId))
      .orderBy(desc(attendance.checkedInAt))
      .limit(limit),
  ])

  return [
    ...audit.map((row) => ({ kind: 'audit' as const, at: row.createdAt, ...row })),
    ...notes.map((row) => ({ kind: 'note' as const, at: row.createdAt, ...row })),
    ...visits.map((row) => ({ kind: 'visit' as const, at: row.checkedInAt, ...row })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime())
}

/** Rows used by the CSV export endpoint. */
export async function memberExportRows(db: Database, filters: MemberListFilters = {}) {
  const { rows } = await listMembers(db, { ...filters, page: 1, pageSize: 100 })
  return rows.map((row) => ({
    id: row.id,
    name: `${row.firstName} ${row.lastName}`,
    email: row.email,
    phone: row.phone ?? '',
    status: row.status,
    membership: row.membershipStatus ?? 'NONE',
    plan: row.planName ?? '',
    endsAt: row.membershipEndsAt ? new Date(row.membershipEndsAt).toISOString().slice(0, 10) : '',
    lastVisit: row.lastVisitAt ? new Date(row.lastVisitAt).toISOString().slice(0, 10) : 'never',
    visits30d: row.visits30d,
    outstanding: (row.outstandingCents / 100).toFixed(2),
    joined: row.createdAt.toISOString().slice(0, 10),
  }))
}

export type MemberExportRow = Awaited<ReturnType<typeof memberExportRows>>[number]
export type MemberListItem = Awaited<ReturnType<typeof listMembers>>['rows'][number]
export type MemberDetail = Awaited<ReturnType<typeof getMember>>
export type { User }
