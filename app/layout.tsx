import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Ironhouse Gym — Operations',
    template: '%s · Ironhouse Gym',
  },
  description:
    'Run the gym from one screen: memberships, classes, bookings, check-ins, payments and reports for every branch.',
  applicationName: 'Ironhouse Gym',
}

export const viewport: Viewport = {
  themeColor: '#07090c',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950 text-ink-100">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-lime-500 focus:px-4 focus:py-2 focus:text-ink-950"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
