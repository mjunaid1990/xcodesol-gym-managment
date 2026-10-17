'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, cn } from '@/components/ui'

interface ActionFormProps {
  endpoint: string
  method?: 'POST' | 'PATCH' | 'DELETE'
  children: ReactNode
  submitLabel: string
  variant?: 'primary' | 'secondary' | 'danger'
  onDone?: 'refresh' | 'reload' | 'none'
  successMessage?: string
  className?: string
  resetOnSuccess?: boolean
  /** Static fields merged into the payload (ids, actions...). */
  extra?: Record<string, unknown>
  /** Convert numbers/booleans before sending: 'number' | 'boolean' | 'csv' */
  coerce?: Record<string, 'number' | 'boolean' | 'csv' | 'json'>
  confirmMessage?: string
}

/**
 * One form component for the whole dashboard: collects inputs, posts JSON, shows the
 * API's error message inline (our errors are written for humans), then refreshes the
 * server components so the table reflects reality.
 */
export function ActionForm({
  endpoint,
  method = 'POST',
  children,
  submitLabel,
  variant = 'primary',
  onDone = 'refresh',
  successMessage,
  className,
  resetOnSuccess = true,
  extra,
  coerce,
  confirmMessage,
}: ActionFormProps) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'saving' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (confirmMessage && !window.confirm(confirmMessage)) return

    setStatus('saving')
    setError(null)

    const form = event.currentTarget
    const formData = new FormData(form)
    const payload: Record<string, unknown> = { ...extra }

    formData.forEach((value, key) => {
      if (value === '') return
      const raw = value.toString()
      const mode = coerce?.[key]
      if (mode === 'number') payload[key] = Number(raw)
      else if (mode === 'boolean') payload[key] = raw === 'true' || raw === 'on'
      else if (mode === 'csv') payload[key] = raw.split(',').map((item) => item.trim()).filter(Boolean)
      else if (mode === 'json') payload[key] = JSON.parse(raw)
      else payload[key] = raw
    })

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
      if (!response.ok) {
        setError(body.error?.message ?? `Request failed (${response.status})`)
        setStatus('idle')
        return
      }
      if (resetOnSuccess) form.reset()
      setStatus('done')
      if (onDone === 'reload') window.location.reload()
      else if (onDone === 'refresh') router.refresh()
      setTimeout(() => setStatus('idle'), 2600)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Network error')
      setStatus('idle')
    }
  }

  return (
    <form onSubmit={submit} className={cn('flex flex-col gap-3', className)}>
      {children}
      <div className="flex items-center gap-3">
        <Button type="submit" variant={variant} disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : submitLabel}
        </Button>
        {status === 'done' && successMessage ? <span className="text-xs text-emerald-400">{successMessage}</span> : null}
        {error ? (
          <span role="alert" className="text-xs text-rose-400">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  )
}

/** Inline action for table rows: freeze, cancel, refund, mark paid… */
export function ActionButton({
  endpoint,
  method = 'POST',
  body,
  label,
  variant = 'secondary',
  confirmMessage,
  size = 'sm',
  title,
}: {
  endpoint: string
  method?: 'POST' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
  label: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  confirmMessage?: string
  size?: 'sm' | 'md'
  title?: string
}) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (confirmMessage && !window.confirm(confirmMessage)) return
    setState('busy')
    setError(null)
    const response = await fetch(endpoint, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
      setError(payload.error?.message ?? 'Failed')
      setState('error')
      return
    }
    setState('idle')
    router.refresh()
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button size={size} variant={variant} onClick={run} disabled={state === 'busy'} title={title ?? label}>
        {state === 'busy' ? '…' : label}
      </Button>
      {error ? (
        <span role="alert" className="text-[11px] text-rose-400" title={error}>
          {error.slice(0, 40)}
        </span>
      ) : null}
    </span>
  )
}
