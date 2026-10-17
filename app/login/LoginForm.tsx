'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, Field, inputClass } from '@/components/ui'

export function LoginForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
