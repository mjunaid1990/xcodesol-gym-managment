import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { Badge, Card, EmptyState, PageHeader, Table, formatDateTime } from '@/components/ui'
import { Filters } from '@/components/Filters'
import { auditLogs } from '@/lib/db/schema'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'

export const metadata = { title: 'Audit log' }
export const dynamic = 'force-dynamic'

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string; from?: string; to?: string }>
}) {
  await requireStaffUser('audit:read')
  const params = await searchParams
  const db = await getDb()

  const conditions = []
  if (params.action) conditions.push(sql`${auditLogs.action} ilike ${`%${params.action}%`}`)
  if (params.entity) conditions.push(eq(auditLogs.entity, params.entity))
  if (params.from) conditions.push(gte(auditLogs.createdAt, new Date(params.from)))
  if (params.to) conditions.push(lte(auditLogs.createdAt, new Date(`${params.to}T23:59:59.999Z`)))

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entity: auditLogs.entity,
        entityId: auditLogs.entityId,
        meta: auditLogs.meta,
        ip: auditLogs.ip,
        createdAt: auditLogs.createdAt,
        actorEmail: auditLogs.actorEmail,
        actorName: sql<string | null>`(select u.first_name || ' ' || u.last_name from users u where u.id = audit_logs.actor_id)`,
      })
      .from(auditLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(200),
    db
      .select({ action: auditLogs.action, count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .groupBy(auditLogs.action)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ])

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Append-only record of every sensitive action: who did it, to what, and from where."
      />

      <Filters
        fields={[
          { name: 'action', label: 'Action contains', type: 'search', placeholder: 'payment.refund' },
          {
            name: 'entity',
            label: 'Entity',
            type: 'select',
            options: [
              { value: 'user', label: 'user' },
              { value: 'membership', label: 'membership' },
              { value: 'payment', label: 'payment' },
              { value: 'invoice', label: 'invoice' },
              { value: 'class_session', label: 'class_session' },
              { value: 'class_template', label: 'class_template' },
              { value: 'booking', label: 'booking' },
              { value: 'attendance', label: 'attendance' },
              { value: 'plan', label: 'plan' },
              { value: 'app_setting', label: 'app_setting' },
            ],
          },
          { name: 'from', label: 'From', type: 'date' },
          { name: 'to', label: 'To', type: 'date' },
        ]}
      />

      <div className="mt-4">
        <Card title="Most frequent actions" description="Across all time">
          <ul className="flex flex-wrap gap-2">
            {totals.map((row) => (
              <li key={row.action}>
                <Link
                  href={`/audit?action=${encodeURIComponent(row.action)}`}
                  className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-800/80 px-3 py-1 text-xs text-ink-200 transition-colors hover:border-zinc-500 hover:text-white"
                >
                  <span className="font-mono">{row.action}</span>
                  <span className="stat-value text-white font-semibold">{row.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4" title={`${rows.length} recent entries`} padded={false}>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No audit entries match those filters" />
          </div>
        ) : (
          <Table head={['When', 'Actor', 'Action', 'Entity', 'Details', 'IP']}>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-ink-800/40">
                <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-300">{formatDateTime(row.createdAt)}</td>
                <td className="px-4 py-3 text-xs">
                  {row.actorName ?? row.actorEmail ?? 'system'}
                  {row.actorName && row.actorEmail ? <p className="text-ink-400">{row.actorEmail}</p> : null}
                </td>
                <td className="px-4 py-3">
                  <Badge tone="info">{row.action}</Badge>
                </td>
                <td className="px-4 py-3 text-xs text-ink-300">
                  {row.entity}
                  {row.entityId ? <p className="font-mono text-[10px] text-ink-400">{row.entityId.slice(0, 12)}…</p> : null}
                </td>
                <td className="px-4 py-3 text-xs text-ink-300">
                  {row.meta && Object.keys(row.meta).length ? (
                    <code className="block max-w-md truncate" title={JSON.stringify(row.meta)}>
                      {JSON.stringify(row.meta)}
                    </code>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-ink-400">{row.ip ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  )
}
