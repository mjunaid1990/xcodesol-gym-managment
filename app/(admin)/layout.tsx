import { requireStaffUser } from '@/lib/auth/current-user'
import { Sidebar } from './Sidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffUser()

  return (
    <div className="flex flex-col md:flex-row h-screen h-dvh w-full overflow-hidden bg-[#08080a] text-ink-100 selection:bg-white selection:text-ink-950">
      {/* Sidebar - fixed left panel, strictly locked to viewport height */}
      <Sidebar
        user={{
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        }}
      />

      {/* Main Content Viewport - THE ONLY PART THAT SCROLLS */}
      <main id="main" className="relative flex-1 h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-5 py-6 sm:px-8 sm:py-8">
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
