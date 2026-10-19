import type { ReactNode } from 'react'

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

/* --------------------------------- headings -------------------------------- */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle ? (
          <p className="mt-1.5 flex items-center gap-2 text-xs sm:text-sm text-ink-300">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span>{subtitle}</span>
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  )
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section className={cn('relative rounded-2xl border border-white/[0.07] bg-[#121216]/80 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.35)] transition-all duration-200 hover:border-white/[0.12]', className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            {title ? <h2 className="text-sm font-semibold tracking-tight text-white">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-ink-400">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  icon,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'positive' | 'warning' | 'danger' | 'accent'
  icon?: ReactNode
}) {
  const toneClass = {
    default: 'text-white',
    positive: 'text-emerald-400',
    warning: 'text-amber-400',
    danger: 'text-rose-400',
    accent: 'text-white',
  }[tone]

  const iconBg = {
    default: 'bg-white/[0.06] text-ink-300 border-white/[0.08]',
    positive: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_12px_rgba(16,185,129,0.15)]',
    warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.15)]',
    danger: 'bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-[0_0_12px_rgba(244,63,94,0.15)]',
    accent: 'bg-white/10 text-white border-white/20 shadow-[0_0_12px_rgba(255,255,255,0.1)]',
  }[tone]

  return (
    <div className="group relative rounded-2xl border border-white/[0.07] bg-[#121216]/80 p-5 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] hover:shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</p>
        {icon ? (
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-xl border', iconBg)}>
            {icon}
          </div>
        ) : null}
      </div>
      <p className={cn('stat-value mt-3 text-2xl sm:text-3xl font-bold tracking-tight', toneClass)}>{value}</p>
      {hint ? (
        <p className="mt-2 text-xs text-ink-400 flex items-center gap-1.5">
          <span className="inline-block h-1 w-1 rounded-full bg-ink-500" />
          <span>{hint}</span>
        </p>
      ) : null}
    </div>
  )
}

/* --------------------------------- controls -------------------------------- */

type ButtonProps = {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  type?: 'button' | 'submit'
  disabled?: boolean
  onClick?: () => void
  className?: string
  title?: string
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  type = 'button',
  disabled,
  onClick,
  className,
  title,
}: ButtonProps) {
  const variants = {
    primary: 'bg-white text-ink-950 hover:bg-zinc-200 font-semibold shadow-[0_0_15px_rgba(255,255,255,0.15)] transition-all active:scale-[0.98]',
    secondary: 'bg-white/[0.04] text-ink-100 hover:bg-white/[0.08] hover:text-white border border-white/[0.1] transition-all active:scale-[0.98]',
    ghost: 'bg-transparent text-ink-300 hover:bg-white/[0.05] hover:text-white transition-all',
    danger: 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/30 transition-all',
  }
  const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm' }

  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'info' | 'accent'
}) {
  const tones = {
    neutral: 'bg-white/[0.04] text-ink-300 border-white/[0.08]',
    positive: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25 shadow-[0_0_8px_rgba(16,185,129,0.1)]',
    warning: 'bg-amber-500/10 text-amber-400 border-amber-500/25 shadow-[0_0_8px_rgba(245,158,11,0.1)]',
    danger: 'bg-rose-500/10 text-rose-400 border-rose-500/25 shadow-[0_0_8px_rgba(244,63,94,0.1)]',
    info: 'bg-sky-500/10 text-sky-400 border-sky-500/25 shadow-[0_0_8px_rgba(56,189,248,0.1)]',
    accent: 'bg-white/10 text-white border-white/20',
  }

  const dot = {
    neutral: 'bg-ink-400',
    positive: 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.8)]',
    warning: 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.8)]',
    danger: 'bg-rose-400 shadow-[0_0_4px_rgba(251,113,133,0.8)]',
    info: 'bg-sky-400 shadow-[0_0_4px_rgba(56,189,248,0.8)]',
    accent: 'bg-white shadow-[0_0_4px_rgba(255,255,255,0.8)]',
  }[tone]

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide', tones[tone])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {children}
    </span>
  )
}

export function statusTone(status?: string | null): 'neutral' | 'positive' | 'warning' | 'danger' | 'info' | 'accent' {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
    case 'SUCCEEDED':
    case 'PAID':
    case 'ATTENDED':
      return 'positive'
    case 'FROZEN':
    case 'PENDING':
    case 'QUEUED':
    case 'WAITLISTED':
      return 'warning'
    case 'EXPIRED':
    case 'CANCELLED':
    case 'FAILED':
    case 'SUSPENDED':
    case 'NO_SHOW':
      return 'danger'
    case 'SCHEDULED':
      return 'info'
    default:
      return 'neutral'
  }
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] px-6 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-ink-400">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
      </div>
      <p className="mt-2 text-sm font-semibold text-white">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-ink-400">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/[0.06] text-left">
            {head.map((cell) => (
              <th key={cell} scope="col" className="whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400/90">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">{children}</tbody>
      </table>
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string
  hint?: string
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-300">{label}</span>
      {children}
      {hint ? <span className="text-xs text-ink-400">{hint}</span> : null}
    </label>
  )
}

export const inputClass =
  'h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 text-sm text-white placeholder:text-ink-500 focus:border-white/30 focus:bg-white/[0.05] focus:outline-none transition-all'

export const selectClass = inputClass

/* ---------------------------------- charts --------------------------------- */

/** Modern SVG sparkline with area fill gradient */
export function Sparkline({
  points,
  height = 64,
  tone = 'lime',
  label,
}: {
  points: number[]
  height?: number
  tone?: 'lime' | 'sky' | 'rose' | 'amber'
  label?: string
}) {
  if (!points.length) return null
  const max = Math.max(...points, 1)
  const width = 100
  const step = points.length > 1 ? width / (points.length - 1) : width
  const path = points
    .map((value, index) => `${index === 0 ? 'M' : 'L'} ${(index * step).toFixed(2)} ${(height - (value / max) * (height - 12) - 6).toFixed(2)}`)
    .join(' ')

  const stroke = {
    lime: '#ffffff',
    sky: '#38bdf8',
    rose: '#fb7185',
    amber: '#fbbf24',
  }[tone]

  const areaPath = `${path} L ${width} ${height} L 0 ${height} Z`
  const gradId = `spark-grad-${tone}`

  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-16 w-full overflow-visible" role="img" aria-label={label ?? 'Trend'}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label ? <figcaption className="mt-2 text-xs font-medium text-ink-400">{label}</figcaption> : null}
    </figure>
  )
}

export function BarChart({ data, unit = '' }: { data: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(...data.map((point) => point.value), 1)
  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((point) => (
        <li key={point.label} className="grid grid-cols-[3.25rem_1fr_3.5rem] items-center gap-3 text-xs">
          <span className="font-medium text-ink-400">{point.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-white/[0.04] p-0.5">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-zinc-400 to-white shadow-[0_0_6px_rgba(255,255,255,0.3)] transition-all duration-500"
              style={{ width: `${Math.max(point.value > 0 ? 6 : 0, Math.round((point.value / max) * 100))}%` }}
            />
          </span>
          <span className="stat-value text-right font-semibold text-white">
            {point.value}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function money(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined || isNaN(cents)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100)
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return 'never'
  const date = typeof value === 'string' ? new Date(value) : value
  if (isNaN(date.getTime())) return 'never'
  const diff = Date.now() - date.getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? 'a month ago' : `${months} months ago`
}
