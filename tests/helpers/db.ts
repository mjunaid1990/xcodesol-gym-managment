import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { setDbForTests, type Database } from '@/lib/db/client'
import { runMigrations } from '@/lib/db/migrate'
import bcrypt from 'bcryptjs'
import * as schema from '@/lib/db/schema'
import { addDays, addMinutes } from '@/lib/domain/money'

export const TEST_PASSWORD = 'Passw0rd!'

export interface TestContext {
  db: Database
  /**
   * The full cast: one admin, one manager, one front-desk user, one trainer and three
   * members (one with an active unlimited plan, one on a 5-class pack, one lapsed).
   */
  fixtures: Awaited<ReturnType<typeof createFixtures>>
}

/** Fresh in-memory Postgres + applied migrations + the standard fixture set. */
export async function setupTestDb(): Promise<TestContext> {
  const client = new PGlite()
  const db = drizzle(client, { schema }) as unknown as Database
  await runMigrations(db)
  setDbForTests(db)
  const fixtures = await createFixtures(db)
  return { db, fixtures }
}

export async function closeTestDb(): Promise<void> {
  // PGlite instances are garbage collected; the global handle is reset per test file.
}

async function createFixtures(db: Database) {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 8)

  const [downtown, riverside] = await db
    .insert(schema.branches)
    .values([
      { name: 'Downtown', slug: 'downtown', timezone: 'UTC' },
      { name: 'Riverside', slug: 'riverside', timezone: 'UTC' },
    ])
    .returning()

  const [admin, manager, staffUser, trainer, member, packMember, lapsedMember] = await db
    .insert(schema.users)
    .values([
      { email: 'admin@test.dev', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN', passwordHash, branchId: downtown!.id },
      { email: 'manager@test.dev', firstName: 'Mo', lastName: 'Manager', role: 'MANAGER', passwordHash, branchId: downtown!.id },
      { email: 'desk@test.dev', firstName: 'Dee', lastName: 'Desk', role: 'STAFF', passwordHash, branchId: downtown!.id },
      { email: 'trainer@test.dev', firstName: 'Tia', lastName: 'Trainer', role: 'TRAINER', passwordHash, branchId: downtown!.id },
      { email: 'member@test.dev', firstName: 'Mia', lastName: 'Member', phone: '+15550001', role: 'MEMBER', passwordHash, branchId: downtown!.id },
      { email: 'pack@test.dev', firstName: 'Pat', lastName: 'Pack', role: 'MEMBER', passwordHash, branchId: downtown!.id },
      { email: 'lapsed@test.dev', firstName: 'Lou', lastName: 'Lapsed', role: 'MEMBER', passwordHash, branchId: downtown!.id },
    ])
    .returning()

  const [unlimited, classPack, dayPass] = await db
    .insert(schema.plans)
    .values([
      { name: 'Unlimited', type: 'MEMBERSHIP', interval: 'MONTHLY', priceCents: 9900, freezeDaysPerYear: 10 },
      { name: '10-Class Pack', type: 'CLASS_PACK', interval: 'ONE_TIME', priceCents: 15000, classCredits: 10, autoRenew: false },
      { name: 'Day Pass', type: 'DAY_PASS', interval: 'ONE_TIME', priceCents: 1500, classCredits: 1, autoRenew: false },
    ])
    .returning()

  const now = new Date()
  const [unlimitedMembership, packMembership] = await db
    .insert(schema.memberships)
    .values([
      {
        memberId: member!.id,
        planId: unlimited!.id,
        branchId: downtown!.id,
        status: 'ACTIVE',
        priceCents: 9900,
        startsAt: addDays(now, -10),
        endsAt: addDays(now, 20),
      },
      {
        memberId: packMember!.id,
        planId: classPack!.id,
        branchId: downtown!.id,
        status: 'ACTIVE',
        priceCents: 15000,
        startsAt: addDays(now, -5),
        endsAt: addDays(now, 175),
        creditsRemaining: 5,
      },
    ])
    .returning()

  const [room] = await db
    .insert(schema.rooms)
    .values({ branchId: downtown!.id, name: 'Studio A', capacity: 2 })
    .returning()

  const [sessionSoon, sessionLater] = await db
    .insert(schema.classSessions)
    .values([
      {
        branchId: downtown!.id,
        title: 'HIIT',
        trainerId: trainer!.id,
        roomId: room!.id,
        startsAt: addMinutes(now, 120),
        endsAt: addMinutes(now, 180),
        capacity: 2,
        creditCost: 1,
        cancelWindowHours: 6,
        lateCancelPenaltyCents: 1500,
      },
      {
        branchId: downtown!.id,
        title: 'Yoga',
        trainerId: trainer!.id,
        startsAt: addDays(now, 2),
        endsAt: addDays(now, 2),
        capacity: 2,
        creditCost: 1,
        cancelWindowHours: 6,
        lateCancelPenaltyCents: 1500,
      },
    ])
    .returning()

  await db.insert(schema.appSettings).values([
    { key: 'gym', value: { name: 'Test Gym', currency: 'USD' } },
  ])

  return {
    now,
    branches: { downtown: downtown!, riverside: riverside! },
    users: { admin: admin!, manager: manager!, staff: staffUser!, trainer: trainer!, member: member!, packMember: packMember!, lapsedMember: lapsedMember! },
    plans: { unlimited: unlimited!, classPack: classPack!, dayPass: dayPass! },
    memberships: { unlimited: unlimitedMembership!, pack: packMembership! },
    room: room!,
    sessions: { soon: sessionSoon!, later: sessionLater! },
  }
}

/** A Request suitable for calling the API router directly from tests. */
export function apiRequest(
  method: string,
  path: string,
  options: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers(options.headers)
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  if (options.token) headers.set('authorization', `Bearer ${options.token}`)
  return new Request(`http://localhost:3000/api/v1${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

/** Reads the standard `{ data }` envelope, raising a useful error when it is missing. */
export async function readData<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data?: T; error?: { message: string; code: string } }
  if (payload.error) throw new Error(`API error ${payload.error.code}: ${payload.error.message}`)
  if (!('data' in payload)) throw new Error(`No data envelope in response: ${JSON.stringify(payload).slice(0, 200)}`)
  return payload.data as T
}
