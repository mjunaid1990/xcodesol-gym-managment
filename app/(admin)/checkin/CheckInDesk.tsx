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
 * The five-second rule: the QR field autofocuses so a USB scanner gun (which types the
 * code and presses Enter) works with no clicking. Everything else is one search box.
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
  }

  return (
    <Card title="Check a member in" description="QR pass first, then search. Overrides are logged with your name.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (qrToken) checkIn({ qrToken, method: 'QR' })
          else if (search) checkIn({ search, method: 'MANUAL', overrideReason: overrideReason || undefined })
        }}
      >
        <Field
          label="QR pass"
          htmlFor="qrToken"
          hint={
            scannerState === 'ready'
              ? 'Camera scanning is available in the member app; use a scanner gun or paste the code here.'
              : 'Type or scan the rotating code from the member app.'
          }
        >
          <input
            id="qrToken"
            ref={qrRef}
            name="qrToken"
            className={`${inputClass} font-mono`}
            value={qrToken}
            onChange={(event) => setQrToken(event.target.value)}
            placeholder="member-id.issued.signature"
            autoComplete="off"
          />
        </Field>

        <div className="flex items-center gap-3 text-xs text-ink-400">
          <span className="h-px flex-1 bg-ink-700" />
          or look them up
          <span className="h-px flex-1 bg-ink-700" />
        </div>

        <Field label="Name, email or phone" htmlFor="search">
          <input
            id="search"
            name="search"
            className={inputClass}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Mia Member / +1 212 555 0199"
            autoComplete="off"
          />
        </Field>

        <Field label="Override reason" htmlFor="overrideReason" hint="Only needed when the membership is frozen or expired">
          <input
            id="overrideReason"
            name="overrideReason"
            className={inputClass}
            value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)}
            placeholder="e.g. Guest pass approved by manager"
          />
        </Field>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy || (!qrToken && !search)}>
            {busy ? 'Checking…' : 'Check in'}
          </Button>
          <Button
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
            Clear
          </Button>
        </div>
      </form>

      {error ? (
        <div role="alert" className="mt-4 rounded-xl border border-rose-400/40 bg-rose-400/10 p-3 text-sm text-rose-400">
          {error}
          {/frozen|expired|no membership|override/i.test(error) ? (
            <p className="mt-1 text-xs text-ink-300">
              Add an override reason above and try again if a manager approved this visit.
            </p>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-4">
          <p className="text-sm font-semibold text-emerald-400">
            {result.memberName} checked in at {new Date(result.checkedInAt ?? Date.now()).toLocaleTimeString('en-US')}
          </p>
          <p className="mt-1 flex items-center gap-2 text-xs text-ink-200">
            Membership <Badge tone="positive">{result.membershipStatus}</Badge>
            {result.warning ? <span className="text-amber-400">{result.warning}</span> : null}
          </p>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-ink-400">
        Tip: press <kbd className="rounded bg-ink-800 px-1.5 py-0.5">Enter</kbd> after scanning. Duplicate scans inside 30
        minutes are rejected on purpose.
      </p>
    </Card>
  )
}
