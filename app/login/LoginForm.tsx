'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Button, Field, inputClass } from '@/components/ui'

export function LoginForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [signedOutNotice, setSignedOutNotice] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      if (urlParams.get('signedOut') === '1' || urlParams.get('logout') === 'true') {
        setSignedOutNotice(true)
        // Ensure client-accessible cookies are expunged
        document.cookie = 'ih_access=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT'
        document.cookie = 'ih_refresh=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT'
        document.cookie = 'ih_refresh=; path=/api/v1/auth; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT'
      }
    }
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const formData = new FormData(event.currentTarget)
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        identifier: formData.get('identifier'),
        password: formData.get('password'),
      }),
    })

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string }
      data?: { user?: { role?: string } }
    }

    if (!response.ok) {
      setError(payload.error?.message ?? 'Sign-in failed')
      setBusy(false)
      return
    }

    const role = payload.data?.user?.role
    router.replace(role === 'MEMBER' ? '/no-access' : '/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {signedOutNotice ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-400">
          <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-medium">You have been signed out successfully.</span>
        </div>
      ) : null}

      <Field label="Email or phone" htmlFor="identifier">
        <input
          id="identifier"
          name="identifier"
          className={inputClass}
          autoComplete="username"
          defaultValue="admin@ironhouse.test"
          required
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <input
          id="password"
          name="password"
          type="password"
          className={inputClass}
          autoComplete="current-password"
          defaultValue="Passw0rd!"
          required
        />
      </Field>

      {error ? (
        <p role="alert" className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-400">
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>

      <p className="text-xs text-ink-400">
        Forgot your password? Ask a manager to trigger a reset, or use “Forgot password” in the member app.
      </p>
    </form>
  )
}
