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

  const [payloadRes, floorRes, sessionsRes, expiringRes, settingsRes] = await Promise.allSettled([
    dashboardPayload(db, range),
    floorStats(db, branchId),
    todaysSessions(db, branchId),
    listMemberships(db, { status: 'ACTIVE', branchId, expiringInDays: 7, pageSize: 8 }),
    getSettingSections(db),
  ])

  if (payloadRes.status === 'rejected') console.error('dashboardPayload error:', payloadRes.reason)
  if (floorRes.status === 'rejected') console.error('floorStats error:', floorRes.reason)
  if (sessionsRes.status === 'rejected') console.error('todaysSessions error:', sessionsRes.reason)
  if (expiringRes.status === 'rejected') console.error('listMemberships error:', expiringRes.reason)
  if (settingsRes.status === 'rejected') console.error('getSettingSections error:', settingsRes.reason)

  const payload = payloadRes.status === 'fulfilled' ? payloadRes.value : null
  const floor = floorRes.status === 'fulfilled' ? floorRes.value : { visitsToday: 0, uniqueToday: 0, visitsLastHour: 0, classesToday: 0, classSeatsBooked: 0, upcomingClasses: [], recentVisits: [] }
  const sessions = sessionsRes.status === 'fulfilled' ? sessionsRes.value : []
  const expiring = expiringRes.status === 'fulfilled' ? expiringRes.value : { rows: [], total: 0, page: 1, pageSize: 8 }
  const settings = settingsRes.status === 'fulfilled' ? settingsRes.value : { gym: {}, checkin: {}, billing: {}, classes: {}, updatedAt: null }

  const gymName = (settings?.gym as { name?: string } | undefined)?.name ?? 'Ironhouse Fitness'
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
    <div className="space-y-6">
      <PageHeader
        title={`Good to see you, ${user.firstName}`}
        subtitle={`${gymName} · last 30 days${branchId ? ' · your branch' : ' · all locations'}`}
        actions={
          <div className="flex items-center gap-2.5">
            <Link
              href="/checkin"
              className="group inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs sm:text-sm font-semibold text-ink-950 shadow-[0_0_20px_rgba(255,255,255,0.2)] transition-all hover:bg-zinc-200 active:scale-95"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75zM6.75 16.5h.75v.75h-.75zM16.5 6.75h.75v.75h-.75zM13.5 13.5h2.25v2.25H13.5zM17.25 17.25h3v3h-3z" />
              </svg>
              <span>Quick Check-in</span>
            </Link>
            <Link
              href="/classes"
              className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-xs sm:text-sm font-medium text-ink-200 transition-all hover:bg-white/[0.08] hover:text-white"
            >
              <svg className="h-4 w-4 text-ink-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              <span>Timetable</span>
            </Link>
            <Link
              href="/reports"
              className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-xs sm:text-sm font-medium text-ink-200 transition-all hover:bg-white/[0.08] hover:text-white"
            >
              <svg className="h-4 w-4 text-ink-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              <span>Reports</span>
            </Link>
          </div>
        }
      />

      {/* 4 Primary KPI Stat Cards with Custom Icons */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Revenue (30d)"
          value={money(metrics.netRevenueCents)}
          hint={`${metrics.paymentsCount} payments · ${metrics.failedPayments} failed`}
          tone="accent"
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Active members"
          value={String(metrics.activeMembers)}
          hint={`${metrics.newMembers} joined · ${metrics.frozenMembers} frozen`}
          tone="positive"
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          }
        />
        <StatCard
          label="Monthly Churn"
          value={`${metrics.churnRatePercent}%`}
          hint={`${metrics.cancelledInRange} cancellations`}
          tone={metrics.churnRatePercent > 8 ? 'danger' : 'default'}
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-1.363m-3.182 1.363l-1.364-3.182" />
            </svg>
          }
        />
        <StatCard
          label="Outstanding"
          value={money(metrics.outstandingCents)}
          hint={`${metrics.outstandingInvoices} open invoices`}
          tone={metrics.outstandingCents > 0 ? 'warning' : 'positive'}
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          }
        />
      </div>

      {/* Revenue Area Sparkline & Live Floor Monitor */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Revenue Performance" description="Net billed amount by day over the last 30 days" className="lg:col-span-2">
          <Sparkline
            points={(payload?.revenue ?? []).map((point) => point.value)}
            label={`Last 30 days · ${money(metrics.revenueCents)} billed total`}
          />
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-4">
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
              <p className="text-[11px] font-medium text-ink-400">Refunded</p>
              <p className="stat-value mt-1 text-sm sm:text-base font-semibold text-rose-400">{money(metrics.refundedCents)}</p>
            </div>
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
              <p className="text-[11px] font-medium text-ink-400">Per active member</p>
              <p className="stat-value mt-1 text-sm sm:text-base font-semibold text-white">{money(metrics.averageRevenuePerMemberCents)}</p>
            </div>
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
              <p className="text-[11px] font-medium text-ink-400">Class fill rate</p>
              <p className="stat-value mt-1 text-sm sm:text-base font-semibold text-emerald-400">{metrics.fillRatePercent}%</p>
            </div>
          </div>
        </Card>

        {/* Live Floor Monitor */}
        <Card
          title="Live Floor"
          description={`${floor?.visitsToday ?? 0} check-ins recorded today`}
          actions={
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>LIVE</span>
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
              <p className="text-xs text-ink-400">Unique visitors</p>
              <p className="stat-value mt-1 text-2xl font-bold text-white">{floor?.uniqueToday ?? 0}</p>
            </div>
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
              <p className="text-xs text-ink-400">Past 60 mins</p>
              <p className="stat-value mt-1 text-2xl font-bold text-emerald-400">{floor?.visitsLastHour ?? 0}</p>
            </div>
          </div>

          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <p className="text-[11px] font-semibold tracking-wider uppercase text-ink-400 mb-2">Recent activity</p>
            <ul className="space-y-2">
              {(floor?.recentVisits ?? []).slice(0, 5).map((visit) => {
                const initials = visit.memberName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
                return (
                  <li key={visit.id} className="flex items-center justify-between gap-3 text-xs p-1.5 rounded-xl hover:bg-white/[0.03] transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[10px] font-bold text-white">
                        {initials}
                      </div>
                      <span className="truncate font-medium text-ink-200">{visit.memberName}</span>
                    </div>
                    <span className="flex items-center gap-1.5 text-ink-400 text-[11px] shrink-0 font-mono">
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.05] text-[10px] text-ink-300">{visit.method}</span>
                      {formatTime(visit.checkedInAt)}
                    </span>
                  </li>
                )
              })}
              {(!floor?.recentVisits || floor.recentVisits.length === 0) ? (
                <li className="text-xs text-ink-400 py-4 text-center">Nobody has checked in yet today.</li>
              ) : null}
            </ul>
          </div>
        </Card>
      </div>

      {/* Timetable & Peak Hours */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Today's Timetable" description="Next upcoming class sessions on the floor" className="lg:col-span-2" padded={false}>
          {nextSessions.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No classes left today" hint="Schedule a one-off class or setup recurring timetable slots." />
            </div>
          ) : (
            <Table head={['Class', 'Trainer', 'Starts', 'Fill & Capacity']}>
              {nextSessions.map((session) => {
                const fillPercent = session.capacity > 0 ? Math.round(((session.bookedCount ?? 0) / session.capacity) * 100) : 0
                return (
                  <tr key={session.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3.5">
                      <Link href={`/classes/${session.id}`} className="font-semibold text-white hover:text-zinc-300 transition-colors">
                        {session.title}
                      </Link>
                      <p className="text-xs text-ink-400">{session.roomName ?? 'Main floor'}</p>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-ink-300 font-medium">{session.trainerName ?? 'Unassigned'}</td>
                    <td className="px-4 py-3.5 text-xs font-mono text-ink-200">{formatTime(session.startsAt)}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-20 bg-white/[0.06] rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${fillPercent >= 100 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                            style={{ width: `${Math.min(100, fillPercent)}%` }}
                          />
                        </div>
                        <span className="stat-value text-xs text-ink-200">
                          {session.bookedCount}/{session.capacity}
                        </span>
                        {session.waitlistCount > 0 ? (
                          <Badge tone="warning">{session.waitlistCount} waiting</Badge>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </Table>
          )}
        </Card>

        <Card title="Peak Hours" description="Check-in distribution by hour">
          <PeakHours branchId={branchId} />
        </Card>
      </div>

      {/* Renewals Due & Popular Classes */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Renewals Due Soon" description="Memberships expiring in the next 7 days" padded={false}>
          {(!expiring?.rows || expiring.rows.length === 0) ? (
            <div className="p-6">
              <EmptyState title="No memberships expiring this week" />
            </div>
          ) : (
            <Table head={['Member', 'Plan', 'Ends', 'Auto-renew']}>
              {expiring.rows.map((row) => (
                <tr key={row.id} className="hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-3.5">
                    <Link href={`/members/${row.memberId}`} className="font-medium text-white hover:text-zinc-300 transition-colors">
                      {row.memberName}
                    </Link>
                    <p className="text-xs text-ink-400">{row.memberEmail}</p>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-ink-300">{row.planName}</td>
                  <td className="px-4 py-3.5 text-xs text-ink-300 font-mono">{formatDate(row.endsAt)}</td>
                  <td className="px-4 py-3.5">
                    <Badge tone={row.autoRenew ? 'positive' : 'warning'}>{row.autoRenew ? 'Active' : 'Off'}</Badge>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Popular Classes" description="Fill rate rank over the last 30 days" padded={false}>
          {(!payload?.utilisation || payload.utilisation.length === 0) ? (
            <div className="p-6">
              <EmptyState title="No class statistics yet" hint="Class fill rates will appear as bookings come in." />
            </div>
          ) : (
            <Table head={['Class', 'Schedule', 'Fill rate', 'No-shows']}>
              {payload.utilisation.map((row) => (
                <tr key={row.sessionId} className="hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-3.5">
                    <Link href={`/classes/${row.sessionId}`} className="font-medium text-white hover:text-zinc-300 transition-colors">
                      {row.title}
                    </Link>
                    <p className="text-xs text-ink-400">{row.trainerName ?? 'Unassigned'}</p>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-ink-300">{relativeTime(row.startsAt)}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="stat-value font-semibold text-white">{row.fillPercent}%</span>
                      <span className="text-[11px] text-ink-400">({row.booked}/{row.capacity})</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-ink-300">{row.noShows}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {/* Membership Mix & Outstanding Payments */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Membership Breakdown" description="Active member distribution and revenue" padded={false}>
          {(!payload?.mix || payload.mix.length === 0) ? (
            <div className="p-6">
              <EmptyState title="No plan breakdown available" />
            </div>
          ) : (
            <Table head={['Plan name', 'Type', 'Active members', 'Revenue (30d)']}>
              {payload.mix.map((row) => (
                <tr key={row.planId} className="hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-3.5 font-medium text-white">{row.planName}</td>
                  <td className="px-4 py-3.5 text-xs text-ink-300 capitalize">{row.planType.replace('_', ' ').toLowerCase()}</td>
                  <td className="px-4 py-3.5 stat-value font-semibold text-white">{row.active}</td>
                  <td className="px-4 py-3.5 font-mono text-emerald-400 font-semibold">{money(row.revenueCents)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Outstanding Invoices" description="Unpaid ledger items ordered by due date" padded={false}>
          {(!payload?.outstanding || payload.outstanding.length === 0) ? (
            <div className="p-6">
              <EmptyState title="All invoices paid up" hint="No open receivables right now." />
            </div>
          ) : (
            <Table head={['Invoice', 'Member', 'Due date', 'Amount']}>
              {payload.outstanding.slice(0, 6).map((row) => (
                <tr key={row.id} className="hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-3.5">
                    <span className="font-mono text-xs text-white">{row.number}</span>
                    <span className="ml-2">
                      <Badge tone={row.ageDays > 14 ? 'danger' : 'warning'}>{row.ageDays}d old</Badge>
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <Link href={`/members/${row.memberId}`} className="text-xs font-medium text-ink-200 hover:text-white transition-colors">
                      {row.memberName}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-ink-300 font-mono">{formatDate(row.dueAt)}</td>
                  <td className="px-4 py-3.5 stat-value font-semibold text-amber-400">{money(row.outstandingCents)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <footer className="pt-4 border-t border-white/[0.06] flex flex-wrap items-center justify-between text-xs text-ink-400 gap-2">
        <p>Live metrics synchronized {new Date().toLocaleString('en-US')}</p>
        <div className="flex items-center gap-3">
          <span>Status guide:</span>
          <Badge tone={statusTone('ACTIVE')}>Active</Badge>
          <Badge tone={statusTone('FROZEN')}>Frozen</Badge>
          <Badge tone={statusTone('EXPIRED')}>Lapsed</Badge>
        </div>
      </footer>
    </div>
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
