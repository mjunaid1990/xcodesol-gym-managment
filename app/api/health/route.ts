import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { getDb, hasDatabaseUrl } from '@/lib/db/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `/api/health` is the liveness probe (uptime monitors hit this), and it also reports
 * database reachability so a broken connection is visible before users notice.
 */
export async function GET() {
  const startedAt = Date.now()
  let database: 'ok' | 'error' = 'error'
  let detail: string | undefined

  try {
    const db = await getDb()
    await db.execute(sql`select 1`)
    database = 'ok'
  } catch (error) {
    detail = error instanceof Error ? error.message.slice(0, 200) : 'unknown'
  }

  const body = {
    status: database === 'ok' ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    checks: {
      database,
      databaseMode: hasDatabaseUrl() ? 'postgres' : 'embedded',
      auth: process.env.AUTH_SECRET ? 'configured' : 'missing',
      payments: process.env.STRIPE_SECRET_KEY ? 'stripe' : 'mock',
    },
    latencyMs: Date.now() - startedAt,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    detail,
  }

  return NextResponse.json(body, { status: database === 'ok' ? 200 : 503 })
}
