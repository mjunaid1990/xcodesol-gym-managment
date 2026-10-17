import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { floorStats, listVisits } from '@/lib/services/attendance'
import { Badge, Card, EmptyState, PageHeader, Table, formatTime, statusTone } from '@/components/ui'
import { CheckInDesk } from './CheckInDesk'

export const metadata = { title: 'Check-in' }
export const dynamic = 'force-dynamic'

export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ branchId?: string }> }) {
  const user = await requireStaffUser('attendance:write')
  const params = await searchParams
  const branchId = params.branchId ?? user.branchId ?? undefined
  const db = await getDb()

  const [floor, recent] = await Promise.all([
    floorStats(db, branchId),
    listVisits(db, { branchId, limit: 25 }),
  ])

  return (
    <>
      <PageHeader
        title="Check-in"
        subtitle="Scan a member's rotating QR pass, or search by name, email or phone. Green means a valid membership."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <CheckInDesk branchId={branchId} />

        <div className="flex flex-col gap-4">
          <Card title="Live floor">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-ink-400">Check-ins today</dt>
                <dd className="stat-value mt-1 text-2xl text-lime-500">{floor.visitsToday}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">Unique members</dt>
                <dd className="stat-value mt-1 text-2xl">{floor.uniqueToday}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">Last hour</dt>
                <dd className="stat-value mt-1 text-xl">{floor.visitsLastHour}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">Classes today</dt>
                <dd className="stat-value mt-1 text-xl">{floor.classesToday}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Next classes" padded={false}>
            {floor.upcomingClasses.length === 0 ? (
              <div className="p-5">
                <EmptyState title="Nothing scheduled in the next few hours" />
              </div>
            ) : (
              <ul className="divide-y divide-ink-800">
                {floor.upcomingClasses.map((session) => (
                  <li key={session.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium">{session.title}</p>
                      <p className="text-xs text-ink-400">
                        {formatTime(session.startsAt)} · {session.trainer ?? 'Unassigned'} · {session.room ?? 'Floor'}
                      </p>
                    </div>
                    <span className="stat-value text-xs">
                      {session.booked}/{session.capacity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-4" title="Today's arrivals" description={`${recent.total} visits logged for this branch`} padded={false}>
        {recent.rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No check-ins yet" hint="The first scan of the day will appear here instantly." />
          </div>
        ) : (
          <Table head={['Time', 'Member', 'Method', 'Class', 'Membership']}>
            {recent.rows.map((visit) => (
              <tr key={visit.id} className="hover:bg-ink-800/40">
                <td className="px-4 py-3">{formatTime(visit.checkedInAt)}</td>
                <td className="px-4 py-3">
                  <span className="font-medium">{visit.memberName}</span>
                  <p className="text-xs text-ink-400">{visit.memberPhone ?? visit.memberEmail}</p>
                </td>
                <td className="px-4 py-3">
                  <Badge tone="info">{visit.method}</Badge>
                </td>
                <td className="px-4 py-3 text-ink-300">{visit.sessionTitle ?? 'Gym floor'}</td>
                <td className="px-4 py-3 text-xs text-ink-400">{visit.branchName ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <p className="mt-4 text-xs text-ink-400">
        Statuses: <Badge tone={statusTone('ACTIVE')}>active</Badge> admitted automatically ·{' '}
        <Badge tone={statusTone('FROZEN')}>frozen</Badge> needs an override with a reason ·{' '}
        <Badge tone={statusTone('EXPIRED')}>expired</Badge> send them to the desk to renew.
      </p>
    </>
  )
}
