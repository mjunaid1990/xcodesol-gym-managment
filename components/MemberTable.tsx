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
        : `${payload.data?.succeeded ?? 0} members updated successfully`,
    )
    setSelected([])
    setNote('')
    setBusy(false)
    router.refresh()
  }

  return (
    <div>
      {/* Bulk action toolbar */}
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.08] bg-white/[0.04] px-5 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-400">
              {selected.length}
            </span>
            <span className="text-xs font-semibold text-white">Selected</span>
          </div>

          <div className="h-4 w-px bg-white/[0.1]" />

          <label className="flex items-center gap-2 text-xs text-ink-300">
            Action:
            <select
              className="h-8 rounded-lg border border-white/[0.1] bg-[#121216] px-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              value={action}
              onChange={(event) => setAction(event.target.value as BulkAction)}
            >
              <option value="note">Add staff note</option>
              <option value="grant-credits">Grant class credits</option>
              <option value="activate">Set active</option>
              <option value="deactivate">Deactivate account</option>
              <option value="suspend">Suspend member</option>
            </select>
          </label>

          {action === 'note' ? (
            <input
              className="h-8 min-w-[14rem] flex-1 rounded-lg border border-white/[0.1] bg-[#121216] px-3 text-xs text-white placeholder-ink-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Discussed renewal plan discount"
            />
          ) : null}

          {action === 'grant-credits' ? (
            <input
              type="number"
              min={1}
              max={100}
              className="h-8 w-20 rounded-lg border border-white/[0.1] bg-[#121216] px-2.5 text-xs text-white focus:outline-none"
              value={credits}
              onChange={(event) => setCredits(event.target.value)}
            />
          ) : null}

          <div className="flex items-center gap-2 ml-auto">
            <Button size="sm" variant="primary" onClick={runBulk} disabled={busy}>
              {busy ? 'Applying…' : 'Apply to Selected'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>

          {message ? (
            <div className="w-full text-xs font-medium text-emerald-400 pt-1">
              {message}
            </div>
          ) : null}
        </div>
      ) : null}

      <Table head={['', 'Member', 'Membership Status', 'Visits (30d)', 'Last Seen', 'Account Balance']}>
        <tr className="bg-white/[0.01]">
          <th scope="col" className="w-10 px-4 py-2">
            <input
              type="checkbox"
              aria-label="Select all members on this page"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? [] : rows.map((row) => row.id))}
              className="rounded border-white/[0.2] bg-transparent text-emerald-500 focus:ring-0"
            />
          </th>
          <td className="px-4 py-2 text-xs text-ink-400" colSpan={5}>
            Showing {rows.length} member{rows.length === 1 ? '' : 's'} on this page
          </td>
        </tr>
        {rows.map((row) => {
          const initials = `${row.firstName?.[0] ?? ''}${row.lastName?.[0] ?? ''}`.toUpperCase()
          return (
            <tr key={row.id} className="transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-3.5">
                <input
                  type="checkbox"
                  aria-label={`Select ${row.firstName} ${row.lastName}`}
                  checked={selected.includes(row.id)}
                  onChange={() => toggle(row.id)}
                  className="rounded border-white/[0.2] bg-transparent text-emerald-500 focus:ring-0"
                />
              </td>
              <td className="px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs font-semibold text-white">
                    {initials || 'M'}
                  </div>
                  <div>
                    <Link href={`/members/${row.id}`} className="font-medium text-white hover:text-emerald-400 transition-colors">
                      {row.firstName} {row.lastName}
                    </Link>
                    <p className="text-xs text-ink-400">{row.email}</p>
                    {row.phone ? <p className="text-[11px] text-ink-400">{row.phone}</p> : null}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3.5">
                <Badge tone={statusTone(row.membershipStatus ?? 'NONE')}>{row.membershipStatus ?? 'No Plan'}</Badge>
                <p className="mt-1 text-xs text-ink-400">
                  {row.planName ?? '—'}
                  {row.membershipEndsAt ? ` · ends ${formatDate(row.membershipEndsAt)}` : ''}
                </p>
              </td>
              <td className="px-4 py-3.5 stat-value text-xs font-semibold text-white">{row.visits30d}</td>
              <td className="px-4 py-3.5 text-xs text-ink-300">{relativeTime(row.lastVisitAt)}</td>
              <td className="px-4 py-3.5">
                <div className="flex items-center gap-2">
                  {row.outstandingCents > 0 ? (
                    <Badge tone="warning">Owes {money(row.outstandingCents)}</Badge>
                  ) : (
                    <span className="text-xs text-emerald-400 font-medium">Clear</span>
                  )}
                  {row.status !== 'ACTIVE' ? <Badge tone={statusTone(row.status)}>{row.status}</Badge> : null}
                </div>
              </td>
            </tr>
          )
        })}
      </Table>
    </div>
  )
}
