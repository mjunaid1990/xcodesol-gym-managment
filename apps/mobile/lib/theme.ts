export const colors = {
  ink950: '#09090b',
  ink900: '#121215',
  ink850: '#18181b',
  ink800: '#202024',
  ink700: '#27272a',
  ink600: '#3f3f46',
  ink400: '#71717a',
  ink300: '#a1a1aa',
  ink200: '#e4e4e7',
  ink100: '#fafafa',
  white: '#ffffff',
  lime: '#ffffff',
  limeDark: '#e4e4e7',
  sky: '#38bdf8',
  amber: '#fbbf24',
  rose: '#fb7185',
  emerald: '#34d399',
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const

export const statusColor = (status?: string | null): string => {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
    case 'SUCCEEDED':
    case 'PAID':
    case 'ATTENDED':
      return colors.emerald
    case 'FROZEN':
    case 'PENDING':
    case 'WAITLISTED':
      return colors.amber
    case 'EXPIRED':
    case 'CANCELLED':
    case 'FAILED':
    case 'NO_SHOW':
      return colors.rose
    default:
      return colors.ink300
  }
}

export const formatMoney = (cents: number, currency = 'USD'): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)

export const formatDateTime = (value?: string | null): string => {
  if (!value) return '—'
  const date = new Date(value)
  return date.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export const formatDay = (value?: string | null): string => {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export const formatTime = (value?: string | null): string => {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
