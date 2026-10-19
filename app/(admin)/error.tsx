'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    console.error('Admin page error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.15)]">
        <svg
          className="h-7 w-7"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
      </div>

      <h1 className="mt-5 text-xl font-bold text-white tracking-tight">
        Temporary rendering issue
      </h1>
      <p className="mt-2 text-sm text-ink-300 max-w-md">
        An unexpected error occurred while loading this section. You can retry or return to the overview.
      </p>

      {error.digest ? (
        <p className="mt-3 font-mono text-[11px] text-ink-400 bg-white/[0.04] border border-white/[0.08] px-3 py-1 rounded-full">
          Reference: {error.digest}
        </p>
      ) : null}

      {error.message && !error.message.includes('Server Components render') ? (
        <div className="mt-3 max-w-lg text-left">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-[11px] text-ink-400 hover:text-white underline"
          >
            {showDetails ? 'Hide details' : 'Show error details'}
          </button>
          {showDetails ? (
            <pre className="mt-2 text-xs font-mono text-rose-300 bg-black/40 border border-rose-500/20 p-3 rounded-xl overflow-x-auto whitespace-pre-wrap">
              {error.message}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded-xl bg-white px-5 py-2.5 text-xs sm:text-sm font-semibold text-ink-950 shadow-[0_0_15px_rgba(255,255,255,0.15)] transition hover:bg-zinc-200 active:scale-95 cursor-pointer"
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl border border-white/[0.1] bg-white/[0.04] px-5 py-2.5 text-xs sm:text-sm font-medium text-ink-200 transition hover:bg-white/[0.08] hover:text-white active:scale-95 cursor-pointer"
        >
          Reload page
        </button>
        <Link
          href="/dashboard"
          className="rounded-xl border border-white/[0.1] bg-white/[0.04] px-5 py-2.5 text-xs sm:text-sm font-medium text-ink-200 transition hover:bg-white/[0.08] hover:text-white"
        >
          Overview
        </Link>
      </div>
    </div>
  )
}
