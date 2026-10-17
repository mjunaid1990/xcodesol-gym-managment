import Link from 'next/link'

export const metadata = { title: 'Use the app' }

export default function NoAccessPage() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-300">Ironhouse Console</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">This console is for gym staff</h1>
        <p className="mt-3 text-sm text-ink-300">
          Members book classes, renew and check in from the Ironhouse mobile app. If you are staff and cannot
          see the dashboard, your role may not include web access — ask a manager to update it.
        </p>
      </div>

      <ul className="space-y-2 text-sm text-ink-200">
        <li>• Book and cancel classes, with waitlist auto-promotion.</li>
        <li>• Rotating QR pass for the door — 90 seconds per scan, no screenshots.</li>
        <li>• Memberships, invoices and receipts in your pocket.</li>
        <li>• Trainers: today&apos;s classes and attendee list with one-tap check-in.</li>
      </ul>

      <div className="flex gap-3">
        <Link href="/login" className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-ink-950 hover:bg-zinc-200 transition-colors shadow-sm">
          Staff sign in
        </Link>
        <a href="/" className="rounded-xl border border-ink-700 bg-ink-800 px-4 py-3 text-sm text-ink-200 hover:bg-ink-700 hover:text-white transition-colors">
          Back to home
        </a>
      </div>
    </main>
  )
}
