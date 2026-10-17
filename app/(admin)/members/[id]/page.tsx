import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { getMember, memberTimeline } from '@/lib/services/members'
import { membershipHistory } from '@/lib/services/memberships'
import { can, ROLE_LABELS, type Role } from '@/lib/constants'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import {
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Table,
  formatDate,
  formatDateTime,
  money,
  relativeTime,
  statusTone,
} from '@/components/ui'
import { selectClass, inputClass } from '@/components/ui'

export const dynamic = 'force-dynamic'

async function listPlansForSelect(db: Awaited<ReturnType<typeof getDb>>) {
  const { plans } = await import('@/lib/db/schema')
  const { asc, eq } = await import('drizzle-orm')
  return db
    .select({ id: plans.id, name: plans.name, priceCents: plans.priceCents, currency: plans.currency })
    .from(plans)
    .where(eq(plans.isActive, true))
    .orderBy(asc(plans.sortOrder))
}

export default async function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffUser('member:read')
  const { id } = await params
  const db = await getDb()

  let detail: Awaited<ReturnType<typeof getMember>>
  try {
    detail = await getMember(db, id)
  } catch {
    notFound()
  }

  const [timeline, activeMembership, plansForSale] = await Promise.all([
    memberTimeline(db, id),
    Promise.resolve(detail.memberships.find((row) => row.status === 'ACTIVE' || row.status === 'FROZEN' || row.status === 'PENDING')),
    listPlansForSelect(db),
  ])

  const history = activeMembership ? await membershipHistory(db, activeMembership.id) : null
  const canWrite = can(user.role as Role, 'membership:write')
  const canRefund = can(user.role as Role, 'payment:refund')

  return (
    <>
      <PageHeader
        title={`${detail.member.firstName} ${detail.member.lastName}`}
        subtitle={`${detail.member.email}${detail.member.phone ? ` · ${detail.member.phone}` : ''} · joined ${formatDate(detail.member.createdAt)}`}
        actions={
          <>
            <Link href="/members" className="rounded-xl border border-ink-600 bg-ink-700 px-4 py-3 text-sm">
              Back to members
            </Link>
            {can(user.role as Role, 'attendance:write') ? (
              <ActionButton
                endpoint="/api/v1/attendance/check-in"
                body={{ memberId: detail.member.id }}
                label="Check in now"
                variant="primary"
                size="md"
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Membership" className="lg:col-span-2">
          {activeMembership ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{activeMembership.planName}</p>
                  <p className="text-sm text-ink-300">
                    {formatDate(activeMembership.startsAt)} → {formatDate(activeMembership.endsAt)}
                    {activeMembership.autoRenew ? ' · auto-renews' : ' · ends without renewal'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone(activeMembership.status)}>{activeMembership.status}</Badge>
                  {activeMembership.creditsRemaining !== null ? (
                    <Badge tone="info">{activeMembership.creditsRemaining} credits left</Badge>
                  ) : null}
                  {activeMembership.freezeEndsAt ? (
                    <Badge tone="warning">frozen until {formatDate(activeMembership.freezeEndsAt)}</Badge>
                  ) : null}
                </div>
              </div>

              {canWrite ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-800 pt-4">
                  <ActionButton
                    endpoint={`/api/v1/memberships/${activeMembership.id}/actions`}
                    body={{ action: 'renew', skipPayment: false }}
                    label="Renew (card)"
                    size="md"
                  />
                  <ActionButton
                    endpoint={`/api/v1/memberships/${activeMembership.id}/actions`}
                    body={{ action: 'renew', skipPayment: true }}
                    label="Renew (cash)"
                    size="md"
                  />
                  {activeMembership.status === 'FROZEN' ? (
                    <ActionButton
                      endpoint={`/api/v1/memberships/${activeMembership.id}/actions`}
                      body={{ action: 'unfreeze' }}
                      label="Unfreeze"
                      size="md"
                    />
                  ) : (
                    <ActionButton
                      endpoint={`/api/v1/memberships/${activeMembership.id}/actions`}
                      body={{ action: 'freeze', days: 14, reason: 'Front desk freeze' }}
                      label="Freeze 14 days"
                      size="md"
                    />
                  )}
                  <ActionButton
                    endpoint={`/api/v1/memberships/${activeMembership.id}/actions`}
                    body={{ action: 'cancel', reason: 'Member request at front desk' }}
                    label="Cancel at period end"
                    variant="danger"
                    size="md"
                    confirmMessage="Cancel the renewal but keep access until the period ends?"
                  />
                  <ActionButton
                    endpoint={`/api/v1/memberships/${activeMembership.id}/actions`}
                    body={{ action: 'cancel', reason: 'Immediate cancellation', immediate: true }}
                    label="Cancel immediately"
                    variant="danger"
                    size="md"
                    confirmMessage="End access right now? This cannot be undone."
                  />
                </div>
              ) : null}

              {history ? (
                <details className="mt-4 border-t border-ink-800 pt-4">
                  <summary className="cursor-pointer text-sm text-ink-300">Membership history ({history.events.length} events)</summary>
                  <ul className="mt-3 space-y-2 text-xs text-ink-300">
                    {history.events.map((event) => (
                      <li key={event.id} className="flex items-center justify-between gap-3">
                        <span>
                          <Badge tone={statusTone(event.toStatus)}>{event.type}</Badge> {event.note ?? ''}
                        </span>
                        <span className="text-ink-400">{formatDateTime(event.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col gap-4">
              <EmptyState
                title="No active membership"
                hint={`Account status: ${detail.member.status}. Sell a plan below to activate access.`}
              />
              {canWrite ? (
                <ActionForm
                  endpoint="/api/v1/memberships"
                  submitLabel="Sell membership"
                  coerce={{ skipPayment: 'boolean' }}
                  extra={{ memberId: detail.member.id }}
                  className="grid gap-3 md:grid-cols-2"
                >
                  <Field label="Plan" htmlFor="planId">
                    <select id="planId" name="planId" required className={selectClass}>
                      {plansForSale.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} — {(plan.priceCents / 100).toFixed(2)} {plan.currency}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Discount code" htmlFor="discountCode" hint="Optional">
                    <input id="discountCode" name="discountCode" className={inputClass} />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="skipPayment" />
                    Record as cash/comp (no card charge)
                  </label>
                </ActionForm>
              ) : null}
            </div>
          )}
        </Card>

        <Card title="Profile & safety" description="Health notes are shown to trainers on class rosters">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-400">Role</dt>
              <dd>{ROLE_LABELS[detail.member.role as Role] ?? detail.member.role}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-400">Born</dt>
              <dd>{detail.profile?.dateOfBirth ? formatDate(detail.profile.dateOfBirth) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-400">Waiver</dt>
              <dd>
                {detail.profile?.waiverSignedAt ? (
                  <Badge tone="positive">signed {formatDate(detail.profile.waiverSignedAt)}</Badge>
                ) : (
                  <Badge tone="danger">missing</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-ink-400">Emergency contact</dt>
              <dd className="mt-1">
                {detail.profile?.emergencyContactName ?? '—'}
                {detail.profile?.emergencyContactPhone ? ` · ${detail.profile.emergencyContactPhone}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-ink-400">Health notes</dt>
              <dd className="mt-1 text-ink-200">{detail.profile?.healthNotes ?? 'None recorded'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-400">Last visit</dt>
              <dd>{relativeTime(detail.visits[0]?.checkedInAt ?? null)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Payments" className="lg:col-span-2" padded={false}>
          {detail.payments.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No payments yet" />
            </div>
          ) : (
            <Table head={['When', 'Amount', 'Status', 'Provider', '']}>
              {detail.payments.map((payment) => (
                <tr key={payment.id} className="hover:bg-ink-800/40">
                  <td className="px-4 py-3">{formatDateTime(payment.paidAt ?? payment.createdAt)}</td>
                  <td className="px-4 py-3 stat-value">
                    {money(payment.amountCents, payment.currency)}
                    {payment.refundedCents > 0 ? (
                      <span className="ml-2 text-xs text-rose-400">-{money(payment.refundedCents)} refunded</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(payment.status)}>{payment.status}</Badge>
                    {payment.failureReason ? <p className="text-xs text-rose-400">{payment.failureReason}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-ink-300">{payment.provider}</td>
                  <td className="px-4 py-3">
                    {canRefund && payment.status === 'SUCCEEDED' ? (
                      <ActionButton
                        endpoint={`/api/v1/payments/${payment.id}/refund`}
                        body={{ reason: 'Refund from member profile' }}
                        label="Refund"
                        variant="danger"
                        confirmMessage={`Refund ${money(payment.amountCents)}?`}
                      />
                    ) : null}
                    {payment.status === 'FAILED' ? (
                      <ActionButton
                        endpoint={`/api/v1/payments/${payment.id}/retry`}
                        label="Retry"
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Visits & classes" padded={false}>
          <Table head={['When', 'Where']}>
            {detail.visits.slice(0, 8).map((visit) => (
              <tr key={visit.id}>
                <td className="px-4 py-2 text-xs">{formatDateTime(visit.checkedInAt)}</td>
                <td className="px-4 py-2 text-xs text-ink-300">
                  {visit.sessionTitle ?? 'Gym floor'} · {visit.method}
                </td>
              </tr>
            ))}
            {detail.visits.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-xs text-ink-400" colSpan={2}>
                  No check-ins recorded.
                </td>
              </tr>
            ) : null}
          </Table>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Staff notes">
          {can(user.role as Role, 'member:write') ? (
            <ActionForm endpoint={`/api/v1/members/${detail.member.id}/notes`} submitLabel="Add note" successMessage="Note saved">
              <Field label="Note" htmlFor="noteBody" hint="Visible to staff only">
                <textarea
                  id="noteBody"
                  name="body"
                  rows={3}
                  className={`${inputClass} h-auto py-2`}
                  placeholder="e.g. Prefers morning classes, asked about the annual plan"
                  required
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isPinned" />
                Pin to the top
              </label>
            </ActionForm>
          ) : null}

          <ul className="mt-4 space-y-3">
            {detail.notes.map((note) => (
              <li key={note.id} className="rounded-xl border border-ink-700 bg-ink-900/40 p-3">
                <p className="text-sm text-ink-100">{note.body}</p>
                <p className="mt-1 flex items-center gap-2 text-xs text-ink-400">
                  {note.isPinned ? <Badge tone="accent">pinned</Badge> : null}
                  {note.authorName ?? 'System'} · {formatDateTime(note.createdAt)}
                  {can(user.role as Role, 'member:write') ? (
                    <ActionButton
                      endpoint={`/api/v1/members/${detail.member.id}/notes/${note.id}`}
                      method="DELETE"
                      label="Delete"
                      variant="ghost"
                      confirmMessage="Delete this note?"
                    />
                  ) : null}
                </p>
              </li>
            ))}
            {detail.notes.length === 0 ? <li className="text-sm text-ink-400">No notes yet.</li> : null}
          </ul>
        </Card>

        <Card title="Activity timeline" padded={false}>
          <Table head={['When', 'Event']}>
            {timeline.slice(0, 20).map((entry) => (
              <tr key={`${entry.kind}-${entry.id}`}>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-300">{formatDateTime(entry.at)}</td>
                <td className="px-4 py-2 text-xs">
                  {entry.kind === 'audit' ? <Badge tone="info">{entry.action}</Badge> : null}
                  {entry.kind === 'note' ? <Badge tone="accent">note</Badge> : null}
                  {entry.kind === 'visit' ? <Badge tone="neutral">check-in ({entry.method})</Badge> : null}
                  {'body' in entry && entry.body ? <span className="ml-2 text-ink-200">{entry.body}</span> : null}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  )
}
