'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Card, Field, inputClass } from '@/components/ui'

interface CheckInResponse {
  memberName?: string
  membershipStatus?: string
  warning?: string
  checkedInAt?: string
}

/**
 * Rapid front-desk check-in interface:
 * Auto-focuses the QR input for barcode/RFID hardware scanners,
 * with fast member fallback search and manager override support.
 */
export function CheckInDesk({ branchId }: { branchId?: string }) {
  const router = useRouter()
  const qrRef = useRef<HTMLInputElement>(null)
  const [qrToken, setQrToken] = useState('')
  const [search, setSearch] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [result, setResult] = useState<CheckInResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [scannerState, setScannerState] = useState<'unknown' | 'ready' | 'unsupported'>('unknown')

  useEffect(() => {
    qrRef.current?.focus()
    setScannerState('barcode' in window && 'BarcodeDetector' in window ? 'ready' : 'unsupported')
  }, [])

  async function checkIn(payload: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/v1/attendance/check-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branchId, ...payload }),
      })
      const body = (await response.json().catch(() => ({}))) as {
        data?: CheckInResponse
        error?: { message?: string; code?: string; details?: unknown }
      }

      if (!response.ok) {
        setError(body.error?.message ?? 'Check-in failed')
        setBusy(false)
        return
      }

      setResult(body.data ?? null)
      setQrToken('')
      setSearch('')
      setBusy(false)
      qrRef.current?.focus()
      router.refresh()
    } catch {
      setError('Network error occurred. Please check connection and try again.')
      setBusy(false)
    }
  }

  return (
    <Card
      title="Rapid Entry Desk"
      description="Scan rotating member QR pass or look up by name, email, or phone. Overrides are audited."
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (qrToken.trim()) checkIn({ qrToken: qrToken.trim(), method: 'QR' })
          else if (search.trim()) checkIn({ search: search.trim(), method: 'MANUAL', overrideReason: overrideReason || undefined })
        }}
      >
        {/* QR Scan Section */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="qrToken" className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
              </svg>
              QR Pass Scanner
            </label>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Scanner Ready
            </span>
          </div>
          <input
            id="qrToken"
            ref={qrRef}
            name="qrToken"
            className={`${inputClass} font-mono tracking-wide text-sm`}
            value={qrToken}
            onChange={(event) => setQrToken(event.target.value)}
            placeholder="Scan rotating code or paste token..."
            autoComplete="off"
          />
          <p className="mt-2 text-[11px] text-ink-400">
            Hardware scanners automatically send Enter upon read. You can also paste tokens manually.
          </p>
        </div>

        {/* Divider */}
        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-white/[0.08]" />
          </div>
          <span className="relative bg-[#121216] px-3 text-[11px] font-medium uppercase tracking-wider text-ink-400">
            or manual lookup
          </span>
        </div>

        {/* Search Input */}
        <Field label="Member name, email or phone" htmlFor="search">
          <input
            id="search"
            name="search"
            className={inputClass}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="e.g. Maya Lin, maya@example.com, or +1 212 555 0199"
            autoComplete="off"
          />
        </Field>

        {/* Override Reason */}
        <Field
          label="Staff Override Reason"
          htmlFor="overrideReason"
          hint="Required only when admitting frozen, lapsed or unpaid memberships"
        >
          <input
            id="overrideReason"
            name="overrideReason"
            className={inputClass}
            value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)}
            placeholder="e.g. Courtesy pass approved by Manager"
          />
        </Field>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-1">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || (!qrToken.trim() && !search.trim())}
          >
            {busy ? (
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Validating Pass...
              </span>
            ) : (
              'Check In Member'
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setQrToken('')
              setSearch('')
              setOverrideReason('')
              setResult(null)
              setError(null)
              qrRef.current?.focus()
            }}
          >
            Clear Form
          </Button>
        </div>
      </form>

      {/* Error Banner */}
      {error ? (
        <div role="alert" className="mt-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <div className="space-y-1">
              <p className="font-semibold text-rose-300">{error}</p>
              {/frozen|expired|no membership|override/i.test(error) ? (
                <p className="text-xs text-rose-400/90">
                  Provide an <strong>Override Reason</strong> above and submit again if a manager has authorized admission.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Success Banner */}
      {result ? (
        <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                {result.memberName} admitted
              </p>
              <p className="text-xs text-ink-300 mt-0.5">
                Checked in at {new Date(result.checkedInAt ?? Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-ink-400">Status:</span>
                <Badge tone="positive">{result.membershipStatus ?? 'ACTIVE'}</Badge>
                {result.warning ? (
                  <span className="text-xs font-medium text-amber-400">{result.warning}</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
