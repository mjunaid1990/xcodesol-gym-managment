import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in' }

const DEMO_ACCOUNTS = [
  { role: 'Owner / Admin', email: 'admin@ironhouse.test' },
  { role: 'Manager', email: 'manager@ironhouse.test' },
  { role: 'Front desk', email: 'frontdesk@ironhouse.test' },
  { role: 'Trainer', email: 'trainer@ironhouse.test' },
]

export default async function LoginPage() {
  const user = await getCurrentUser()
  if (user) redirect(user.role === 'MEMBER' ? '/no-access' : '/dashboard')

  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between border-r border-ink-800 bg-ink-900 p-10 lg:flex">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-300">Ironhouse Console</p>
          <h1 className="mt-4 max-w-md text-4xl font-semibold leading-tight tracking-tight text-white">
            The front desk, the timetable and the books — in one place.
          </h1>
          <p className="mt-4 max-w-md text-sm text-ink-300">
            Check members in from a phone, sell a membership in three taps, and see today&apos;s numbers
            without opening a spreadsheet.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-6 text-sm">
          <div>
            <dt className="text-ink-400">Typical check-in</dt>
            <dd className="stat-value mt-1 text-2xl text-white">&lt; 5s</dd>
          </div>
          <div>
            <dt className="text-ink-400">Branches supported</dt>
            <dd className="stat-value mt-1 text-2xl">Multi-site</dd>
          </div>
          <div>
            <dt className="text-ink-400">Payments</dt>
            <dd className="stat-value mt-1 text-2xl">Card + desk</dd>
          </div>
          <div>
            <dt className="text-ink-400">Audit trail</dt>
            <dd className="stat-value mt-1 text-2xl">Every change</dd>
          </div>
        </dl>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <header className="mb-6">
            <h2 className="text-xl font-semibold">Sign in to the operations console</h2>
            <p className="mt-1 text-sm text-ink-300">
              Use your gym email. Members should use the Ironhouse app instead.
            </p>
          </header>

          <LoginForm />

          <div className="mt-8 rounded-xl border border-ink-700 bg-ink-900/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Demo accounts (password: Passw0rd!)</p>
            <ul className="mt-2 grid gap-1 text-xs text-ink-200">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email} className="flex items-center justify-between gap-3">
                  <span className="text-ink-400">{account.role}</span>
                  <code className="rounded bg-ink-800 px-2 py-0.5">{account.email}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  )
}
