import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { branchScheduleContext, listSessions, listTemplates } from '@/lib/services/scheduling'
import { can, type Role } from '@/lib/constants'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import {
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Table,
  formatDate,
  formatTime,
  inputClass,
  selectClass,
  statusTone,
} from '@/components/ui'

export const metadata = { title: 'Timetable' }
export const dynamic = 'force-dynamic'

const DAY_MS = 86_400_000
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; branchId?: string; trainerId?: string; q?: string }>
}) {
  const user = await requireStaffUser('class:read')
  const params = await searchParams
  const db = await getDb()

  const start = params.date ? new Date(`${params.date}T00:00:00.000Z`) : new Date(new Date().setUTCHours(0, 0, 0, 0))
  const end = new Date(start.getTime() + 7 * DAY_MS)
  const branchId = params.branchId ?? undefined

  const [sessions, templates, context] = await Promise.all([
    listSessions(db, { from: start, to: end, branchId, trainerId: params.trainerId, title: params.q, limit: 300 }),
    listTemplates(db, { branchId }),
    branchScheduleContext(db, branchId),
  ])

  const days = Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * DAY_MS))
  const canWrite = can(user.role as Role, 'class:write')

  return (
    <>
      <PageHeader
        title="Timetable"
        subtitle={`${formatDate(start)} → ${formatDate(new Date(end.getTime() - DAY_MS))} · ${sessions.length} sessions`}
        actions={
          <>
            <Link
              href={`/classes?date=${new Date(start.getTime() - 7 * DAY_MS).toISOString().slice(0, 10)}`}
              className="rounded-xl border border-ink-600 bg-ink-700 px-4 py-3 text-sm"
            >
              ← Previous week
            </Link>
            <Link
              href={`/classes?date=${new Date(start.getTime() + 7 * DAY_MS).toISOString().slice(0, 10)}`}
              className="rounded-xl border border-ink-600 bg-ink-700 px-4 py-3 text-sm"
            >
              Next week →
            </Link>
          </>
        }
      />

      <div className="grid gap-4">
        {days.map((day) => {
          const daySessions = sessions.filter((session) => session.startsAt.toISOString().slice(0, 10) === day.toISOString().slice(0, 10))
          const isToday = day.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
          return (
            <Card
              key={day.toISOString()}
              title={`${DAY_NAMES[day.getUTCDay()]} ${formatDate(day)}`}
              description={daySessions.length ? `${daySessions.length} sessions` : 'Nothing scheduled'}
              actions={isToday ? <Badge tone="accent">today</Badge> : null}
              padded={false}
            >
              {daySessions.length === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-400">Free day — good slot for a workshop or a one-off class.</p>
              ) : (
                <Table head={['Time', 'Class', 'Trainer', 'Room', 'Fill', 'Waitlist', 'Status', '']}>
                  {daySessions.map((session) => (
                    <tr key={session.id} className="hover:bg-ink-800/40">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatTime(session.startsAt)} – {formatTime(session.endsAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/classes/${session.id}`} className="font-medium hover:text-white transition-colors">
                          {session.title}
                        </Link>
                        <p className="text-xs text-ink-400">{session.branchName}</p>
                      </td>
                      <td className="px-4 py-3 text-ink-300">{session.trainerName ?? '—'}</td>
                      <td className="px-4 py-3 text-ink-300">{session.roomName ?? 'Floor'}</td>
                      <td className="px-4 py-3">
                        <span className="stat-value">
                          {session.bookedCount}/{session.capacity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {session.waitlistCount > 0 ? <Badge tone="warning">{session.waitlistCount}</Badge> : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={statusTone(session.status)}>{session.status}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {canWrite && session.status === 'SCHEDULED' ? (
                          <ActionButton
                            endpoint={`/api/v1/classes/${session.id}/cancel`}
                            body={{ reason: 'Cancelled from the timetable' }}
                            label="Cancel"
                            variant="danger"
                            confirmMessage="Cancel this class and release everyone booked?"
                          />
                        ) : (
                          <Link href={`/classes/${session.id}`} className="text-xs text-ink-300 hover:text-white transition-colors">
                            Roster →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          )
        })}
      </div>

      <Card className="mt-6" title="Recurring classes" description="Each template generates sessions for the next 8 weeks" padded={false}>
        {templates.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No recurring classes yet" hint="Add a weekly slot below — the studio timetable builds itself." />
          </div>
        ) : (
          <Table head={['Day', 'Time', 'Class', 'Trainer', 'Room', 'Capacity', 'Upcoming', '']}>
            {templates.map((template) => (
              <tr key={template.id} className="hover:bg-ink-800/40">
                <td className="px-4 py-3">{DAY_NAMES[template.dayOfWeek]}</td>
                <td className="px-4 py-3">{template.startTime}</td>
                <td className="px-4 py-3">
                  <span className="font-medium">{template.title}</span>
                  <p className="text-xs text-ink-400">{template.description ?? ''}</p>
                </td>
                <td className="px-4 py-3 text-ink-300">{template.trainerName ?? 'Unassigned'}</td>
                <td className="px-4 py-3 text-ink-300">{template.roomName ?? 'Floor'}</td>
                <td className="px-4 py-3 stat-value">{template.capacity}</td>
                <td className="px-4 py-3 stat-value">{template.upcomingSessions}</td>
                <td className="px-4 py-3">
                  {canWrite ? (
                    <ActionButton
                      endpoint={`/api/v1/classes/templates/${template.id}`}
                      method="DELETE"
                      label="Retire"
                      confirmMessage="Stop generating new sessions? Existing sessions stay."
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {canWrite ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card title="Add a one-off class" description="Great for workshops, and clash-checked against the trainer and room">
            <ActionForm
              endpoint="/api/v1/classes"
              submitLabel="Create class"
              successMessage="Class added"
              coerce={{
                capacity: 'number',
                durationMin: 'number',
                creditCost: 'number',
                cancelWindowHours: 'number',
                lateCancelPenaltyCents: 'number',
              }}
              className="grid gap-3 md:grid-cols-2"
            >
              <Field label="Title" htmlFor="sessionTitle">
                <input id="sessionTitle" name="title" required className={inputClass} placeholder="Saturday Bootcamp" />
              </Field>
              <Field label="Branch" htmlFor="sessionBranch">
                <select id="sessionBranch" name="branchId" required className={selectClass} defaultValue={user.branchId ?? context.branches[0]?.id}>
                  {context.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Starts at (UTC)" htmlFor="startsAt">
                <input id="startsAt" name="startsAt" type="datetime-local" required className={inputClass} />
              </Field>
              <Field label="Duration (minutes)" htmlFor="durationMin">
                <input id="durationMin" name="durationMin" type="number" min={15} max={300} defaultValue={60} className={inputClass} />
              </Field>
              <Field label="Trainer" htmlFor="trainerId">
                <select id="trainerId" name="trainerId" className={selectClass}>
                  <option value="">Unassigned</option>
                  {context.trainers.map((trainer) => (
                    <option key={trainer.id} value={trainer.id}>
                      {trainer.firstName} {trainer.lastName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Room" htmlFor="roomId">
                <select id="roomId" name="roomId" className={selectClass}>
                  <option value="">Floor / unassigned</option>
                  {context.rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name} ({room.capacity})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Capacity" htmlFor="capacity">
                <input id="capacity" name="capacity" type="number" min={1} max={200} defaultValue={16} className={inputClass} />
              </Field>
              <Field label="Late-cancel fee (cents)" htmlFor="lateCancelPenaltyCents" hint="0 disables the fee">
                <input id="lateCancelPenaltyCents" name="lateCancelPenaltyCents" type="number" min={0} defaultValue={1500} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Add a recurring class" description="Creates this week's and the next 7 weeks' sessions, skipping clashes">
            <ActionForm
              endpoint="/api/v1/classes/templates"
              submitLabel="Create recurring class"
              successMessage="Template created"
              coerce={{ capacity: 'number', durationMin: 'number', dayOfWeek: 'number' }}
              className="grid gap-3 md:grid-cols-2"
            >
              <Field label="Title" htmlFor="templateTitle">
                <input id="templateTitle" name="title" required className={inputClass} placeholder="HIIT Circuit" />
              </Field>
              <Field label="Branch" htmlFor="templateBranch">
                <select id="templateBranch" name="branchId" required className={selectClass} defaultValue={user.branchId ?? context.branches[0]?.id}>
                  {context.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Day" htmlFor="dayOfWeek">
                <select id="dayOfWeek" name="dayOfWeek" className={selectClass} defaultValue="1">
                  {DAY_NAMES.map((name, index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Start time (HH:MM)" htmlFor="startTime">
                <input id="startTime" name="startTime" defaultValue="18:30" pattern="\d{2}:\d{2}" className={inputClass} />
              </Field>
              <Field label="Duration (minutes)" htmlFor="templateDuration">
                <input id="templateDuration" name="durationMin" type="number" min={15} max={300} defaultValue={45} className={inputClass} />
              </Field>
              <Field label="Capacity" htmlFor="templateCapacity">
                <input id="templateCapacity" name="capacity" type="number" min={1} max={200} defaultValue={20} className={inputClass} />
              </Field>
              <Field label="Trainer" htmlFor="templateTrainer">
                <select id="templateTrainer" name="trainerId" className={selectClass}>
                  <option value="">Unassigned</option>
                  {context.trainers.map((trainer) => (
                    <option key={trainer.id} value={trainer.id}>
                      {trainer.firstName} {trainer.lastName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Room" htmlFor="templateRoom">
                <select id="templateRoom" name="roomId" className={selectClass}>
                  <option value="">Floor / unassigned</option>
                  {context.rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Starts on" htmlFor="startsOn" hint="First date this class may run">
                <input
                  id="startsOn"
                  name="startsOn"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className={inputClass}
                />
              </Field>
              <Field label="Cancellation window (hours)" htmlFor="cancelWindowHours">
                <input id="cancelWindowHours" name="cancelWindowHours" type="number" min={0} max={72} defaultValue={6} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      ) : null}
    </>
  )
}
