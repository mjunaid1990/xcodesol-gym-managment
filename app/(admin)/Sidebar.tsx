'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ROLE_LABELS, type Role } from '@/lib/constants'
import { AdminNav } from './AdminNav'
import { LogoutButton } from './LogoutButton'

interface SidebarProps {
  user: {
    firstName: string | null
    lastName: string | null
    role: string
  }
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const role = user.role as Role
  const roleLabel = ROLE_LABELS[role] ?? role
  const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || 'XC'

  // Close mobile drawer on route navigation
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Prevent background scrolling when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const sidebarContent = (
    <div className="flex flex-col h-full w-full bg-[#0c0c0f] text-ink-100 select-none">
      {/* Brand Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-white via-zinc-200 to-zinc-400 text-ink-950 font-black text-xs shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-transform group-hover:scale-105">
            XC
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-[#0c0c0f]" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight text-white group-hover:text-zinc-200 transition-colors">
              Xcodesol Gym
            </span>
            <span className="text-[10px] font-medium tracking-wider text-ink-400 uppercase">
              Management Pro
            </span>
          </div>
        </Link>
        {mobileOpen && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden p-1.5 rounded-lg text-ink-400 hover:text-white hover:bg-white/[0.05]"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* User Profile Card */}
      <div className="shrink-0 mx-3.5 my-3.5 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center gap-3">
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

      {/* Navigation Links - Scrollable only inside this middle container */}
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        <AdminNav role={role} />
      </div>

      {/* Sign Out Button - Always fixed at the bottom of the sidebar */}
      <div className="shrink-0 p-3.5 border-t border-white/[0.06] bg-[#0c0c0f]">
        <LogoutButton />
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop / Tablet Sidebar: Fixed 100% height, strictly non-scrolling with right content */}
      <aside className="hidden md:flex md:w-64 md:shrink-0 md:h-screen md:max-h-screen border-r border-white/[0.08] bg-[#0c0c0f] z-30 flex-col overflow-hidden">
        {sidebarContent}
      </aside>

      {/* Mobile Top Header */}
      <div className="md:hidden shrink-0 flex items-center justify-between px-4 py-3 bg-[#0c0c0f] border-b border-white/[0.08] z-30">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-ink-950 font-black text-xs shadow-[0_0_10px_rgba(255,255,255,0.2)]">
            XC
          </div>
          <span className="text-sm font-semibold text-white">Xcodesol Gym</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-ink-200 hover:text-white hover:bg-white/[0.06] transition-colors"
          aria-label="Open navigation menu"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Mobile Slide-over Drawer Backdrop & Panel */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          {/* Slide-out drawer */}
          <div className="relative flex-1 flex flex-col max-w-xs w-full h-full shadow-2xl z-10">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  )
}
