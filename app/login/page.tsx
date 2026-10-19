import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign In — Xcodesol Console' }
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const user = await getCurrentUser()
  if (user) redirect(user.role === 'MEMBER' ? '/no-access' : '/dashboard')

  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-2 bg-[#09090b]">
      {/* Left hero branding */}
      <section className="hidden flex-col justify-between border-r border-white/[0.08] bg-gradient-to-b from-[#0e0e12] to-[#09090b] p-12 lg:flex relative overflow-hidden">
        {/* Ambient lighting */}
        <div className="pointer-events-none absolute -top-24 -left-24 h-96 w-96 rounded-full bg-emerald-500/[0.04] blur-3xl" />
        <div className="pointer-events-none absolute bottom-12 right-12 h-80 w-80 rounded-full bg-white/[0.02] blur-3xl" />

        <div className="relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-ink-950 font-black text-xs shadow-[0_0_15px_rgba(255,255,255,0.2)]">
              XC
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-300">Xcodesol Console</span>
          </div>

          <h1 className="mt-8 max-w-md text-4xl font-bold leading-tight tracking-tight text-white">
            The front desk, the timetable, and live floor operations — unified.
          </h1>
          <p className="mt-4 max-w-md text-sm text-ink-300 leading-relaxed">
            Real-time QR entry pass validation, live occupancy monitoring, class scheduling, and member management.
          </p>
        </div>

        <dl className="relative z-10 grid grid-cols-2 gap-6 text-sm border-t border-white/[0.06] pt-8">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <dt className="text-xs text-ink-400 font-medium">Rapid Check-in</dt>
            <dd className="stat-value mt-1.5 text-2xl font-bold text-white">&lt; 3s</dd>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <dt className="text-xs text-ink-400 font-medium">Multi-site</dt>
            <dd className="stat-value mt-1.5 text-2xl font-bold text-white">Full sync</dd>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <dt className="text-xs text-ink-400 font-medium">Ledger & Billing</dt>
            <dd className="stat-value mt-1.5 text-2xl font-bold text-emerald-400">Card + Desk</dd>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <dt className="text-xs text-ink-400 font-medium">Audit Trail</dt>
            <dd className="stat-value mt-1.5 text-2xl font-bold text-white">Append-only</dd>
          </div>
        </dl>
      </section>

      {/* Right login form */}
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <header className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight text-white">Sign in to console</h2>
            <p className="mt-1.5 text-xs text-ink-300">
              Authorized staff and manager credentials. Members should use the mobile app.
            </p>
          </header>

          <div className="rounded-2xl border border-white/[0.08] bg-[#121216]/80 p-6 backdrop-blur-xl shadow-2xl">
            <LoginForm />
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-ink-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>Secure 256-bit encrypted authentication session</span>
          </div>
        </div>
      </section>
    </main>
  )
}
