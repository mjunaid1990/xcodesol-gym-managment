import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import {
  buildRange,
  classUtilization,
  dashboardPayload,
  membershipMix,
  outstandingInvoices,
  peakHours,
  retentionCohorts,
  trainerPerformance,
} from '@/lib/services/reports'
import { BarChart, Card, EmptyState, PageHeader, Sparkline, StatCard, Table, formatDate, money } from '@/components/ui'
import { Filters } from '@/components/Filters'

export const metadata = { title: 'Reports' }
export const dynamic = 'force-dynamic'

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; branchId?: string }>
}) {
  const user = await requireStaffUser('report:read')
  const params = await searchParams
  const db = await getDb()

  const range = { ...buildRange(params.from, params.to, 30), branchId: params.branchId ?? user.branchId ?? undefined }

  const [payload, utilisation, trainers, outstanding, cohorts, hours, mix] = await Promise.all([
    dashboardPayload(db, range),
    classUtilization(db, range, 15),
    trainerPerformance(db, range),
    outstandingInvoices(db, range.branchId),
    retentionCohorts(db),
    peakHours(db, range),
    membershipMix(db, range),
  ])

  const { metrics } = payload
  const exportBase = `from=${range.from.toISOString().slice(0, 10)}&to=${range.to.toISOString().slice(0, 10)}${range.branchId ? `&branchId=${range.branchId}` : ''}`

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`${formatDate(range.from)} → ${formatDate(range.to)} · exports are CSV and open straight in Excel or Sheets`}
        actions={
          <>
            <Link href={`/api/v1/reports/export?type=payments&${exportBase}`} className="rounded-xl border border-ink-600 bg-ink-700 px-4 py-3 text-sm">
              Revenue CSV
            </Link>
            <Link href={`/api/v1/reports/export?type=attendance&${exportBase}`} className="rounded-xl border border-ink-600 bg-ink-700 px-4 py-3 text-sm">
              Attendance CSV
            </Link>
            <Link href={`/api/v1/reports/export?type=classes&${exportBase}`} className="rounded-xl border border-ink-600 bg-ink-700 px-4 py-3 text-sm">
              Classes CSV
            </Link>
            <Link href={`/api/v1/reports/export?type=bookings&${exportBase}`} className="rounded-xl border border-ink-600 bg-ink-700 px-4 py-3 text-sm">
              Bookings CSV
            </Link>
          </>
        }
      />

      <Filters
        fields={[
          { name: 'from', label: 'From', type: 'date' },
          { name: 'to', label: 'To', type: 'date' },
        ]}
      />

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Net revenue" value={money(metrics.netRevenueCents)} hint={`${metrics.paymentsCount} payments`} tone="accent" />
        <StatCard label="New members" value={String(metrics.newMembers)} hint={`${metrics.activeMembers} active`} />
        <StatCard label="Check-ins" value={String(metrics.attendanceTotal)} hint={`${metrics.uniqueVisitors} unique members`} />
        <StatCard label="Class fill rate" value={`${metrics.fillRatePercent}%`} hint={`${metrics.seatsBooked} seats across ${metrics.sessionsHeld} classes`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Revenue trend" className="lg:col-span-2">
          <Sparkline points={payload.revenue.map((point) => point.value)} label={`Daily net revenue · ${formatDate(range.from)} to ${formatDate(range.to)}`} />
          <div className="mt-4 grid gap-4 border-t border-ink-800 pt-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-ink-400">New signups</p>
              <Sparkline points={payload.signups.map((point) => point.value)} tone="sky" height={40} />
            </div>
            <div>
              <p className="text-xs text-ink-400">Visits</p>
              <Sparkline points={payload.visits.map((point) => point.value)} tone="amber" height={40} />
            </div>
            <div>
              <p className="text-xs text-ink-400">Failed payments</p>
              <p className="stat-value mt-2 text-2xl">{metrics.failedPayments}</p>
              <p className="text-xs text-ink-400">Chase these before they lapse</p>
            </div>
          </div>
        </Card>

        <Card title="Peak hours" description="Check-ins by hour of day">
          <BarChart data={hours.filter((bucket) => bucket.hour >= 5 && bucket.hour <= 22).map((bucket) => ({ label: `${String(bucket.hour).padStart(2, '0')}:00`, value: bucket.visits }))} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Class utilisation" description="Ranked by fill rate" padded={false}>
          {utilisation.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No classes in this range" />
            </div>
          ) : (
            <Table head={['Class', 'When', 'Fill', 'Attended', 'No-show', 'Waitlist']}>
              {utilisation.map((row) => (
                <tr key={row.sessionId}>
                  <td className="px-4 py-3">
                    <Link href={`/classes/${row.sessionId}`} className="font-medium hover:text-lime-500">
                      {row.title}
                    </Link>
                    <p className="text-xs text-ink-400">{row.trainerName ?? 'Unassigned'}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-300">
                    {formatDate(row.startsAt)}
                    <br />
                    {new Date(row.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    <span className="stat-value">{row.fillPercent}%</span>
                    <p className="text-xs text-ink-400">
                      {row.booked}/{row.capacity}
                    </p>
                  </td>
                  <td className="px-4 py-3 stat-value">{row.attended}</td>
                  <td className="px-4 py-3 stat-value">{row.noShows}</td>
                  <td className="px-4 py-3 stat-value">{row.waitlisted}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Trainer performance" description="Taught hours come from the published schedule" padded={false}>
          <Table head={['Trainer', 'Classes', 'Hours', 'Attended', 'No-shows', 'Avg fill']}>
            {trainers.map((row) => (
              <tr key={row.trainerId}>
                <td className="px-4 py-3 font-medium">{row.name}</td>
                <td className="px-4 py-3 stat-value">{row.sessions}</td>
                <td className="px-4 py-3 stat-value">{row.hours}</td>
                <td className="px-4 py-3 stat-value">{row.attendees}</td>
                <td className="px-4 py-3 stat-value">{row.noShows}</td>
                <td className="px-4 py-3 stat-value">{row.averageFillPercent}%</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Retention by signup month" className="lg:col-span-2" padded={false}>
          <Table head={['Cohort', 'Joined', 'Still visiting (30d)', 'Retention']}>
            {cohorts.map((row) => (
              <tr key={row.cohort}>
                <td className="px-4 py-3">{row.cohort}</td>
                <td className="px-4 py-3 stat-value">{row.signedUp}</td>
                <td className="px-4 py-3 stat-value">{row.retained}</td>
                <td className="px-4 py-3">
                  <span className="stat-value">{row.retentionPercent}%</span>
                </td>
              </tr>
            ))}
            {cohorts.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-sm text-ink-400" colSpan={4}>
                  Not enough history yet.
                </td>
              </tr>
            ) : null}
          </Table>
        </Card>

        <Card title="Plan mix" padded={false}>
          <Table head={['Plan', 'Active', 'Revenue']}>
            {mix.map((row) => (
              <tr key={row.planId}>
                <td className="px-4 py-3">{row.planName}</td>
                <td className="px-4 py-3 stat-value">{row.active}</td>
                <td className="px-4 py-3">{money(row.revenueCents)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card className="mt-4" title="Outstanding payments" description={`${outstanding.length} open invoices`} padded={false}>
        {outstanding.length === 0 ? (
          <div className="p-5">
            <EmptyState title="Everyone is paid up" />
          </div>
        ) : (
          <Table head={['Invoice', 'Member', 'Description', 'Due', 'Age', 'Outstanding']}>
            {outstanding.slice(0, 20).map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-mono text-xs">{row.number}</td>
                <td className="px-4 py-3">
                  <Link href={`/members/${row.memberId}`} className="hover:text-lime-500">
                    {row.memberName}
                  </Link>
                  <p className="text-xs text-ink-400">{row.memberEmail}</p>
                </td>
                <td className="px-4 py-3 text-xs text-ink-300">{row.description ?? '—'}</td>
                <td className="px-4 py-3 text-xs">{formatDate(row.dueAt)}</td>
                <td className="px-4 py-3 text-xs">{row.ageDays}d</td>
                <td className="px-4 py-3 stat-value">{money(row.outstandingCents)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  )
}
