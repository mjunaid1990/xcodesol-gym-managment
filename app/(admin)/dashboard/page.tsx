import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { buildRange, dashboardPayload, peakHours } from '@/lib/services/reports'
import { floorStats } from '@/lib/services/attendance'
import { todaysSessions } from '@/lib/services/scheduling'
import { listMemberships } from '@/lib/services/memberships'
import { getSettingSections } from '@/lib/services/settings'
import {
  Badge,
  BarChart,
  Card,
  EmptyState,
  PageHeader,
  Sparkline,
  StatCard,
  Table,
  formatDate,
  formatTime,
  money,
  relativeTime,
  statusTone,
} from '@/components/ui'

export const metadata = { title: 'Overview' }
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await requireStaffUser('report:read')
  const db = await getDb()
  const branchId = user.branchId ?? undefined

  const range = { ...buildRange(null, null, 30), branchId }
  const [payload, floor, sessions, expiring, settings] = await Promise.all([
    dashboardPayload(db, range),
    floorStats(db, branchId),
    todaysSessions(db, branchId),
    listMemberships(db, { status: 'ACTIVE', branchId, expiringInDays: 7, pageSize: 8 }),
    getSettingSections(db),
  ])

  const gymName = (settings?.gym as { name?: string } | undefined)?.name ?? 'Your gym'
  const metrics = payload?.metrics ?? {
    revenueCents: 0,
    refundedCents: 0,
    netRevenueCents: 0,
    paymentsCount: 0,
    failedPayments: 0,
    newMembers: 0,
    activeMembers: 0,
    frozenMembers: 0,
    expiringIn7Days: 0,
    cancelledInRange: 0,
    attendanceTotal: 0,
    uniqueVisitors: 0,
    sessionsHeld: 0,
    seatsBooked: 0,
    fillRatePercent: 0,
    outstandingCents: 0,
    outstandingInvoices: 0,
    averageRevenuePerMemberCents: 0,
    churnRatePercent: 0,
  }
  const nextSessions = (sessions ?? [])
    .filter((session) => {
      if (!session?.startsAt) return false
      const time = new Date(session.startsAt).getTime()
      return !isNaN(time) && time > Date.now() - 15 * 60_000
    })
    .slice(0, 5)

  return (
    <>
      <PageHeader
        title={`Good to see you, ${user.firstName}`}
        subtitle={`${gymName} · last 30 days${branchId ? ' · your branch' : ' · all branches'}`}
        actions={
          <>
            <Link href="/checkin" className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-ink-950 hover:bg-zinc-200 transition-colors shadow-sm">
              Open check-in
            </Link>
            <Link href="/reports" className="rounded-xl border border-ink-700 bg-ink-800 hover:bg-ink-700 hover:text-white px-4 py-3 text-sm text-ink-200 transition-colors">
              Reports
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Revenue (30d)"
          value={money(metrics.netRevenueCents)}
          hint={`${metrics.paymentsCount} payments · ${metrics.failedPayments} failed`}
          tone="accent"
        />
        <StatCard
          label="Active members"
          value={String(metrics.activeMembers)}
          hint={`${metrics.newMembers} joined · ${metrics.frozenMembers} frozen`}
          tone="positive"
        />
        <StatCard
          label="This month's churn"
          value={`${metrics.churnRatePercent}%`}
          hint={`${metrics.cancelledInRange} cancellations`}
          tone={metrics.churnRatePercent > 8 ? 'danger' : 'default'}
        />
        <StatCard
          label="Outstanding"
          value={money(metrics.outstandingCents)}
          hint={`${metrics.outstandingInvoices} open invoices`}
          tone={metrics.outstandingCents > 0 ? 'warning' : 'positive'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Revenue" description="Net of refunds, by day" className="lg:col-span-2">
          <Sparkline points={(payload?.revenue ?? []).map((point) => point.value)} label={`Last 30 days · ${money(metrics.revenueCents)} billed`} />
          <div className="mt-4 grid grid-cols-3 gap-4 border-t border-ink-800 pt-4 text-sm">
            <div>
              <p className="text-xs text-ink-400">Refunded</p>
              <p className="stat-value mt-1">{money(metrics.refundedCents)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-400">Per active member</p>
              <p className="stat-value mt-1">{money(metrics.averageRevenuePerMemberCents)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-400">Class fill rate</p>
              <p className="stat-value mt-1">{metrics.fillRatePercent}%</p>
            </div>
          </div>
        </Card>

        <Card title="Live floor" description={`${floor?.visitsToday ?? 0} check-ins today`}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-400">Unique members</p>
              <p className="stat-value mt-1 text-xl">{floor?.uniqueToday ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-ink-400">Last hour</p>
              <p className="stat-value mt-1 text-xl">{floor?.visitsLastHour ?? 0}</p>
            </div>
          </div>
          <ul className="mt-4 space-y-2 border-t border-ink-800 pt-3">
            {(floor?.recentVisits ?? []).slice(0, 5).map((visit) => (
              <li key={visit.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-ink-200">{visit.memberName}</span>
                <span className="flex items-center gap-2 text-ink-400">
                  {visit.method}
                  {formatTime(visit.checkedInAt)}
                </span>
              </li>
            ))}
            {(!floor?.recentVisits || floor.recentVisits.length === 0) ? <li className="text-xs text-ink-400">Nobody has checked in yet today.</li> : null}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Today's timetable" className="lg:col-span-2" padded={false}>
          {nextSessions.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No classes left today" hint="Create a one-off class or add a recurring slot in the timetable." />
            </div>
          ) : (
            <Table head={['Class', 'Trainer', 'Starts', 'Fill']}>
              {nextSessions.map((session) => (
                <tr key={session.id} className="hover:bg-ink-800/40">
                  <td className="px-4 py-3">
                    <Link href={`/classes/${session.id}`} className="font-medium hover:text-white transition-colors">
                      {session.title}
                    </Link>
                    <p className="text-xs text-ink-400">{session.roomName ?? 'Floor'}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-300">{session.trainerName ?? '—'}</td>
                  <td className="px-4 py-3">{formatTime(session.startsAt)}</td>
                  <td className="px-4 py-3">
                    <span className="stat-value">
                      {session.bookedCount}/{session.capacity}
                    </span>
                    {session.waitlistCount > 0 ? (
                      <Badge tone="warning">{session.waitlistCount} waiting</Badge>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Peak hours" description="Check-ins by hour, last 30 days">
          <PeakHours branchId={branchId} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Renewals due in 7 days" padded={false}>
          {(!expiring?.rows || expiring.rows.length === 0) ? (
            <div className="p-5">
              <EmptyState title="No memberships expiring this week" />
            </div>
          ) : (
            <Table head={['Member', 'Plan', 'Ends', 'Auto-renew']}>
              {expiring.rows.map((row) => (
                <tr key={row.id} className="hover:bg-ink-800/40">
                  <td className="px-4 py-3">
                    <Link href={`/members/${row.memberId}`} className="font-medium hover:text-white transition-colors">
                      {row.memberName}
                    </Link>
                    <p className="text-xs text-ink-400">{row.memberEmail}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-300">{row.planName}</td>
                  <td className="px-4 py-3">{formatDate(row.endsAt)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={row.autoRenew ? 'positive' : 'warning'}>{row.autoRenew ? 'On' : 'Off'}</Badge>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Popular classes" description="Fill rate over the last 30 days" padded={false}>
          {(!payload?.utilisation || payload.utilisation.length === 0) ? (
            <div className="p-5">
              <EmptyState title="No class statistics yet" hint="Class fill rates will appear as bookings come in." />
            </div>
          ) : (
            <Table head={['Class', 'When', 'Fill', 'No-shows']}>
              {payload.utilisation.map((row) => (
                <tr key={row.sessionId} className="hover:bg-ink-800/40">
                  <td className="px-4 py-3">
                    <Link href={`/classes/${row.sessionId}`} className="font-medium hover:text-white transition-colors">
                      {row.title}
                    </Link>
                    <p className="text-xs text-ink-400">{row.trainerName ?? 'Unassigned'}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-300">{relativeTime(row.startsAt)}</td>
                  <td className="px-4 py-3">
                    <span className="stat-value">{row.fillPercent}%</span>
                    <p className="text-xs text-ink-400">
                      {row.booked}/{row.capacity}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-ink-300">{row.noShows}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Membership mix" padded={false}>
          {(!payload?.mix || payload.mix.length === 0) ? (
            <div className="p-5">
              <EmptyState title="No plan breakdown available" />
            </div>
          ) : (
            <Table head={['Plan', 'Type', 'Active', 'Revenue (30d)']}>
              {payload.mix.map((row) => (
                <tr key={row.planId}>
                  <td className="px-4 py-3">{row.planName}</td>
                  <td className="px-4 py-3 text-ink-300">{row.planType.replace('_', ' ').toLowerCase()}</td>
                  <td className="px-4 py-3 stat-value">{row.active}</td>
                  <td className="px-4 py-3">{money(row.revenueCents)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Outstanding payments" description="Oldest first" padded={false}>
          {(!payload?.outstanding || payload.outstanding.length === 0) ? (
            <div className="p-5">
              <EmptyState title="Everyone is paid up" hint="No open invoices right now." />
            </div>
          ) : (
            <Table head={['Invoice', 'Member', 'Due', 'Amount']}>
              {payload.outstanding.slice(0, 6).map((row) => (
                <tr key={row.id} className="hover:bg-ink-800/40">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs">{row.number}</span>
                    <Badge tone={row.ageDays > 14 ? 'danger' : 'warning'}>{row.ageDays}d</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/members/${row.memberId}`} className="hover:text-white transition-colors">
                      {row.memberName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-300">{formatDate(row.dueAt)}</td>
                  <td className="px-4 py-3 stat-value">{money(row.outstandingCents)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <p className="mt-6 text-xs text-ink-400">
        Data refreshed {new Date().toLocaleString('en-US')} · status badges: <Badge tone={statusTone('ACTIVE')}>active</Badge>{' '}
        <Badge tone={statusTone('FROZEN')}>frozen</Badge> <Badge tone={statusTone('EXPIRED')}>lapsed</Badge>
      </p>
    </>
  )
}

async function PeakHours({ branchId }: { branchId?: string }) {
  try {
    const db = await getDb()
    const hours = await peakHours(db, { ...buildRange(null, null, 30), branchId })
    const buckets = (hours ?? [])
      .filter((bucket) => bucket.hour >= 5 && bucket.hour <= 22)
      .map((bucket) => ({ label: `${String(bucket.hour).padStart(2, '0')}:00`, value: bucket.visits }))
    return <BarChart data={buckets} />
  } catch (err) {
    console.error('Failed to load peak hours:', err)
    return <p className="text-xs text-ink-400 p-4">Peak hours data unavailable</p>
  }
}
