'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Badge, Button, Table, formatDate, money, relativeTime, statusTone } from '@/components/ui'

export interface MemberRow {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  status: string
  membershipStatus: string | null
  planName: string | null
  membershipEndsAt: string | null
  lastVisitAt: string | null
  visits30d: number
  outstandingCents: number
}

type BulkAction = 'activate' | 'deactivate' | 'suspend' | 'note' | 'grant-credits'

/**
 * Bulk actions are the difference between a 20 minute and a 2 minute job when a trainer
 * leaves and 40 members need a note, or a price change needs a message to everyone.
 */
export function MemberTable({ rows }: { rows: MemberRow[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [action, setAction] = useState<BulkAction>('note')
  const [note, setNote] = useState('')
  const [credits, setCredits] = useState('1')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const allSelected = rows.length > 0 && selected.length === rows.length

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function runBulk() {
    if (!selected.length) return
    setBusy(true)
    setMessage(null)

    const response = await fetch('/api/v1/members/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        memberIds: selected,
        action,
        note: action === 'note' ? note : undefined,
        credits: action === 'grant-credits' ? Number(credits) : undefined,
      }),
    })

    const payload = (await response.json().catch(() => ({}))) as {
      data?: { succeeded?: number; results?: { ok: boolean; message?: string }[] }
      error?: { message?: string }
    }

    if (!response.ok) {
      setMessage(payload.error?.message ?? 'Bulk action failed')
      setBusy(false)
      return
    }

    const failed = payload.data?.results?.filter((result) => !result.ok) ?? []
    setMessage(
      failed.length
        ? `${payload.data?.succeeded ?? 0} updated, ${failed.length} skipped (${failed[0]?.message ?? 'no reason given'})`
        : `${payload.data?.succeeded ?? 0} members updated`,
    )
    setSelected([])
    setNote('')
    setBusy(false)
    router.refresh()
  }

  return (
    <div>
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3 border-b border-ink-700 bg-ink-800/60 px-4 py-3">
          <p className="text-sm text-ink-200">{selected.length} selected</p>
          <label className="flex flex-col gap-1 text-xs text-ink-300">
            Action
            <select
              className="h-9 rounded-lg border border-ink-600 bg-ink-900 px-2 text-xs"
              value={action}
              onChange={(event) => setAction(event.target.value as BulkAction)}
            >
              <option value="note">Add a note</option>
              <option value="grant-credits">Grant class credits</option>
              <option value="deactivate">Deactivate</option>
              <option value="suspend">Suspend</option>
              <option value="activate">Reactivate</option>
            </select>
          </label>

          {action === 'note' ? (
            <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-ink-300">
              Note
              <input
                className="h-9 rounded-lg border border-ink-600 bg-ink-900 px-2 text-xs"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. Called about the price change"
              />
            </label>
          ) : null}

          {action === 'grant-credits' ? (
            <label className="flex flex-col gap-1 text-xs text-ink-300">
              Credits
              <input
                type="number"
                min={1}
                max={100}
                className="h-9 w-20 rounded-lg border border-ink-600 bg-ink-900 px-2 text-xs"
                value={credits}
                onChange={(event) => setCredits(event.target.value)}
              />
            </label>
          ) : null}

          <Button size="sm" variant="primary" onClick={runBulk} disabled={busy}>
            {busy ? 'Working…' : 'Apply to selected'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
          {message ? <span className="text-xs text-lime-500">{message}</span> : null}
        </div>
      ) : null}

      <Table head={['', 'Member', 'Membership', 'Visits (30d)', 'Last seen', 'Balance']}>
        <tr className="bg-ink-900/30">
          <th scope="col" className="w-10 px-4 py-2">
            <input
              type="checkbox"
              aria-label="Select all members on this page"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? [] : rows.map((row) => row.id))}
            />
          </th>
          <td className="px-4 py-2 text-xs text-ink-400" colSpan={5}>
            {rows.length} members on this page
          </td>
        </tr>
        {rows.map((row) => (
          <tr key={row.id} className="hover:bg-ink-800/40">
            <td className="px-4 py-3">
              <input
                type="checkbox"
                aria-label={`Select ${row.firstName} ${row.lastName}`}
                checked={selected.includes(row.id)}
                onChange={() => toggle(row.id)}
              />
            </td>
            <td className="px-4 py-3">
              <Link href={`/members/${row.id}`} className="font-medium hover:text-lime-500">
                {row.firstName} {row.lastName}
              </Link>
              <p className="text-xs text-ink-400">{row.email}</p>
              {row.phone ? <p className="text-xs text-ink-400">{row.phone}</p> : null}
            </td>
            <td className="px-4 py-3">
              <Badge tone={statusTone(row.membershipStatus ?? 'NONE')}>{row.membershipStatus ?? 'no plan'}</Badge>
              <p className="mt-1 text-xs text-ink-400">
                {row.planName ?? '—'}
                {row.membershipEndsAt ? ` · ends ${formatDate(row.membershipEndsAt)}` : ''}
              </p>
            </td>
            <td className="px-4 py-3 stat-value">{row.visits30d}</td>
            <td className="px-4 py-3 text-ink-300">{relativeTime(row.lastVisitAt)}</td>
            <td className="px-4 py-3">
              {row.outstandingCents > 0 ? (
                <Badge tone="warning">{money(row.outstandingCents)}</Badge>
              ) : (
                <span className="text-xs text-ink-400">clear</span>
              )}
              {row.status !== 'ACTIVE' ? <Badge tone={statusTone(row.status)}>{row.status}</Badge> : null}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
