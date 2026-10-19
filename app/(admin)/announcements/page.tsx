import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { listAnnouncements } from '@/lib/services/announcements'
import { can, type Role } from '@/lib/constants'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import { Badge, Card, EmptyState, Field, PageHeader, Table, formatDateTime, inputClass, selectClass, statusTone } from '@/components/ui'

export const metadata = { title: 'Announcements' }
export const dynamic = 'force-dynamic'

export default async function AnnouncementsPage() {
  const user = await requireStaffUser('announcement:read')
  const db = await getDb()
  const announcementsResult = await Promise.allSettled([listAnnouncements(db, {})])
  const announcements = announcementsResult[0].status === 'fulfilled' ? announcementsResult[0].value : []
  const canWrite = can(user.role as Role, 'announcement:write')

  const drafts = announcements.filter((row) => row.status === 'DRAFT')
  const sent = announcements.filter((row) => row.status === 'SENT')

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Push, email and SMS in one send. Members only receive what their preferences allow."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-4">
          <Card title="Drafts" padded={false}>
            {drafts.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No drafts waiting" hint="Write an announcement to tell members about schedule changes or offers." />
              </div>
            ) : (
              <Table head={['Title', 'Audience', 'Channels', 'Created', '']}>
                {drafts.map((row) => (
                  <tr key={row.id} className="hover:bg-ink-800/40">
                    <td className="px-4 py-3">
                      <span className="font-medium">{row.title}</span>
                      <p className="max-w-md text-xs text-ink-400">{row.body}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="info">{row.audience}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-300">{row.channels.join(', ')}</td>
                    <td className="px-4 py-3 text-xs text-ink-400">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-3">
                      {canWrite ? (
                        <ActionButton
                          endpoint={`/api/v1/announcements/${row.id}/send`}
                          label="Send now"
                          variant="primary"
                          confirmMessage={`Send “${row.title}” to ${row.audience.toLowerCase()}? This cannot be undone.`}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Sent" description="Delivery breakdown per channel" padded={false}>
            {sent.length === 0 ? (
              <div className="p-5">
                <EmptyState title="Nothing sent yet" />
              </div>
            ) : (
              <Table head={['Title', 'Audience', 'Sent', 'Recipients']}>
                {sent.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <span className="font-medium">{row.title}</span>
                      <p className="max-w-md text-xs text-ink-400">{row.body}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="positive">{row.audience}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-400">{formatDateTime(row.sentAt ?? row.createdAt)}</td>
                    <td className="px-4 py-3 stat-value">{row.recipients}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        {canWrite ? (
          <Card title="New announcement" description="Drafts can be edited until they are sent">
            <ActionForm
              endpoint="/api/v1/announcements"
              submitLabel="Save draft"
              successMessage="Draft saved"
              coerce={{ channels: 'csv' }}
              className="flex flex-col gap-3"
            >
              <Field label="Title" htmlFor="title">
                <input id="title" name="title" required className={inputClass} placeholder="New 6:30am HIIT class" />
              </Field>
              <Field label="Message" htmlFor="body">
                <textarea
                  id="body"
                  name="body"
                  rows={5}
                  required
                  className={`${inputClass} h-auto py-2`}
                  placeholder="Starting Monday we're adding a second early class with Nadia. Book in the app."
                />
              </Field>
              <Field label="Audience" htmlFor="audience">
                <select id="audience" name="audience" className={selectClass} defaultValue="MEMBERS">
                  <option value="MEMBERS">All active members</option>
                  <option value="TRAINERS">Trainers</option>
                  <option value="STAFF">Front desk & managers</option>
                  <option value="ALL">Everyone</option>
                </select>
              </Field>
              <Field label="Channels" htmlFor="channels" hint="Comma separated: IN_APP, PUSH, EMAIL, SMS">
                <input id="channels" name="channels" className={inputClass} defaultValue="IN_APP,PUSH,EMAIL" />
              </Field>
              <p className="text-xs text-ink-400">
                SMS is only sent when Twilio credentials are configured; otherwise the row is marked
                <Badge tone={statusTone('SIMULATED')}>simulated</Badge> in the notification log.
              </p>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  )
}
