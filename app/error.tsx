'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Application error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-950 text-center px-4">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
        <svg
          className="h-8 w-8"
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

      <h1 className="mt-6 text-2xl font-bold text-white tracking-tight">
        An unexpected error occurred
      </h1>
      <p className="mt-2 text-sm text-ink-300 max-w-md">
        Something went wrong while rendering this page. You can try refreshing or heading back to the dashboard.
      </p>

      {error.digest ? (
        <p className="mt-4 font-mono text-xs text-ink-500 bg-ink-900 border border-ink-800 px-3 py-1.5 rounded-md">
          Error Reference: {error.digest}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-ink-950 shadow-sm transition hover:bg-zinc-200"
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl border border-ink-700 bg-ink-800 px-5 py-2.5 text-sm font-medium text-ink-200 transition hover:bg-ink-700 hover:text-white"
        >
          Reload page
        </button>
        <Link
          href="/login"
          className="rounded-xl border border-ink-700 bg-ink-800 px-5 py-2.5 text-sm font-medium text-ink-200 transition hover:bg-ink-700 hover:text-white"
        >
          Sign in
        </Link>
      </div>
    </div>
  )
}
