'use client'

import { useState } from 'react'
import { serverSignOut } from './actions'

export function LogoutButton() {
  const [busy, setBusy] = useState(false)

  async function signOut() {
    if (busy) return
    setBusy(true)
    try {
      // 1. Invalidate session in backend DB & cookies via API
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allDevices: false }),
      }).catch(() => null)

      // 2. Clear client-accessible cookies as a safety net
      if (typeof document !== 'undefined') {
        document.cookie = 'ih_access=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT'
        document.cookie = 'ih_refresh=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT'
        document.cookie = 'ih_refresh=; path=/api/v1/auth; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT'
      }

      // 3. Clear server cookies via server action
      await serverSignOut()
    } catch {
      // Hard redirect to login page with signedOut flag to prevent bouncing back
      window.location.href = '/login?signedOut=1'
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="group flex w-full items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-xs font-medium text-ink-300 transition-all duration-150 hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50 cursor-pointer"
    >
      <svg className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-x-0.5 text-ink-400 group-hover:text-rose-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
      </svg>
      <span>{busy ? 'Signing out…' : 'Sign out'}</span>
    </button>
  )
}
