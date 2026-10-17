export const colors = {
  ink950: '#07090c',
  ink900: '#0b0f14',
  ink850: '#11161d',
  ink800: '#161d26',
  ink700: '#1f2733',
  ink600: '#2b3543',
  ink400: '#6b7787',
  ink300: '#98a4b3',
  ink200: '#c3ccd8',
  ink100: '#e8edf3',
  lime: '#b8f23c',
  limeDark: '#94cc1f',
  sky: '#4cc9f0',
  amber: '#f5b642',
  rose: '#f0667a',
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
