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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-100">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-ink-300">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
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
    <section className={cn('card', className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-700 px-5 py-4">
          <div>
            {title ? <h2 className="text-sm font-semibold text-ink-100">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-ink-300">{description}</p> : null}
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
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'positive' | 'warning' | 'danger' | 'accent'
}) {
  const toneClass = {
    default: 'text-ink-100',
    positive: 'text-emerald-400',
    warning: 'text-amber-400',
    danger: 'text-rose-400',
    accent: 'text-lime-500',
  }[tone]

  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={cn('stat-value mt-2 text-2xl', toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-300">{hint}</p> : null}
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
    primary: 'bg-lime-500 text-ink-950 hover:bg-lime-400 font-semibold',
    secondary: 'bg-ink-700 text-ink-100 hover:bg-ink-600 border border-ink-600',
    ghost: 'bg-transparent text-ink-200 hover:bg-ink-800',
    danger: 'bg-rose-400/15 text-rose-400 hover:bg-rose-400/25 border border-rose-400/40',
  }
  const sizes = { sm: 'h-9 px-3 text-xs', md: 'h-11 px-4 text-sm' }

  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-50',
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
    neutral: 'bg-ink-700 text-ink-200 border-ink-600',
    positive: 'bg-emerald-400/12 text-emerald-400 border-emerald-400/30',
    warning: 'bg-amber-400/12 text-amber-400 border-amber-400/30',
    danger: 'bg-rose-400/12 text-rose-400 border-rose-400/30',
    info: 'bg-sky-400/12 text-sky-400 border-sky-400/30',
    accent: 'bg-lime-500/12 text-lime-500 border-lime-500/30',
  }
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone])}>
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-600 px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink-200">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-ink-400">{hint}</p> : null}
      {action}
    </div>
  )
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-700 text-left">
            {head.map((cell) => (
              <th key={cell} scope="col" className="whitespace-nowrap px-4 py-3 text-xs font-medium uppercase tracking-wide text-ink-400">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800">{children}</tbody>
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
  'h-11 w-full rounded-xl border border-ink-600 bg-ink-900 px-3 text-sm text-ink-100 placeholder:text-ink-400 focus:border-lime-500 focus:outline-none'

export const selectClass = inputClass

/* ---------------------------------- charts --------------------------------- */

/** Lightweight SVG sparkline: no chart library, no client JS, fast first paint. */
export function Sparkline({
  points,
  height = 56,
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
    .map((value, index) => `${index === 0 ? 'M' : 'L'} ${(index * step).toFixed(2)} ${(height - (value / max) * (height - 6) - 3).toFixed(2)}`)
    .join(' ')

  const stroke = { lime: 'var(--color-lime-500)', sky: 'var(--color-sky-400)', rose: 'var(--color-rose-400)', amber: 'var(--color-amber-400)' }[tone]

  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-14 w-full" role="img" aria-label={label ?? 'Trend'}>
        <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      {label ? <figcaption className="mt-1 text-xs text-ink-400">{label}</figcaption> : null}
    </figure>
  )
}

export function BarChart({ data, unit = '' }: { data: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(...data.map((point) => point.value), 1)
  return (
    <ul className="flex flex-col gap-2">
      {data.map((point) => (
        <li key={point.label} className="grid grid-cols-[3rem_1fr_4rem] items-center gap-3 text-xs">
          <span className="text-ink-300">{point.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-ink-800">
            <span
              className="block h-full rounded-full bg-lime-500/70"
              style={{ width: `${Math.round((point.value / max) * 100)}%` }}
            />
          </span>
          <span className="stat-value text-right text-ink-200">
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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function money(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100)
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return 'never'
  const date = typeof value === 'string' ? new Date(value) : value
  const diff = Date.now() - date.getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? 'a month ago' : `${months} months ago`
}
