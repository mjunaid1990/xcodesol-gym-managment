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

export const metadata = { title: 'Class Timetable' }
export const dynamic = 'force-dynamic'

const DAY_MS = 86_400_000
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; branchId?: string; trainerId?: string; q?: string }>
}) {
  const user = await requireStaffUser('class:read')
  const params = (await searchParams) ?? {}
  const db = await getDb()

  const start = params.date ? new Date(`${params.date}T00:00:00.000Z`) : new Date(new Date().setUTCHours(0, 0, 0, 0))
  const end = new Date(start.getTime() + 7 * DAY_MS)
  const branchId = params.branchId ?? undefined

  const [sessionsResult, templatesResult, contextResult] = await Promise.allSettled([
    listSessions(db, { from: start, to: end, branchId, trainerId: params.trainerId, title: params.q, limit: 300 }),
    listTemplates(db, { branchId }),
    branchScheduleContext(db, branchId),
  ])

  const sessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : []
  const templates = templatesResult.status === 'fulfilled' ? templatesResult.value : []
  const context =
    contextResult.status === 'fulfilled'
      ? contextResult.value
      : { branches: [], trainers: [], rooms: [] }

  const days = Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * DAY_MS))
  const canWrite = can(user.role as Role, 'class:write')

  return (
    <>
      <PageHeader
        title="Class Timetable"
        subtitle={`${formatDate(start)} → ${formatDate(new Date(end.getTime() - DAY_MS))} · ${sessions.length} sessions scheduled`}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/classes?date=${new Date(start.getTime() - 7 * DAY_MS).toISOString().slice(0, 10)}${branchId ? `&branchId=${branchId}` : ''}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-ink-200 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Prev Week
            </Link>
            <Link
              href={`/classes?date=${new Date().toISOString().slice(0, 10)}${branchId ? `&branchId=${branchId}` : ''}`}
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-medium text-ink-200 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              Today
            </Link>
            <Link
              href={`/classes?date=${new Date(start.getTime() + 7 * DAY_MS).toISOString().slice(0, 10)}${branchId ? `&branchId=${branchId}` : ''}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-ink-200 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              Next Week
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          </div>
        }
      />

      <div className="grid gap-5">
        {days.map((day) => {
          const dayIso = day.toISOString().slice(0, 10)
          const todayIso = new Date().toISOString().slice(0, 10)
          const isToday = dayIso === todayIso

          const daySessions = sessions.filter((session) => {
            const sessionIso = new Date(session.startsAt).toISOString().slice(0, 10)
            return sessionIso === dayIso
          })

          return (
            <Card
              key={day.toISOString()}
              title={`${DAY_NAMES[day.getUTCDay()]} — ${formatDate(day)}`}
              description={daySessions.length ? `${daySessions.length} session${daySessions.length === 1 ? '' : 's'}` : 'No scheduled sessions'}
              actions={
                isToday ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Today
                  </span>
                ) : null
              }
              padded={false}
            >
              {daySessions.length === 0 ? (
                <div className="px-5 py-4 text-xs text-ink-400">
                  Open slot — available for private workshops, open gym floor, or guest coach seminars.
                </div>
              ) : (
                <Table head={['Time', 'Class', 'Trainer', 'Room', 'Booked / Cap', 'Waitlist', 'Status', '']}>
                  {daySessions.map((session) => {
                    const startsAt = new Date(session.startsAt)
                    const endsAt = new Date(session.endsAt)
                    const fillPercent = Math.min(100, Math.round((session.bookedCount / Math.max(1, session.capacity)) * 100))

                    return (
                      <tr key={session.id} className="transition-colors hover:bg-white/[0.02]">
                        <td className="px-4 py-3.5 whitespace-nowrap text-xs font-mono text-ink-300">
                          {formatTime(startsAt)} – {formatTime(endsAt)}
                        </td>
                        <td className="px-4 py-3.5">
                          <Link href={`/classes/${session.id}`} className="font-medium text-white hover:text-emerald-400 transition-colors">
                            {session.title}
                          </Link>
                          <p className="text-xs text-ink-400">{session.branchName}</p>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-ink-300">
                          {session.trainerName ?? <span className="text-ink-500 italic">Unassigned</span>}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-ink-300">{session.roomName ?? 'Main Floor'}</td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="stat-value text-xs font-semibold text-white">
                              {session.bookedCount}/{session.capacity}
                            </span>
                            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-white/[0.08]">
                              <div
                                className={`h-full rounded-full ${
                                  fillPercent >= 90 ? 'bg-rose-500' : fillPercent >= 70 ? 'bg-amber-400' : 'bg-emerald-400'
                                }`}
                                style={{ width: `${fillPercent}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          {session.waitlistCount > 0 ? (
                            <Badge tone="warning">{session.waitlistCount} waiting</Badge>
                          ) : (
                            <span className="text-ink-500 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge tone={statusTone(session.status)}>{session.status}</Badge>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/classes/${session.id}`}
                              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-ink-300 hover:bg-white/[0.08] hover:text-white transition-colors"
                            >
                              Roster
                            </Link>
                            {canWrite && session.status === 'SCHEDULED' ? (
                              <ActionButton
                                endpoint={`/api/v1/classes/${session.id}/cancel`}
                                body={{ reason: 'Cancelled from timetable' }}
                                label="Cancel"
                                variant="danger"
                                confirmMessage="Cancel this class session and notify all booked attendees?"
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </Table>
              )}
            </Card>
          )
        })}
      </div>

      {/* Recurring Templates */}
      <Card
        className="mt-6"
        title="Recurring Class Templates"
        description="Weekly templates generate scheduled sessions up to 8 weeks out automatically"
        padded={false}
      >
        {templates.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No recurring templates created"
              hint="Add a weekly schedule slot below to automatically populate the calendar."
            />
          </div>
        ) : (
          <Table head={['Day', 'Start Time', 'Class Name', 'Trainer', 'Room', 'Capacity', 'Upcoming Sessions', '']}>
            {templates.map((template) => (
              <tr key={template.id} className="transition-colors hover:bg-white/[0.02]">
                <td className="px-4 py-3.5 font-medium text-white text-xs">{DAY_NAMES[template.dayOfWeek]}</td>
                <td className="px-4 py-3.5 font-mono text-xs text-ink-300">{template.startTime}</td>
                <td className="px-4 py-3.5">
                  <span className="font-medium text-white text-sm">{template.title}</span>
                  {template.description ? <p className="text-xs text-ink-400 mt-0.5">{template.description}</p> : null}
                </td>
                <td className="px-4 py-3.5 text-xs text-ink-300">{template.trainerName ?? 'Unassigned'}</td>
                <td className="px-4 py-3.5 text-xs text-ink-300">{template.roomName ?? 'Main Floor'}</td>
                <td className="px-4 py-3.5 stat-value text-xs">{template.capacity}</td>
                <td className="px-4 py-3.5 stat-value text-xs">{template.upcomingSessions}</td>
                <td className="px-4 py-3.5 text-right">
                  {canWrite ? (
                    <ActionButton
                      endpoint={`/api/v1/classes/templates/${template.id}`}
                      method="DELETE"
                      label="Retire"
                      confirmMessage="Retire this template? Existing future sessions will remain on the timetable."
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Class creation forms */}
      {canWrite ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* One-off Class */}
          <Card title="Add One-Off Session" description="Workshop or special class with trainer and room clash-detection">
            <ActionForm
              endpoint="/api/v1/classes"
              submitLabel="Create Session"
              successMessage="Class session created"
              coerce={{
                capacity: 'number',
                durationMin: 'number',
                creditCost: 'number',
                cancelWindowHours: 'number',
                lateCancelPenaltyCents: 'number',
              }}
              className="grid gap-3 md:grid-cols-2"
            >
              <Field label="Class Title" htmlFor="sessionTitle">
                <input id="sessionTitle" name="title" required className={inputClass} placeholder="e.g. Saturday Hyrox Bootcamp" />
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
              <Field label="Starts At (UTC)" htmlFor="startsAt">
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
                      {room.name} ({room.capacity} cap)
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Capacity" htmlFor="capacity">
                <input id="capacity" name="capacity" type="number" min={1} max={200} defaultValue={16} className={inputClass} />
              </Field>
              <Field label="Late-cancel fee (cents)" htmlFor="lateCancelPenaltyCents" hint="0 disables penalty fee">
                <input id="lateCancelPenaltyCents" name="lateCancelPenaltyCents" type="number" min={0} defaultValue={1500} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>

          {/* Recurring Template */}
          <Card title="Add Recurring Template" description="Auto-generates weekly timetable slots for the next 8 weeks">
            <ActionForm
              endpoint="/api/v1/classes/templates"
              submitLabel="Create Template"
              successMessage="Template created and sessions generated"
              coerce={{ capacity: 'number', durationMin: 'number', dayOfWeek: 'number' }}
              className="grid gap-3 md:grid-cols-2"
            >
              <Field label="Class Title" htmlFor="templateTitle">
                <input id="templateTitle" name="title" required className={inputClass} placeholder="e.g. HIIT Strength Circuit" />
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
              <Field label="Day of Week" htmlFor="dayOfWeek">
                <select id="dayOfWeek" name="dayOfWeek" className={selectClass} defaultValue="1">
                  {DAY_NAMES.map((name, index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Start Time (24h HH:MM)" htmlFor="startTime">
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
              <Field label="Starts On" htmlFor="startsOn" hint="First calendar date for this recurring series">
                <input
                  id="startsOn"
                  name="startsOn"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className={inputClass}
                />
              </Field>
              <Field label="Cancellation Window (hours)" htmlFor="cancelWindowHours">
                <input id="cancelWindowHours" name="cancelWindowHours" type="number" min={0} max={72} defaultValue={6} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      ) : null}
    </>
  )
}
