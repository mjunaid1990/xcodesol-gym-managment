import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { notifications, users } from '@/lib/db/schema'

export type NotificationType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'WAITLIST_PROMOTED'
  | 'CLASS_REMINDER'
  | 'MEMBERSHIP_EXPIRING'
  | 'MEMBERSHIP_EXPIRED'
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'ANNOUNCEMENT'

export type Channel = 'IN_APP' | 'PUSH' | 'EMAIL' | 'SMS'

export interface NotifyInput {
  userId: string
  type: NotificationType
  title: string
  body: string
  channels?: Channel[]
  meta?: Record<string, unknown>
}

/**
 * Outbox pattern: we always persist the notification first, then attempt delivery.
 * Delivery failures are recorded on the row (status = FAILED + error) instead of being
 * thrown, so a flaky SMS gateway can never break a booking transaction.
 */
export async function notify(db: Database, input: NotifyInput): Promise<void> {
  const channels = input.channels?.length ? input.channels : (['IN_APP', 'PUSH'] as Channel[])

  const inserted = await db
    .insert(notifications)
    .values(
      channels.map((channel) => ({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        channel,
        meta: input.meta ?? {},
        status: 'QUEUED',
      })),
    )
    .returning()

  await Promise.all(inserted.map((notification) => deliver(db, notification.id).catch(() => undefined)))
}

export async function deliver(db: Database, notificationId: string): Promise<void> {
  const [row] = await db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1)
  if (!row || row.status === 'SENT' || row.status === 'SIMULATED') return

  const [recipient] = await db
    .select({ email: users.email, phone: users.phone, pushTokens: users.pushTokens, name: users.firstName })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1)
  if (!recipient) {
    await markStatus(db, notificationId, 'FAILED', 'Recipient not found')
    return
  }

  try {
    switch (row.channel) {
      case 'IN_APP':
        await markStatus(db, notificationId, 'SENT')
        return
      case 'PUSH':
        if (!recipient.pushTokens?.length) {
          await markStatus(db, notificationId, 'SIMULATED', 'No registered device')
          return
        }
        await sendExpoPush(recipient.pushTokens, row.title, row.body, row.meta ?? {})
        await markStatus(db, notificationId, 'SENT')
        return
      case 'EMAIL': {
        const apiKey = process.env.RESEND_API_KEY
        if (!apiKey) {
          await markStatus(db, notificationId, 'SIMULATED', 'RESEND_API_KEY not configured')
          return
        }
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM ?? 'Ironhouse Gym <noreply@example.com>',
            to: [recipient.email],
            subject: row.title,
            html: `<div style="font-family:system-ui,sans-serif"><h2>${escapeHtml(row.title)}</h2><p>${escapeHtml(row.body)}</p></div>`,
          }),
        })
        if (!response.ok) throw new Error(`Resend responded ${response.status}`)
        await markStatus(db, notificationId, 'SENT')
        return
      }
      case 'SMS': {
        const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env
        if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !recipient.phone) {
          await markStatus(db, notificationId, 'SIMULATED', 'Twilio not configured')
          return
        }
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: TWILIO_FROM_NUMBER,
              To: recipient.phone,
              Body: `${row.title}\n${row.body}`,
            }),
          },
        )
        if (!response.ok) throw new Error(`Twilio responded ${response.status}`)
        await markStatus(db, notificationId, 'SENT')
        return
      }
      default:
        await markStatus(db, notificationId, 'SENT')
    }
  } catch (error) {
    await markStatus(db, notificationId, 'FAILED', error instanceof Error ? error.message : 'Delivery failed')
  }
}

async function markStatus(
  db: Database,
  id: string,
  status: 'SENT' | 'FAILED' | 'SIMULATED',
  error?: string,
): Promise<void> {
  await db
    .update(notifications)
    .set({ status, error: error ?? null, sentAt: status === 'FAILED' ? null : new Date() })
    .where(eq(notifications.id, id))
}

/** Expo's push service accepts up to 100 messages per request. */
async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(
      tokens.slice(0, 100).map((to) => ({ to, title, body, data, sound: 'default' })),
    ),
  })
  if (!response.ok) throw new Error(`Expo push responded ${response.status}`)
}

export async function markRead(db: Database, userId: string, notificationId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
}

export async function unreadCount(db: Database, userId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), sql`${notifications.readAt} is null`))
  return result[0]?.count ?? 0
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
