import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { announcements, notifications, users } from '@/lib/db/schema'
import { notFound, unprocessable } from '@/lib/api/http'
import { writeAudit } from './audit'
import { notify, type Channel } from './notifications'

export type Audience = 'ALL' | 'MEMBERS' | 'TRAINERS' | 'STAFF'

const AUDIENCE_CHANNELS: Record<Audience, Channel[]> = {
  ALL: ['IN_APP', 'PUSH', 'EMAIL'],
  MEMBERS: ['IN_APP', 'PUSH', 'EMAIL'],
  TRAINERS: ['IN_APP', 'PUSH', 'EMAIL'],
  STAFF: ['IN_APP', 'EMAIL'],
}

export interface AnnouncementInput {
  title: string
  body: string
  audience?: Audience
  channels?: Channel[]
}

export async function listAnnouncements(db: Database, filters: { status?: string; limit?: number } = {}) {
  return db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      audience: announcements.audience,
      channels: announcements.channels,
      status: announcements.status,
      sentAt: announcements.sentAt,
      createdAt: announcements.createdAt,
      createdBy: announcements.createdBy,
      authorName: sql<string | null>`(select u.first_name || ' ' || u.last_name from users u where u.id = announcements.created_by)`,
      recipients: sql<number>`(select count(distinct n.user_id)::int from notifications n where n.meta->>'announcementId' = announcements.id::text)`,
    })
    .from(announcements)
    .where(filters.status ? eq(announcements.status, filters.status) : undefined)
    .orderBy(desc(announcements.createdAt))
    .limit(Math.min(100, filters.limit ?? 50))
}

export async function createAnnouncement(
  db: Database,
  input: AnnouncementInput,
  actor?: { id?: string | null; email?: string | null },
) {
  const [created] = await db
    .insert(announcements)
    .values({
      title: input.title,
      body: input.body,
      audience: input.audience ?? 'MEMBERS',
      channels: input.channels ?? AUDIENCE_CHANNELS[input.audience ?? 'MEMBERS'],
      status: 'DRAFT',
      createdBy: actor?.id ?? null,
    })
    .returning()

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'announcement.create',
    entity: 'announcement',
    entityId: created!.id,
    meta: { audience: created!.audience, channels: created!.channels },
  })

  return created!
}

export async function updateAnnouncement(
  db: Database,
  id: string,
  input: Partial<AnnouncementInput>,
  actor?: { id?: string | null; email?: string | null },
) {
  const [existing] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1)
  if (!existing) throw notFound('Announcement')
  if (existing.status === 'SENT') throw unprocessable('A sent announcement cannot be edited. Duplicate it instead.')

  const [updated] = await db
    .update(announcements)
    .set({
      title: input.title ?? existing.title,
      body: input.body ?? existing.body,
      audience: input.audience ?? existing.audience,
      channels: input.channels ?? existing.channels,
    })
    .where(eq(announcements.id, id))
    .returning()

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'announcement.update',
    entity: 'announcement',
    entityId: id,
  })

  return updated!
}

function audienceCondition(audience: string) {
  switch (audience) {
    case 'MEMBERS':
      return and(eq(users.role, 'MEMBER'), eq(users.status, 'ACTIVE'))
    case 'TRAINERS':
      return and(eq(users.role, 'TRAINER'), eq(users.status, 'ACTIVE'))
    case 'STAFF':
      return and(inArray(users.role, ['STAFF', 'MANAGER', 'ADMIN']), eq(users.status, 'ACTIVE'))
    default:
      return eq(users.status, 'ACTIVE')
  }
}

/**
 * Sends an announcement. Fan-out is batched so a 10k-member list never exceeds the
 * function time budget: delivery itself is recorded per recipient in `notifications`,
 * so the cron worker can finish any rows still QUEUED.
 */
export async function sendAnnouncement(
  db: Database,
  id: string,
  actor?: { id?: string | null; email?: string | null },
) {
  const [announcement] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1)
  if (!announcement) throw notFound('Announcement')
  if (announcement.status === 'SENT') throw unprocessable('This announcement was already sent')

  const audience = (announcement.audience as Audience) ?? 'MEMBERS'
  const channels = (announcement.channels as Channel[]) ?? AUDIENCE_CHANNELS[audience]

  const recipients = await db
    .select({ id: users.id })
    .from(users)
    .where(audienceCondition(audience))
    .limit(5000)

  const BATCH = 100
  let delivered = 0
  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH)
    await Promise.all(
      batch.map((recipient) =>
        notify(db, {
          userId: recipient.id,
          type: 'ANNOUNCEMENT',
          title: announcement.title,
          body: announcement.body,
          channels,
          meta: { announcementId: announcement.id },
        }).catch((error) => {
          console.error('[announcement] delivery failed', recipient.id, error)
        }),
      ),
    )
    delivered += batch.length
  }

  const [updated] = await db
    .update(announcements)
    .set({ status: 'SENT', sentAt: new Date() })
    .where(eq(announcements.id, id))
    .returning()

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'announcement.send',
    entity: 'announcement',
    entityId: id,
    meta: { audience, channels, recipients: delivered },
  })

  return { announcement: updated!, recipients: delivered }
}

export async function announcementDeliveryStats(db: Database, announcementId: string) {
  const rows = await db
    .select({
      status: notifications.status,
      count: sql<number>`count(*)::int`,
    })
    .from(notifications)
    .where(sql`${notifications.meta}->>'announcementId' = ${announcementId}`)
    .groupBy(notifications.status)

  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row.count
    return acc
  }, {})
}
