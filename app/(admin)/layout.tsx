import Link from 'next/link'
import { requireStaffUser } from '@/lib/auth/current-user'
import { can, ROLE_LABELS, type Permission, type Role } from '@/lib/constants'
import { LogoutButton } from './LogoutButton'

const NAV: { href: string; label: string; permission?: Permission; group: string }[] = [
  { href: '/dashboard', label: 'Overview', group: 'Run the gym' },
  { href: '/checkin', label: 'Check-in', permission: 'attendance:write', group: 'Run the gym' },
  { href: '/classes', label: 'Timetable', permission: 'class:read', group: 'Run the gym' },
  { href: '/members', label: 'Members', permission: 'member:read', group: 'Run the gym' },
  { href: '/payments', label: 'Payments', permission: 'payment:read', group: 'Money' },
  { href: '/plans', label: 'Plans & pricing', permission: 'plan:read', group: 'Money' },
  { href: '/reports', label: 'Reports', permission: 'report:read', group: 'Insight' },
  { href: '/staff', label: 'Staff & payroll', permission: 'staff:read', group: 'Insight' },
  { href: '/announcements', label: 'Announcements', permission: 'announcement:read', group: 'Insight' },
  { href: '/audit', label: 'Audit log', permission: 'audit:read', group: 'Settings' },
  { href: '/settings', label: 'Settings', permission: 'setting:read', group: 'Settings' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffUser()
  const role = user.role as Role
  const visible = NAV.filter((item) => !item.permission || can(role, item.permission))
  const groups = Array.from(new Set(visible.map((item) => item.group)))

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="border-b border-ink-800 bg-ink-900 lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-4 px-5 py-4 lg:block">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-xs font-bold text-ink-950 shadow-sm">IH</span>
            <span className="text-sm font-semibold tracking-tight text-white">Ironhouse Gym</span>
          </Link>
          <div className="lg:mt-4 lg:border-t lg:border-ink-800 lg:pt-4">
            <p className="text-sm font-medium text-ink-100">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-xs text-ink-400">{ROLE_LABELS[role]}</p>
          </div>
        </div>

        <nav aria-label="Main" className="px-3 pb-4">
          {groups.map((group) => (
            <div key={group} className="mt-3">
              <p className="px-2 text-[11px] font-medium uppercase tracking-wider text-ink-400">{group}</p>
              <ul className="mt-1 flex flex-wrap gap-1 lg:flex-col">
                {visible
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="block rounded-lg px-3 py-2 text-sm text-ink-200 transition-colors hover:bg-ink-800 hover:text-ink-100"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <div className="mt-6 px-2">
            <LogoutButton />
          </div>
        </nav>
      </aside>

      <main id="main" className="min-w-0 flex-1 px-5 py-6 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  )
}
