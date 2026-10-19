'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Permission, Role } from '@/lib/constants'
import { can } from '@/lib/constants'

interface NavItem {
  href: string
  label: string
  permission?: Permission
  group: string
  icon: (active: boolean) => React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Overview',
    group: 'Run the gym',
    icon: (active) => (
      <svg className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-white' : 'text-ink-400 group-hover:text-ink-200'}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    href: '/checkin',
    label: 'Check-in',
    permission: 'attendance:write',
    group: 'Run the gym',
    icon: (active) => (
      <svg className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-emerald-400' : 'text-ink-400 group-hover:text-ink-200'}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75zM6.75 16.5h.75v.75h-.75zM16.5 6.75h.75v.75h-.75zM13.5 13.5h2.25v2.25H13.5zM17.25 17.25h3v3h-3zM13.5 18.75h1.5v1.5H13.5zM18.75 13.5h1.5v1.5h-1.5z" />
      </svg>
    ),
  },
  {
    href: '/classes',
    label: 'Timetable',
    permission: 'class:read',
    group: 'Run the gym',
    icon: (active) => (
      <svg className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-white' : 'text-ink-400 group-hover:text-ink-200'}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    ),
  },
  {
    href: '/members',
    label: 'Members',
    permission: 'member:read',
    group: 'Run the gym',
    icon: (active) => (
      <svg className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-white' : 'text-ink-400 group-hover:text-ink-200'}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    href: '/payments',
    label: 'Payments',
    permission: 'payment:read',
    group: 'Money',
    icon: (active) => (
      <svg className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-emerald-400' : 'text-ink-400 group-hover:text-ink-200'}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-6 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
      </svg>
    ),
  },
  {
    href: '/plans',
    label: 'Plans & pricing',
    permission: 'plan:read',
    group: 'Money',
    icon: (active) => (
      <svg className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-amber-400' : 'text-ink-400 group-hover:text-ink-200'}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
      </svg>
    ),
  },
  {
    href: '/reports',
    label: 'Reports',
    permission: 'report:read',
    group: 'Insight',
    icon: (active) => (
      <svg className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-sky-400' : 'text-ink-400 group-hover:text-ink-200'}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    href: '/staff',
    label: 'Staff & payroll',
    permission: 'staff:read',
    group: 'Insight',
    icon: (active) => (
      <svg className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-violet-400' : 'text-ink-400 group-hover:text-ink-200'}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
      </svg>
    ),
  },
  {
    href: '/announcements',
    label: 'Announcements',
    permission: 'announcement:read',
    group: 'Insight',
    icon: (active) => (
      <svg className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-amber-400' : 'text-ink-400 group-hover:text-ink-200'}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    ),
  },
  {
    href: '/audit',
    label: 'Audit log',
    permission: 'audit:read',
    group: 'Settings',
    icon: (active) => (
      <svg className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-white' : 'text-ink-400 group-hover:text-ink-200'}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    permission: 'setting:read',
    group: 'Settings',
    icon: (active) => (
      <svg className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-white' : 'text-ink-400 group-hover:text-ink-200'}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
      </svg>
    ),
  },
]

export function AdminNav({ role }: { role: Role }) {
  const pathname = usePathname()
  const visible = NAV_ITEMS.filter((item) => !item.permission || can(role, item.permission))
  const groups = Array.from(new Set(visible.map((item) => item.group)))

  return (
    <nav aria-label="Main" className="px-3.5 pb-4 space-y-5">
      {groups.map((group) => {
        const items = visible.filter((item) => item.group === group)
        return (
          <div key={group} className="space-y-1">
            <p className="px-3 text-[10px] font-semibold tracking-wider uppercase text-ink-400/80">
              {group}
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1 lg:flex-col">
              {items.map((item) => {
                const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname?.startsWith(item.href))
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-white/[0.08] text-white shadow-sm ring-1 ring-white/10'
                          : 'text-ink-300 hover:bg-white/[0.03] hover:text-white'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)]" />
                      )}
                      {item.icon(isActive)}
                      <span className="truncate">{item.label}</span>
                      {isActive && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
