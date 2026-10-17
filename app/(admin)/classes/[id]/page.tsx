import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { getSessionRoster } from '@/lib/services/scheduling'
import { can, type Role } from '@/lib/constants'
import { ActionButton } from '@/components/ActionForm'
import { Badge, Card, EmptyState, PageHeader, StatCard, Table, formatDate, formatTime, statusTone } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffUser('class:read')
  const { id } = await params
  const db = await getDb()

  let roster: Awaited<ReturnType<typeof getSessionRoster>>
  try {
    roster = await getSessionRoster(db, id)
  } catch {
    notFound()
  }

  const { session } = roster
  const booked = roster.roster.filter((row) => row.status === 'BOOKED' || row.status === 'ATTENDED')
  const waitlisted = roster.roster.filter((row) => row.status === 'WAITLISTED')
  const noShows = roster.roster.filter((row) => row.status === 'NO_SHOW')
  const canCheckIn = can(user.role as Role, 'attendance:write')
  const canManage = can(user.role as Role, 'class:write')

  return (
    <>
      <PageHeader
        title={session.title}
        subtitle={`${formatDate(session.startsAt)} · ${formatTime(session.startsAt)} – ${formatTime(session.endsAt)} · ${roster.branch?.name ?? ''} ${roster.room ? `· ${roster.room.name}` : ''}`}
        actions={
          <>
            <Link href="/classes" className="rounded-xl border border-ink-600 bg-ink-700 px-4 py-3 text-sm">
              Timetable
            </Link>
            {canManage && session.status === 'SCHEDULED' ? (
              <ActionButton
                endpoint={`/api/v1/classes/${session.id}/cancel`}
                body={{ reason: 'Cancelled from the roster' }}
                label="Cancel class"
                variant="danger"
                size="md"
                confirmMessage="Cancel this class and release everyone booked?"
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Booked" value={`${booked.length}/${session.capacity}`} tone="accent" />
        <StatCard label="Waitlisted" value={String(waitlisted.length)} tone={waitlisted.length ? 'warning' : 'default'} />
        <StatCard label="Checked in" value={String(roster.roster.filter((row) => row.checkedIn).length)} tone="positive" />
        <StatCard label="Status" value={session.status} hint={session.cancellationReason ?? session.notes ?? undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card title="Roster" description="Health notes are shown so the trainer can adapt the session" padded={false}>
          {roster.roster.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Nobody is booked yet" hint="Share the class in an announcement, or check in walk-ins at the desk." />
            </div>
          ) : (
            <Table head={['Member', 'Status', 'Health notes', 'Booked', '']}>
              {roster.roster.map((row) => (
                <tr key={row.bookingId} className="hover:bg-ink-800/40">
                  <td className="px-4 py-3">
                    <Link href={`/members/${row.memberId}`} className="font-medium hover:text-lime-500">
                      {row.firstName} {row.lastName}
                    </Link>
                    <p className="text-xs text-ink-400">{row.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                    {row.waitlistPosition ? <span className="ml-2 text-xs text-ink-400">#{row.waitlistPosition}</span> : null}
                    {row.checkedIn ? <Badge tone="positive">checked in</Badge> : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-300">{row.healthNotes ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-ink-400">{formatDate(row.bookedAt)}</td>
                  <td className="px-4 py-3">
                    {canCheckIn ? (
                      <span className="flex flex-wrap gap-2">
                        {!row.checkedIn ? (
                          <ActionButton
                            endpoint={`/api/v1/classes/${session.id}/check-in`}
                            body={{ memberId: row.memberId }}
                            label="Check in"
                            variant="primary"
                          />
                        ) : null}
                        <ActionButton
                          endpoint={`/api/v1/bookings/${row.bookingId}`}
                          method="PATCH"
                          body={{ status: 'ATTENDED' }}
                          label="Attended"
                        />
                        <ActionButton
                          endpoint={`/api/v1/bookings/${row.bookingId}`}
                          method="PATCH"
                          body={{ status: 'NO_SHOW' }}
                          label="No-show"
                        />
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Class settings">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">Trainer</dt>
                <dd>{roster.trainer ? `${roster.trainer.firstName} ${roster.trainer.lastName}` : 'Unassigned'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">Credit cost</dt>
                <dd>{session.creditCost} credit(s)</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">Free cancellation</dt>
                <dd>{session.cancelWindowHours}h before</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">Late-cancel fee</dt>
                <dd>{(session.lateCancelPenaltyCents / 100).toFixed(2)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">No-shows</dt>
                <dd>{noShows.length}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Waitlist">
            {waitlisted.length === 0 ? (
              <p className="text-sm text-ink-400">Nobody waiting. Spare seats can be sold at the desk.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {waitlisted.map((row) => (
                  <li key={row.bookingId} className="flex items-center justify-between gap-3">
                    <span>
                      #{row.waitlistPosition} {row.firstName} {row.lastName}
                    </span>
                    <ActionButton
                      endpoint={`/api/v1/bookings/${row.bookingId}`}
                      body={{ status: 'ATTENDED' }}
                      label="Force seat"
                      title="Promote manually (capacity permitting)"
                    />
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
