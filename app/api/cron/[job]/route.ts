import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { markCompletedSessions } from '@/lib/services/scheduling'
import { runNoShowSweep } from '@/lib/services/bookings'
import { retryOverduePayments, runMembershipSweep } from '@/lib/services/memberships'
import { deliver, notify } from '@/lib/services/notifications'
import { notifications } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { bookings, classSessions } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOBS = ['expiry', 'reminders', 'retries', 'noshow', 'deliver'] as const
type Job = (typeof JOBS)[number]

/**
 * Scheduled work lives here so nothing depends on a long-running process.
 * Vercel Cron calls these with `Authorization: Bearer $CRON_SECRET`; running them by
 * hand (locally) only requires the same header value.
 */
async function run(request: Request, context: { params: Promise<{ job: string }> }): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: { code: 'unauthorized', message: 'Bad cron secret' } }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: { code: 'not_configured', message: 'CRON_SECRET must be set in production' } },
      { status: 501 },
    )
  }

  const { job } = await context.params
  if (!JOBS.includes(job as Job)) {
    return NextResponse.json({ error: { code: 'unknown_job', message: `Unknown job ${job}`, available: JOBS } }, { status: 404 })
  }

  const db = await getDb()
  const startedAt = Date.now()

  switch (job as Job) {
    case 'expiry': {
      const result = await runMembershipSweep(db)
      const completed = await markCompletedSessions(db)
      return NextResponse.json({ job, ...result, ...completed, ms: Date.now() - startedAt })
    }
    case 'reminders': {
      // Class reminders for sessions starting in the next few hours. Expiry and
      // win-back nudges ride along here so members get one consolidated message a day.
      const upcoming = await db
        .select({
          bookingId: bookings.id,
          memberId: bookings.memberId,
          title: classSessions.title,
          startsAt: classSessions.startsAt,
          branchId: classSessions.branchId,
        })
        .from(classSessions)
        .innerJoin(bookings, eq(bookings.sessionId, classSessions.id))
        .where(
          and(
            eq(bookings.status, 'BOOKED'),
            sql`${classSessions.startsAt} between now() + interval '90 minutes' and now() + interval '3 hours'`,
          ),
        )
        .limit(200)

      for (const row of upcoming) {
        await notify(db, {
          userId: row.memberId,
          type: 'CLASS_REMINDER',
          title: `Reminder: ${row.title}`,
          body: `Your class starts at ${row.startsAt.toISOString().slice(11, 16)} UTC. Cancel early if you cannot make it.`,
          channels: ['IN_APP', 'PUSH'],
          meta: { bookingId: row.bookingId, sessionTitle: row.title },
        }).catch(() => undefined)
      }

      return NextResponse.json({ job, reminded: upcoming.length, ms: Date.now() - startedAt })
    }
    case 'retries': {
      const result = await retryOverduePayments(db)
      return NextResponse.json({ job, ...result, ms: Date.now() - startedAt })
    }
    case 'noshow': {
      const result = await runNoShowSweep(db)
      return NextResponse.json({ job, ...result, ms: Date.now() - startedAt })
    }
    case 'deliver': {
      const queued = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.status, 'QUEUED')))
        .limit(200)
      for (const row of queued) {
        await deliver(db, row.id).catch(() => undefined)
      }
      return NextResponse.json({ job, delivered: queued.length, ms: Date.now() - startedAt })
    }
  }
}

export const GET = run
export const POST = run
