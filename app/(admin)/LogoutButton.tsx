'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function LogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    await fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    router.replace('/login')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="w-full rounded-lg border border-ink-700 px-3 py-2 text-left text-xs text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100 disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
