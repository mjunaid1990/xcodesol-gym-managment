import Link from 'next/link'
import { requireStaffUser } from '@/lib/auth/current-user'
import { ROLE_LABELS, type Role } from '@/lib/constants'
import { AdminNav } from './AdminNav'
import { LogoutButton } from './LogoutButton'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffUser()
  const role = user.role as Role
  const roleLabel = ROLE_LABELS[role] ?? role
  const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || 'IH'

  return (
    <div className="flex min-h-screen flex-col lg:flex-row bg-[#08080a] text-ink-100 selection:bg-white selection:text-ink-950">
      {/* Sidebar */}
      <aside className="border-b border-white/[0.08] bg-[#0c0c0f]/90 backdrop-blur-xl lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r flex flex-col justify-between">
        <div>
          {/* Logo Brand Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
            <Link href="/dashboard" className="flex items-center gap-3 group">
              <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-white via-zinc-200 to-zinc-400 text-ink-950 font-black text-xs shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-transform group-hover:scale-105">
                IH
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-[#0c0c0f]" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-tight text-white group-hover:text-zinc-200 transition-colors">
                  Ironhouse Gym
                </span>
                <span className="text-[10px] font-medium tracking-wider text-ink-400 uppercase">
                  Management Pro
                </span>
              </div>
            </Link>
          </div>

          {/* User Profile Card */}
          <div className="mx-3.5 my-4 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-zinc-800 to-zinc-700 border border-white/10 text-white font-semibold text-xs shadow-inner">
              {initials}
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-[#18181c]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">
                {user.firstName} {user.lastName}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="truncate text-[11px] font-medium text-ink-300">
                  {roleLabel}
                </span>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <AdminNav role={role} />
        </div>

        {/* Footer Area with Sign Out */}
        <div className="p-3.5 border-t border-white/[0.06]">
          <LogoutButton />
        </div>
      </aside>

      {/* Main Content Viewport with Ambient Lighting */}
      <main id="main" className="relative min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8 overflow-y-auto">
        {/* Subtle Ambient Mesh Glow in top right */}
        <div className="pointer-events-none absolute -top-40 right-0 h-96 w-96 rounded-full bg-white/[0.02] blur-3xl" />
        <div className="pointer-events-none absolute top-40 left-1/3 h-64 w-64 rounded-full bg-sky-500/[0.015] blur-3xl" />

        <div className="relative z-10 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
