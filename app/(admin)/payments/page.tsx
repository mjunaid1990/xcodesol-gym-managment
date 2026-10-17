import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { can, type Role } from '@/lib/constants'
import { ActionButton } from '@/components/ActionForm'
import { Filters } from '@/components/Filters'
import { Badge, Card, EmptyState, PageHeader, StatCard, Table, formatDate, formatDateTime, money, statusTone } from '@/components/ui'
import { listInvoicesForAdmin, listPaymentsForAdmin, listUpcomingRenewals } from '@/lib/services/ledger'

export const metadata = { title: 'Payments' }
export const dynamic = 'force-dynamic'

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; branchId?: string; memberId?: string; from?: string; to?: string }>
}) {
  const user = await requireStaffUser('payment:read')
  const params = await searchParams
  const db = await getDb()

  const [payments, invoices, renewals] = await Promise.all([
    listPaymentsForAdmin(db, {
      status: params.status,
      branchId: params.branchId,
      memberId: params.memberId,
      from: params.from ? new Date(params.from) : undefined,
      to: params.to ? new Date(params.to) : undefined,
      limit: 50,
    }),
    listInvoicesForAdmin(db, { status: undefined, branchId: params.branchId, limit: 25 }),
    listUpcomingRenewals(db, 8),
  ])

  const canRefund = can(user.role as Role, 'payment:refund')
  const canWrite = can(user.role as Role, 'payment:write')

  return (
    <>
      <PageHeader
        title="Payments & invoices"
        subtitle="Every charge, failure and refund in one ledger. Refunds go back to the original payment method."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Collected" value={money(payments.totals.collected)} tone="accent" />
        <StatCard label="Refunded" value={money(payments.totals.refunded)} tone={payments.totals.refunded ? 'warning' : 'default'} />
        <StatCard label="Failed payments" value={String(payments.totals.failed)} tone={payments.totals.failed ? 'danger' : 'positive'} hint="Retry from the row menu" />
        <StatCard label="Outstanding" value={money(invoices.totals.open)} hint={`${invoices.totals.overdue} overdue`} tone={invoices.totals.open ? 'warning' : 'positive'} />
      </div>

      <div className="mt-4">
        <Filters
          fields={[
            {
              name: 'status',
              label: 'Payment status',
              type: 'select',
              options: [
                { value: 'SUCCEEDED', label: 'Succeeded' },
                { value: 'FAILED', label: 'Failed' },
                { value: 'PENDING', label: 'Pending' },
                { value: 'REFUNDED', label: 'Refunded' },
                { value: 'PARTIALLY_REFUNDED', label: 'Partially refunded' },
              ],
            },
            { name: 'from', label: 'From', type: 'date' },
            { name: 'to', label: 'To', type: 'date' },
          ]}
        />
      </div>

      <Card
        className="mt-4"
        title="Ledger"
        description={`${payments.rows.length} recent transactions`}
        actions={
          <Link
            href="/api/v1/reports/export?type=payments"
            className="rounded-lg border border-ink-600 px-3 py-2 text-xs"
          >
            Export CSV
          </Link>
        }
        padded={false}
      >
        {payments.rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No payments match those filters" />
          </div>
        ) : (
          <Table head={['When', 'Member', 'Invoice', 'Amount', 'Status', 'Provider', '']}>
            {payments.rows.map((payment) => (
              <tr key={payment.id} className="hover:bg-ink-800/40">
                <td className="px-4 py-3 whitespace-nowrap text-xs">{formatDateTime(payment.paidAt ?? payment.createdAt)}</td>
                <td className="px-4 py-3">
                  <Link href={`/members/${payment.memberId}`} className="font-medium hover:text-white transition-colors">
                    {payment.memberName}
                  </Link>
                  <p className="text-xs text-ink-400">{payment.memberEmail}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{payment.invoiceNumber ?? '—'}</td>
                <td className="px-4 py-3 stat-value">
                  {money(payment.amountCents, payment.currency)}
                  {payment.refundedCents > 0 ? (
                    <p className="text-xs text-rose-400">−{money(payment.refundedCents)} refunded</p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(payment.status)}>{payment.status}</Badge>
                  {payment.failureReason ? <p className="text-xs text-rose-400">{payment.failureReason}</p> : null}
                  {payment.attempts > 1 ? <p className="text-xs text-ink-400">{payment.attempts} attempts</p> : null}
                </td>
                <td className="px-4 py-3 text-xs text-ink-300">
                  {payment.provider}
                  {payment.method ? ` · ${payment.method}` : ''}
                </td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap gap-2">
                    {payment.status === 'FAILED' && canWrite ? (
                      <ActionButton endpoint={`/api/v1/payments/${payment.id}/retry`} label="Retry" />
                    ) : null}
                    {payment.status === 'SUCCEEDED' && canRefund ? (
                      <ActionButton
                        endpoint={`/api/v1/payments/${payment.id}/refund`}
                        body={{ reason: 'Refund from the payments ledger' }}
                        label="Refund"
                        variant="danger"
                        confirmMessage={`Refund ${money(payment.amountCents)} to ${payment.memberName}?`}
                      />
                    ) : null}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Open invoices" description="Oldest due first" padded={false}>
          {invoices.rows.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No open invoices" />
            </div>
          ) : (
            <Table head={['Invoice', 'Member', 'Total', 'Due', '']}>
              {invoices.rows.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-ink-800/40">
                  <td className="px-4 py-3 font-mono text-xs">
                    {invoice.number}
                    {invoice.status === 'OPEN' && invoice.dueAt && new Date(invoice.dueAt) < new Date() ? (
                      <Badge tone="danger">overdue</Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/members/${invoice.memberId}`} className="hover:text-white transition-colors">
                      {invoice.memberName}
                    </Link>
                    <p className="text-xs text-ink-400">{invoice.description ?? ''}</p>
                  </td>
                  <td className="px-4 py-3 stat-value">{money(invoice.totalCents, invoice.currency)}</td>
                  <td className="px-4 py-3 text-xs text-ink-300">{formatDate(invoice.dueAt)}</td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <span className="flex flex-wrap gap-2">
                        <ActionButton
                          endpoint={`/api/v1/invoices/${invoice.id}/mark-paid`}
                          body={{ method: 'cash' }}
                          label="Cash received"
                          confirmMessage="Record this invoice as paid in cash?"
                        />
                        <ActionButton
                          endpoint={`/api/v1/invoices/${invoice.id}/mark-paid`}
                          body={{ method: 'terminal' }}
                          label="Card terminal"
                        />
                        {can(user.role as Role, 'payment:refund') ? (
                          <ActionButton
                            endpoint={`/api/v1/invoices/${invoice.id}/void`}
                            label="Void"
                            variant="danger"
                            confirmMessage="Void this invoice? The outstanding balance disappears."
                          />
                        ) : null}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Renewals in the next 14 days" padded={false}>
          <Table head={['Member', 'Plan', 'Ends', 'Auto-renew']}>
            {renewals.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <Link href={`/members/${row.memberId}`} className="hover:text-white transition-colors">
                    {row.memberName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-300">{row.planName}</td>
                <td className="px-4 py-3">{formatDate(row.endsAt)}</td>
                <td className="px-4 py-3">
                  <Badge tone={row.autoRenew ? 'positive' : 'warning'}>{row.autoRenew ? 'On' : 'Off'}</Badge>
                </td>
              </tr>
            ))}
            {renewals.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-sm text-ink-400" colSpan={4}>
                  Nothing renews in the next two weeks.
                </td>
              </tr>
            ) : null}
          </Table>
        </Card>
      </div>
    </>
  )
}
