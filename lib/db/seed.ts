import bcrypt from 'bcryptjs'
import type { Database } from './client'
import {
  announcements,
  attendance,
  auditLogs,
  bookings,
  branches,
  classSessions,
  classTemplates,
  discounts,
  invoices,
  memberNotes,
  memberProfiles,
  membershipEvents,
  memberships,
  payments,
  plans,
  rooms,
  appSettings,
  users,
} from './schema'

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Deterministic PRNG so every seed produces the same demo data. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20261017)
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min
const chance = (probability: number) => rand() < probability
const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000)
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000)
const addMonths = (date: Date, months: number) => {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}
const atTime = (day: Date, hhmm: string) => {
  const [hours, minutes] = hhmm.split(':').map(Number)
  const copy = new Date(day)
  copy.setUTCHours(hours ?? 18, minutes ?? 0, 0, 0)
  return copy
}
const startOfUtcDay = (date: Date) => {
  const copy = new Date(date)
  copy.setUTCHours(0, 0, 0, 0)
  return copy
}

async function chunkedInsert<T extends Record<string, unknown>>(
  db: Database,
  table: Parameters<Database['insert']>[0],
  rows: T[],
  size = 250,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(table).values(rows.slice(i, i + size) as any)
  }
}

const FIRST_NAMES = [
  'Ava', 'Marcus', 'Priya', 'Diego', 'Nadia', 'Sam', 'Tess', 'Omar', 'Lucia', 'Jonah',
  'Amara', 'Felix', 'Rosa', 'Kai', 'Nina', 'Theo', 'Maya', 'Ravi', 'Elena', 'Bruno',
  'Iris', 'Hugo', 'Zara', 'Milo', 'Freya', 'Caleb', 'Anika', 'Noah', 'Leila', 'Otto',
  'Sofia', 'Dmitri', 'Grace', 'Yusuf', 'Clara', 'Isaac', 'Hana', 'Pablo', 'Ruth', 'Idris',
  'Talia', 'Ewan', 'Sana', 'Andres', 'Wren', 'Kofi', 'Junia', 'Lars', 'Naomi', 'Radu',
  'Bea', 'Tobias', 'Alma', 'Enzo', 'Lina', 'Cyrus', 'Marta', 'Quinn', 'Selin', 'Dev',
  'Noor', 'Emeka', 'Julia', 'Viktor',
]
const LAST_NAMES = [
  'Okafor', 'Lee', 'Shah', 'Alvarez', 'Cole', 'Rivera', 'Kim', 'Haddad', 'Moretti', 'Fischer',
  'Nwosu', 'Bergman', 'Silva', 'Tanaka', 'Petrov', 'Lindqvist', 'Rossi', 'Menon', 'Novak', 'Costa',
  'Devereux', 'Sorensen', 'Haddad', 'Lindgren', 'Osei', 'Marchetti', 'Novakovic', 'Bright', 'Farrell', 'Dubois',
]
const HEALTH_NOTES = [
  'Mild asthma - inhaler in bag',
  'Previous ACL injury, cleared by physio',
  'Lower-back sensitivity, avoids heavy deadlifts',
  'No known conditions',
  'No known conditions',
  'Hypertension, medication managed',
]
const CANCEL_REASONS = ['Relocating', 'Too expensive', 'Injury', 'Travelling for work', 'Switching to home workouts']

export interface SeedSummary {
  branches: number
  staff: number
  members: number
  plans: number
  memberships: number
  sessions: number
  bookings: number
  attendance: number
  invoices: number
}

/** Checks whether database has already been seeded with initial branches and users. */
export async function isDatabaseSeeded(db: Database): Promise<boolean> {
  try {
    const existingBranch = await db.select({ id: branches.id }).from(branches).limit(1)
    const existingUser = await db.select({ id: users.id }).from(users).limit(1)
    return existingBranch.length > 0 && existingUser.length > 0
  } catch {
    return false
  }
}

/**
 * Demo data for Ironhouse Fitness: three branches, a full staff roster, 64 members on a
 * mix of plans, five weeks of classes with real attendance history and a payment ledger
 * that includes failures and refunds so the dashboards have something honest to show.
 */
export async function seedDatabase(db: Database, options?: { force?: boolean }): Promise<SeedSummary> {
  if (!options?.force) {
    const alreadySeeded = await isDatabaseSeeded(db)
    if (alreadySeeded) {
      console.log('▸ Database already contains data. Skipping duplicate seed.')
      return {
        branches: 0,
        staff: 0,
        members: 0,
        plans: 0,
        memberships: 0,
        sessions: 0,
        bookings: 0,
        attendance: 0,
        invoices: 0,
      }
    }
  }

  const now = new Date()
  const today = startOfUtcDay(now)
  const passwordHash = await bcrypt.hash('Passw0rd!', 10)

  /* Branches ------------------------------------------------------------- */
  const branchRows = await db
    .insert(branches)
    .values([
      { name: 'Ironhouse Downtown', slug: 'downtown', city: 'New York', addressLine: '140 Mercer St', timezone: 'America/New_York', phone: '+1 212 555 0110' },
      { name: 'Ironhouse Riverside', slug: 'riverside', city: 'Jersey City', addressLine: '9 Hudson Ave', timezone: 'America/New_York', phone: '+1 201 555 0142' },
      { name: 'Ironhouse Northgate', slug: 'northgate', city: 'New Rochelle', addressLine: '77 North Ave', timezone: 'America/New_York', phone: '+1 914 555 0177' },
    ])
    .returning()
  const [downtown, riverside, northgate] = branchRows

  /* Rooms ---------------------------------------------------------------- */
  const roomRows = await db
    .insert(rooms)
    .values([
      { branchId: downtown!.id, name: 'Studio A', capacity: 24 },
      { branchId: downtown!.id, name: 'Studio B', capacity: 16 },
      { branchId: downtown!.id, name: 'Main Floor', capacity: 40 },
      { branchId: riverside!.id, name: 'Studio A', capacity: 20 },
      { branchId: riverside!.id, name: 'Main Floor', capacity: 30 },
      { branchId: northgate!.id, name: 'Studio A', capacity: 18 },
    ])
    .returning()
  const room = (branchIndex: number, name: string) =>
    roomRows.find((r) => r.name === name && r.branchId === branchRows[branchIndex]!.id)!

  /* Staff & trainers ----------------------------------------------------- */
  const staffRows = await db
    .insert(users)
    .values([
      { branchId: downtown!.id, email: 'admin@ironhouse.test', phone: '+1 212 555 0001', passwordHash, firstName: 'Ava', lastName: 'Okafor', role: 'ADMIN', jobTitle: 'Owner', emailVerifiedAt: now },
      { branchId: downtown!.id, email: 'manager@ironhouse.test', phone: '+1 212 555 0002', passwordHash, firstName: 'Marcus', lastName: 'Lee', role: 'MANAGER', jobTitle: 'General manager', emailVerifiedAt: now },
      { branchId: downtown!.id, email: 'frontdesk@ironhouse.test', phone: '+1 212 555 0003', passwordHash, firstName: 'Priya', lastName: 'Shah', role: 'STAFF', jobTitle: 'Front desk', emailVerifiedAt: now },
      { branchId: riverside!.id, email: 'frontdesk2@ironhouse.test', phone: '+1 201 555 0004', passwordHash, firstName: 'Diego', lastName: 'Alvarez', role: 'STAFF', jobTitle: 'Front desk', emailVerifiedAt: now },
      { branchId: downtown!.id, email: 'trainer@ironhouse.test', phone: '+1 212 555 0005', passwordHash, firstName: 'Nadia', lastName: 'Cole', role: 'TRAINER', jobTitle: 'Head coach', hourlyRateCents: 3800, emailVerifiedAt: now },
      { branchId: downtown!.id, email: 'sam.trainer@ironhouse.test', passwordHash, firstName: 'Sam', lastName: 'Rivera', role: 'TRAINER', jobTitle: 'Strength coach', hourlyRateCents: 3400, emailVerifiedAt: now },
      { branchId: riverside!.id, email: 'tess.trainer@ironhouse.test', passwordHash, firstName: 'Tess', lastName: 'Kim', role: 'TRAINER', jobTitle: 'Yoga & mobility', hourlyRateCents: 3200, emailVerifiedAt: now },
      { branchId: northgate!.id, email: 'omar.trainer@ironhouse.test', passwordHash, firstName: 'Omar', lastName: 'Haddad', role: 'TRAINER', jobTitle: 'Spin & conditioning', hourlyRateCents: 3200, emailVerifiedAt: now },
    ])
    .returning()

  const trainerIds = staffRows.filter((u) => u.role === 'TRAINER').map((u) => u.id)
  const adminId = staffRows.find((u) => u.role === 'ADMIN')!.id
  const managerId = staffRows.find((u) => u.role === 'MANAGER')!.id
  const frontDeskId = staffRows.find((u) => u.email === 'frontdesk@ironhouse.test')!.id

  /* Plans & discounts ---------------------------------------------------- */
  const planRows = await db
    .insert(plans)
    .values([
      { name: 'Day Pass', type: 'DAY_PASS', interval: 'ONE_TIME', priceCents: 1500, classCredits: 1, freezeDaysPerYear: 0, autoRenew: false, sortOrder: 1, description: 'Single-day access to the gym floor.' },
      { name: 'Monthly Unlimited', type: 'MEMBERSHIP', interval: 'MONTHLY', priceCents: 7900, freezeDaysPerYear: 14, sortOrder: 2, description: 'Unlimited classes and gym access, billed monthly.' },
      { name: 'Quarterly Unlimited', type: 'MEMBERSHIP', interval: 'QUARTERLY', priceCents: 21900, freezeDaysPerYear: 21, sortOrder: 3, description: 'Three months up front, save 8%.' },
      { name: 'Annual Unlimited', type: 'MEMBERSHIP', interval: 'ANNUAL', priceCents: 79900, freezeDaysPerYear: 30, sortOrder: 4, description: 'Best value: 12 months, free freeze days.' },
      { name: 'Student Monthly', type: 'MEMBERSHIP', interval: 'MONTHLY', priceCents: 5900, freezeDaysPerYear: 10, sortOrder: 5, description: 'Valid student ID required at sign-up.' },
      { name: '10-Class Pack', type: 'CLASS_PACK', interval: 'ONE_TIME', priceCents: 16000, classCredits: 10, autoRenew: false, sortOrder: 6, description: 'Ten class credits, valid for 6 months.' },
      { name: '20-Class Pack', type: 'CLASS_PACK', interval: 'ONE_TIME', priceCents: 29000, classCredits: 20, autoRenew: false, sortOrder: 7, description: 'Twenty class credits, valid for 9 months.' },
    ])
    .returning()

  await db.insert(discounts).values([
    { code: 'WELCOME20', description: '20% off the first month', percentOff: 20, maxRedemptions: 500, validUntil: addDays(now, 120) },
    { code: 'SUMMER50', description: '$50 off annual plans', amountOffCents: 5000, maxRedemptions: 100, validUntil: addDays(now, 60) },
    { code: 'STUDENT10', description: '10% student discount', percentOff: 10, maxRedemptions: 1000 },
  ])

  /* Members -------------------------------------------------------------- */
  const memberRows: (typeof users.$inferInsert)[] = []
  const profileRows: (typeof memberProfiles.$inferInsert)[] = []

  const demoMember = {
    branchId: downtown!.id,
    email: 'member@ironhouse.test',
    phone: '+1 212 555 0199',
    passwordHash,
    firstName: 'Jonah',
    lastName: 'Bright',
    role: 'MEMBER',
    emailVerifiedAt: now,
  }
  memberRows.push(demoMember)
  profileRows.push({
    userId: '', // filled in after insert
    dateOfBirth: '1994-04-18',
    gender: 'Male',
    addressLine: '22 Grove St, Apt 4B',
    city: 'New York',
    postalCode: '10014',
    emergencyContactName: 'Ruth Bright',
    emergencyContactPhone: '+1 212 555 0188',
    healthNotes: 'No known conditions',
    waiverSignedAt: addDays(now, -160),
    waiverVersion: '2026-01',
  })

  for (let i = 0; i < 63; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length]!
    const last = LAST_NAMES[(i * 7) % LAST_NAMES.length]!
    const branch = branchRows[i % branchRows.length]!
    memberRows.push({
      branchId: branch.id,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.test`,
      phone: `+1 917 555 ${String(1000 + i).slice(-4)}`,
      passwordHash,
      firstName: first,
      lastName: last,
      role: 'MEMBER',
      emailVerifiedAt: chance(0.9) ? now : null,
      createdAt: addDays(now, -randInt(5, 400)),
    })
    profileRows.push({
      userId: '',
      dateOfBirth: `${randInt(1972, 2005)}-${String(randInt(1, 12)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}`,
      gender: pick(['Female', 'Male', 'Non-binary', 'Prefer not to say']),
      addressLine: `${randInt(1, 400)} ${pick(['Grove St', 'Hudson Ave', 'Bleecker St', 'Fulton St', 'Elm Rd'])}`,
      city: branch.city ?? 'New York',
      postalCode: String(randInt(10001, 11299)),
      emergencyContactName: `${pick(FIRST_NAMES)} ${last}`,
      emergencyContactPhone: `+1 917 555 ${randInt(1000, 9999)}`,
      healthNotes: pick(HEALTH_NOTES),
      waiverSignedAt: chance(0.85) ? addDays(now, -randInt(1, 300)) : null,
      waiverVersion: '2026-01',
      marketingOptIn: chance(0.7),
    })
  }

  const insertedMembers = await db.insert(users).values(memberRows).returning()
  profileRows.forEach((profile, index) => {
    profile.userId = insertedMembers[index]!.id
  })
  await chunkedInsert(db, memberProfiles, profileRows)

  /* Memberships, invoices, payments ------------------------------------- */
  const membershipRows: (typeof memberships.$inferInsert)[] = []
  const membershipMeta: { memberIndex: number; planIndex: number; status: string; priceCents: number }[] = []

  insertedMembers.forEach((member, index) => {
    // ~8% of members have lapsed (no membership in the current period) so churn reports are real.
    const lapsed = index > 0 && chance(0.08)
    const plan = (() => {
      if (lapsed) return planRows[randInt(1, 4)]!
      if (index === 0) return planRows[1]! // demo member: Monthly Unlimited
      const roll = rand()
      if (roll < 0.42) return planRows[1]!
      if (roll < 0.6) return planRows[2]!
      if (roll < 0.72) return planRows[3]!
      if (roll < 0.85) return planRows[5]!
      if (roll < 0.95) return planRows[6]!
      return planRows[4]!
    })()

    const startOffsetDays = index === 0 ? -78 : -randInt(5, 330)
    const startsAt = addDays(now, startOffsetDays)
    const months = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12, ONE_TIME: 0 }[plan.interval as 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'ONE_TIME'] ?? 1
    const endsAt = months > 0 ? addMonths(startsAt, months) : addDays(startsAt, 180)

    let status: string = 'ACTIVE'
    if (lapsed) status = 'EXPIRED'
    else if (endsAt.getTime() < now.getTime()) status = 'EXPIRED'
    else if (index !== 0 && chance(0.07)) status = 'FROZEN'
    else if (index !== 0 && chance(0.04)) status = 'CANCELLED'

    membershipRows.push({
      memberId: member.id,
      planId: plan.id,
      branchId: member.branchId,
      status,
      priceCents: plan.priceCents,
      startsAt,
      endsAt,
      autoRenew: plan.autoRenew && status !== 'CANCELLED',
      creditsRemaining: plan.classCredits,
      frozenAt: status === 'FROZEN' ? addDays(now, -randInt(2, 10)) : null,
      freezeEndsAt: status === 'FROZEN' ? addDays(now, randInt(3, 20)) : null,
      cancelledAt: status === 'CANCELLED' ? addDays(now, -randInt(1, 30)) : null,
      cancelReason: status === 'CANCELLED' ? pick(CANCEL_REASONS) : null,
      createdAt: startsAt,
    })
    membershipMeta.push({ memberIndex: index, planIndex: planRows.indexOf(plan), status, priceCents: plan.priceCents })
  })

  const insertedMemberships = await db.insert(memberships).values(membershipRows).returning()

  await chunkedInsert(
    db,
    membershipEvents,
    insertedMemberships.map((membership) => ({
      membershipId: membership.id,
      type: 'CREATED',
      toStatus: membership.status,
      amountCents: membership.priceCents,
      actorId: frontDeskId,
      createdAt: membership.createdAt,
    })),
  )

  let invoiceCounter = 1
  const invoiceRows: (typeof invoices.$inferInsert)[] = []
  insertedMemberships.forEach((membership, index) => {
    const meta = membershipMeta[index]!
    const paid = meta.status === 'EXPIRED' ? chance(0.65) : true
    const total = membership.priceCents
    // Most members have paid recently (renewals), so the 30-day dashboard has real
    // activity rather than a wall of year-old invoices.
    const recentPayment = index % 10 < 7
    const issuedAt = recentPayment
      ? new Date(Math.max(membership.startsAt.getTime(), addDays(now, -randInt(1, 28)).getTime()))
      : membership.startsAt
    invoiceRows.push({
      number: `INV-2026-${String(invoiceCounter++).padStart(4, '0')}`,
      memberId: membership.memberId,
      membershipId: membership.id,
      branchId: membership.branchId,
      subtotalCents: total,
      totalCents: total,
      amountPaidCents: paid ? total : 0,
      currency: membership.currency,
      status: paid ? 'PAID' : 'OPEN',
      issuedAt,
      dueAt: addDays(issuedAt, 7),
      paidAt: paid ? addDays(issuedAt, randInt(0, 3)) : null,
      description: `Membership - ${planRows[meta.planIndex]!.name}`,
      createdAt: issuedAt,
    })
  })

  const insertedInvoices = await db.insert(invoices).values(invoiceRows).returning()

  const paymentRows: (typeof payments.$inferInsert)[] = []
  insertedInvoices.forEach((invoice) => {
    if (invoice.status === 'OPEN') {
      if (chance(0.5)) {
        paymentRows.push({
          invoiceId: invoice.id,
          memberId: invoice.memberId,
          membershipId: invoice.membershipId,
          branchId: invoice.branchId,
          amountCents: invoice.totalCents,
          status: 'FAILED',
          provider: 'stripe',
          providerRef: `pi_demo_failed_${invoice.number}`,
          method: 'card',
          failureReason: pick(['card_declined', 'insufficient_funds', 'authentication_required']),
          attempts: randInt(1, 3),
          createdAt: addDays(invoice.issuedAt, 1),
        })
      }
      return
    }
    paymentRows.push({
      invoiceId: invoice.id,
      memberId: invoice.memberId,
      membershipId: invoice.membershipId,
      branchId: invoice.branchId,
      amountCents: invoice.totalCents,
      status: 'SUCCEEDED',
      provider: chance(0.8) ? 'stripe' : 'cash',
      providerRef: `pi_demo_${invoice.number}`,
      method: chance(0.8) ? 'card' : 'cash',
      attempts: 1,
      paidAt: invoice.paidAt ?? invoice.issuedAt,
      createdAt: invoice.paidAt ?? invoice.issuedAt,
    })
  })
  // A couple of refunds so the refund flow has history.
  const refundTargets = paymentRows.filter((p) => p.status === 'SUCCEEDED').slice(0, 3)
  refundTargets.forEach((payment) => {
    payment.status = 'REFUNDED'
    payment.refundedCents = payment.amountCents
  })
  await chunkedInsert(db, payments, paymentRows)

  /* Class schedule ------------------------------------------------------- */
  const templateDefs: {
    branchIndex: number
    roomName: string
    title: string
    trainerIndex: number
    dayOfWeek: number
    startTime: string
    durationMin: number
    capacity: number
    creditCost: number
    cancelWindowHours: number
    lateCancelPenaltyCents: number
    description: string
  }[] = [
    { branchIndex: 0, roomName: 'Studio A', title: 'HIIT Circuit', trainerIndex: 0, dayOfWeek: 1, startTime: '06:30', durationMin: 45, capacity: 20, creditCost: 1, cancelWindowHours: 6, lateCancelPenaltyCents: 1500, description: 'Intervals on the floor and rowers. All levels.' },
    { branchIndex: 0, roomName: 'Studio A', title: 'HIIT Circuit', trainerIndex: 0, dayOfWeek: 4, startTime: '06:30', durationMin: 45, capacity: 20, creditCost: 1, cancelWindowHours: 6, lateCancelPenaltyCents: 1500, description: 'Intervals on the floor and rowers. All levels.' },
    { branchIndex: 0, roomName: 'Studio B', title: 'Yoga Flow', trainerIndex: 2, dayOfWeek: 2, startTime: '18:30', durationMin: 60, capacity: 16, creditCost: 1, cancelWindowHours: 4, lateCancelPenaltyCents: 1000, description: 'Slow vinyasa flow, mats provided.' },
    { branchIndex: 0, roomName: 'Main Floor', title: 'Strength Foundations', trainerIndex: 1, dayOfWeek: 3, startTime: '12:00', durationMin: 50, capacity: 12, creditCost: 1, cancelWindowHours: 8, lateCancelPenaltyCents: 2000, description: 'Squat, hinge, press: coached technique.' },
    { branchIndex: 0, roomName: 'Studio A', title: 'Spin 45', trainerIndex: 3, dayOfWeek: 5, startTime: '07:00', durationMin: 45, capacity: 24, creditCost: 1, cancelWindowHours: 6, lateCancelPenaltyCents: 1500, description: 'Indoor cycling with power targets.' },
    { branchIndex: 1, roomName: 'Studio A', title: 'Mobility & Recovery', trainerIndex: 2, dayOfWeek: 1, startTime: '19:00', durationMin: 45, capacity: 18, creditCost: 1, cancelWindowHours: 4, lateCancelPenaltyCents: 0, description: 'Foam rolling, breath work, joint prep.' },
    { branchIndex: 1, roomName: 'Main Floor', title: 'Boxing Basics', trainerIndex: 0, dayOfWeek: 6, startTime: '10:00', durationMin: 60, capacity: 16, creditCost: 1, cancelWindowHours: 6, lateCancelPenaltyCents: 1500, description: 'Pads, drills and footwork for beginners.' },
    { branchIndex: 2, roomName: 'Studio A', title: 'Pilates Core', trainerIndex: 2, dayOfWeek: 2, startTime: '09:30', durationMin: 50, capacity: 18, creditCost: 1, cancelWindowHours: 4, lateCancelPenaltyCents: 1000, description: 'Mat pilates focused on deep core stability.' },
    { branchIndex: 2, roomName: 'Studio A', title: 'Powerlifting Club', trainerIndex: 1, dayOfWeek: 0, startTime: '11:00', durationMin: 90, capacity: 10, creditCost: 2, cancelWindowHours: 12, lateCancelPenaltyCents: 2500, description: 'Squat/bench/deadlift technique with spotters.' },
  ]

  const templateRows = await db
    .insert(classTemplates)
    .values(
      templateDefs.map((def) => ({
        branchId: branchRows[def.branchIndex]!.id,
        roomId: room(def.branchIndex, def.roomName).id,
        title: def.title,
        description: def.description,
        trainerId: trainerIds[def.trainerIndex % trainerIds.length]!,
        capacity: def.capacity,
        durationMin: def.durationMin,
        startTime: def.startTime,
        dayOfWeek: def.dayOfWeek,
        recurrence: 'WEEKLY',
        startsOn: startOfUtcDay(addDays(now, -35)).toISOString().slice(0, 10),
        creditCost: def.creditCost,
        cancelWindowHours: def.cancelWindowHours,
        lateCancelPenaltyCents: def.lateCancelPenaltyCents,
      })),
    )
    .returning()

  const sessionRows: (typeof classSessions.$inferInsert)[] = []
  const from = addDays(today, -35)
  const to = addDays(today, 21)
  for (const template of templateRows) {
    for (let cursor = new Date(from); cursor <= to; cursor = addDays(cursor, 1)) {
      if (cursor.getUTCDay() !== template.dayOfWeek) continue
      const startsAt = atTime(cursor, template.startTime)
      if (startsAt < new Date(template.startsOn)) continue
      sessionRows.push({
        templateId: template.id,
        branchId: template.branchId,
        title: template.title,
        trainerId: template.trainerId,
        roomId: template.roomId,
        startsAt,
        endsAt: addMinutes(startsAt, template.durationMin),
        capacity: template.capacity,
        status: startsAt < now ? 'COMPLETED' : 'SCHEDULED',
        creditCost: template.creditCost,
        cancelWindowHours: template.cancelWindowHours,
        lateCancelPenaltyCents: template.lateCancelPenaltyCents,
      })
    }
  }
  const insertedSessions = await db.insert(classSessions).values(sessionRows).returning()

  /* Bookings + attendance ------------------------------------------------ */
  const activeMembers = insertedMemberships.filter((m) => m.status === 'ACTIVE')
  const bookingRows: (typeof bookings.$inferInsert)[] = []
  const attendanceRows: (typeof attendance.$inferInsert)[] = []

  for (const session of insertedSessions) {
    const isPast = session.startsAt < now
    const target = Math.min(
      session.capacity + randInt(0, 4),
      Math.max(3, Math.round(session.capacity * (isPast ? 0.6 + rand() * 0.4 : 0.25 + rand() * 0.75))),
    )
    const shuffled = [...activeMembers].sort(() => rand() - 0.5).slice(0, target)

    shuffled.forEach((membership, index) => {
      const seated = index < session.capacity
      if (!seated) {
        bookingRows.push({
          sessionId: session.id,
          memberId: membership.memberId,
          status: 'WAITLISTED',
          waitlistPosition: index - session.capacity + 1,
          bookedAt: addDays(session.startsAt, -randInt(1, 6)),
        })
        return
      }

      let status = 'BOOKED'
      let attendedAt: Date | null = null
      if (isPast) {
        const roll = rand()
        if (roll < 0.82) {
          status = 'ATTENDED'
          attendedAt = session.startsAt
        } else if (roll < 0.94) {
          status = 'NO_SHOW'
        } else {
          status = 'CANCELLED'
        }
      }

      bookingRows.push({
        sessionId: session.id,
        memberId: membership.memberId,
        status,
        bookedAt: addDays(session.startsAt, -randInt(1, 9)),
        attendedAt,
        cancelledAt: status === 'CANCELLED' ? addDays(session.startsAt, -1) : null,
        lateCancel: status === 'CANCELLED' && chance(0.4),
      })

      if (status === 'ATTENDED') {
        attendanceRows.push({
          memberId: membership.memberId,
          branchId: session.branchId,
          sessionId: session.id,
          method: chance(0.7) ? 'QR' : 'MANUAL',
          checkedInAt: addMinutes(session.startsAt, -randInt(0, 12)),
          checkedInBy: chance(0.3) ? frontDeskId : null,
        })
      }
    })
  }

  // General gym visits (no class attached). Hours follow a fixed early-morning / lunch /
  // evening rotation so the peak-hour chart shows a believable double hump.
  const VISIT_HOURS = [6, 7, 7, 8, 12, 12, 13, 17, 18, 18, 19, 19, 20, 20]
  const VISIT_MINUTES = ['05', '15', '30', '45']
  activeMembers.forEach((membership, memberIndex) => {
    const visits = randInt(2, 12)
    for (let i = 0; i < visits; i++) {
      const day = addDays(today, -randInt(0, 34))
      const hour = VISIT_HOURS[(memberIndex * 3 + i) % VISIT_HOURS.length]!
      const minute = VISIT_MINUTES[(memberIndex + i) % VISIT_MINUTES.length]!
      const checkedInAt = atTime(day, `${String(hour).padStart(2, '0')}:${minute}`)
      if (checkedInAt > now) continue
      attendanceRows.push({
        memberId: membership.memberId,
        branchId: membership.branchId!,
        method: (memberIndex + i) % 3 === 0 ? 'MANUAL' : 'QR',
        checkedInAt,
        checkedInBy: (memberIndex + i) % 5 === 0 ? frontDeskId : null,
      })
    }
  })

  await chunkedInsert(db, bookings, bookingRows)
  await chunkedInsert(db, attendance, attendanceRows)

  /* Notes, announcements, audit, settings -------------------------------- */
  await db.insert(memberNotes).values([
    { memberId: insertedMembers[0]!.id, authorId: frontDeskId, body: 'Prefers the 6:30am HIIT slot. Asked about annual upgrade in November.', isPinned: true },
    { memberId: insertedMembers[0]!.id, authorId: managerId, body: 'Doctor note on file for shoulder - cleared for all classes.', isPinned: false },
    { memberId: insertedMembers[1]!.id, authorId: frontDeskId, body: 'Payment failed twice; card expires 03/27. Called, will update card.', isPinned: true },
    { memberId: insertedMembers[2]!.id, authorId: frontDeskId, body: 'Bringing a guest next week - day pass to be invoiced.', isPinned: false },
  ])

  await db.insert(announcements).values([
    { title: 'New 6:30am HIIT slot', body: 'Starting Monday we have added a second early HIIT class with Nadia. Book in the app.', audience: 'MEMBERS', channels: ['PUSH', 'EMAIL'], status: 'SENT', sentAt: addDays(now, -6), createdBy: managerId },
    { title: 'Riverside pool maintenance', body: 'The Riverside sauna is closed Tuesday 09:00-13:00 for servicing.', audience: 'ALL', channels: ['PUSH', 'IN_APP'], status: 'SENT', sentAt: addDays(now, -2), createdBy: adminId },
    { title: 'Winter challenge starts 1 December', body: 'Complete 12 classes in December and get a free month. Tracking is automatic.', audience: 'MEMBERS', channels: ['PUSH', 'EMAIL', 'SMS'], status: 'DRAFT', createdBy: adminId },
  ])

  await db.insert(auditLogs).values([
    { actorId: adminId, actorEmail: 'admin@ironhouse.test', action: 'plan.create', entity: 'plan', entityId: planRows[3]!.id, meta: { name: planRows[3]!.name }, createdAt: addDays(now, -30) },
    { actorId: managerId, actorEmail: 'manager@ironhouse.test', action: 'class.create', entity: 'class_template', entityId: templateRows[0]!.id, meta: { title: templateRows[0]!.title }, createdAt: addDays(now, -14) },
    { actorId: frontDeskId, actorEmail: 'frontdesk@ironhouse.test', action: 'member.create', entity: 'user', entityId: insertedMembers[3]!.id, meta: { source: 'front desk' }, createdAt: addDays(now, -9) },
    { actorId: managerId, actorEmail: 'manager@ironhouse.test', action: 'payment.refund', entity: 'payment', entityId: refundTargets[0] ? String(refundTargets[0].providerRef) : null, meta: { reason: 'Duplicate charge' }, createdAt: addDays(now, -5) },
  ])

  await db.insert(appSettings).values([
    { key: 'gym', value: { name: 'Ironhouse Fitness', supportEmail: 'help@ironhouse.test', supportPhone: '+1 212 555 0100', currency: 'USD' }, updatedBy: adminId },
    { key: 'checkin', value: { qrEnabled: true, qrTtlSeconds: 90, allowManualOverride: true, cooldownMinutes: 30 }, updatedBy: adminId },
    { key: 'billing', value: { autoRenewReminderDays: 7, retryFailedPayments: true, retryScheduleDays: [1, 3, 7], taxRatePercent: 0 }, updatedBy: adminId },
    { key: 'classes', value: { defaultCancelWindowHours: 6, defaultCapacity: 20, waitlistEnabled: true, autoPromoteWaitlist: true }, updatedBy: adminId },
  ])

  return {
    branches: branchRows.length,
    staff: staffRows.length,
    members: insertedMembers.length,
    plans: planRows.length,
    memberships: insertedMemberships.length,
    sessions: insertedSessions.length,
    bookings: bookingRows.length,
    attendance: attendanceRows.length,
    invoices: insertedInvoices.length,
  }
}
