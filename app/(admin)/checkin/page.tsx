import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { floorStats, listVisits } from '@/lib/services/attendance'
import { Badge, Card, EmptyState, PageHeader, Table, formatTime, statusTone } from '@/components/ui'
import { CheckInDesk } from './CheckInDesk'

export const metadata = { title: 'Check-in Desk' }
export const dynamic = 'force-dynamic'

export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ branchId?: string }> }) {
  const user = await requireStaffUser('attendance:write')
  const params = (await searchParams) ?? {}
  const branchId = params.branchId ?? user.branchId ?? undefined
  const db = await getDb()

  const [floorResult, recentResult] = await Promise.allSettled([
    floorStats(db, branchId),
    listVisits(db, { branchId, limit: 30 }),
  ])

  const floor =
    floorResult.status === 'fulfilled'
      ? floorResult.value
      : {
          visitsToday: 0,
          uniqueToday: 0,
          visitsLastHour: 0,
          classesToday: 0,
          classSeatsBooked: 0,
          upcomingClasses: [],
          recentVisits: [],
        }

  const recent =
    recentResult.status === 'fulfilled'
      ? recentResult.value
      : {
          rows: [],
          total: 0,
          page: 1,
          pageSize: 30,
        }

  return (
    <>
      <PageHeader
        title="Front Desk & Check-in"
        subtitle="Rapid member entry with real-time pass validation, live floor occupancy, and class attendance."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Left: Check-in Desk Form */}
        <div className="flex flex-col gap-6">
          <CheckInDesk branchId={branchId} />

          {/* Today's Arrivals Log */}
          <Card
            title="Today's Arrivals"
            description={`${recent.total} check-in${recent.total === 1 ? '' : 's'} logged today`}
            padded={false}
          >
            {recent.rows.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  title="No check-ins logged yet today"
                  hint="Member visits will appear here instantly as passes are scanned or verified."
                />
              </div>
            ) : (
              <Table head={['Time', 'Member', 'Method', 'Class Session', 'Branch']}>
                {recent.rows.map((visit) => {
                  const checkInTime = new Date(visit.checkedInAt)
                  return (
                    <tr key={visit.id} className="transition-colors hover:bg-white/[0.03]">
                      <td className="px-5 py-3.5 whitespace-nowrap text-xs font-mono text-ink-300">
                        {formatTime(checkInTime)}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs font-semibold text-white">
                            {visit.memberName
                              .split(' ')
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join('')
                              .toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-white text-sm">{visit.memberName}</p>
                            <p className="text-xs text-ink-400">{visit.memberPhone ?? visit.memberEmail}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge tone={visit.method === 'QR' ? 'positive' : 'info'}>
                          {visit.method}
                        </Badge>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-ink-300">
                        {visit.sessionTitle ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium text-xs">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            {visit.sessionTitle}
                          </span>
                        ) : (
                          <span className="text-ink-400 text-xs">Gym Floor</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-ink-400">
                        {visit.branchName ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </Table>
            )}
          </Card>
        </div>

        {/* Right Sidebar: Live Floor Stats & Upcoming Classes */}
        <div className="flex flex-col gap-6">
          {/* Live Floor Card */}
          <Card title="Live Floor Pulse" description="Real-time occupancy metrics">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Visits Today</span>
                <p className="stat-value mt-1.5 text-2xl font-bold tracking-tight text-white">
                  {floor.visitsToday}
                </p>
                <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live feed
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Unique Members</span>
                <p className="stat-value mt-1.5 text-2xl font-bold tracking-tight text-white">
                  {floor.uniqueToday}
                </p>
                <span className="mt-1 block text-[11px] text-ink-400">Different visitors</span>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Last 60 Mins</span>
                <p className="stat-value mt-1.5 text-2xl font-bold tracking-tight text-emerald-400">
                  {floor.visitsLastHour}
                </p>
                <span className="mt-1 block text-[11px] text-ink-400">Recent entries</span>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Classes Today</span>
                <p className="stat-value mt-1.5 text-2xl font-bold tracking-tight text-white">
                  {floor.classesToday}
                </p>
                <span className="mt-1 block text-[11px] text-ink-400">
                  {floor.classSeatsBooked} booked
                </span>
              </div>
            </div>
          </Card>

          {/* Upcoming Classes */}
          <Card title="Upcoming Classes" description="Next sessions scheduled today" padded={false}>
            {floor.upcomingClasses.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No upcoming classes" hint="No scheduled classes in the next 8 hours." />
              </div>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {floor.upcomingClasses.map((session) => {
                  const startTime = new Date(session.startsAt)
                  const fillPercent = Math.min(100, Math.round((session.booked / Math.max(1, session.capacity)) * 100))
                  return (
                    <li key={session.id} className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.02]">
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-white truncate">{session.title}</p>
                        <p className="text-xs text-ink-400 mt-0.5">
                          {formatTime(startTime)} · {session.trainer ?? 'Trainer TBA'} · {session.room ?? 'Main Floor'}
                        </p>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <span className="text-xs font-semibold text-white">
                          {session.booked}/{session.capacity}
                        </span>
                        <div className="mt-1 h-1.5 w-14 overflow-hidden rounded-full bg-white/[0.08]">
                          <div
                            className={`h-full rounded-full ${
                              fillPercent >= 90 ? 'bg-rose-500' : fillPercent >= 70 ? 'bg-amber-400' : 'bg-emerald-400'
                            }`}
                            style={{ width: `${fillPercent}%` }}
                          />
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* Status Policy Card */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#121216]/60 p-4 backdrop-blur-md">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-300">Admission Rules</h4>
            <ul className="mt-3 space-y-2 text-xs text-ink-400">
              <li className="flex items-center gap-2">
                <Badge tone={statusTone('ACTIVE')}>Active</Badge>
                <span>Admitted instantly upon scan.</span>
              </li>
              <li className="flex items-center gap-2">
                <Badge tone={statusTone('FROZEN')}>Frozen</Badge>
                <span>Requires staff override with reason.</span>
              </li>
              <li className="flex items-center gap-2">
                <Badge tone={statusTone('EXPIRED')}>Expired</Badge>
                <span>Direct member to reception to renew.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  )
}
