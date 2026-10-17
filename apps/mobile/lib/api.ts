import * as SecureStore from 'expo-secure-store'

const ACCESS_KEY = 'ih_access_token'
const REFRESH_KEY = 'ih_refresh_token'

/** Set EXPO_PUBLIC_API_URL to your deployed Vercel URL (no trailing slash). */
export const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

export interface SessionUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: 'MEMBER' | 'TRAINER' | 'STAFF' | 'MANAGER' | 'ADMIN'
  status: string
  branchId: string | null
  avatarUrl: string | null
}

export interface AuthPayload {
  user: SessionUser
  accessToken: string
  refreshToken?: string
}

export async function saveTokens(accessToken: string, refreshToken?: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, accessToken)
  if (refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, refreshToken)
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY)
  await SecureStore.deleteItemAsync(REFRESH_KEY)
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY)
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let refreshing: Promise<boolean> | null = null

/**
 * Every call goes through here: tokens are attached automatically, and an expired access
 * token triggers one refresh (shared between concurrent callers) before retrying once.
 */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; skipAuth?: boolean } = {},
): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (!options.skipAuth) {
      const token = await getAccessToken()
      if (token) headers.Authorization = `Bearer ${token}`
    }
    return fetch(`${API_BASE}/api/v1${path}`, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  }

  let response = await doFetch()

  if (response.status === 401 && !options.skipAuth) {
    const refreshed = await refreshSession()
    if (refreshed) response = await doFetch()
  }

  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: { code: string; message: string } }

  if (!response.ok) {
    throw new ApiError(response.status, payload.error?.code ?? 'request_failed', payload.error?.message ?? 'Something went wrong')
  }

  return payload.data as T
}

export async function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY)
      if (!refreshToken) return false
      const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!response.ok) {
        await clearTokens()
        return false
      }
      const payload = (await response.json()) as { data: { accessToken: string; refreshToken?: string } }
      await saveTokens(payload.data.accessToken, payload.data.refreshToken)
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/* --------------------------------- endpoints ------------------------------- */

export interface MembershipSnapshot {
  allowed: boolean
  reason: string
  creditsRemaining: number | null
  status: string | null
  endsAt: string | null
  autoRenew: boolean
  frozenUntil: string | null
}

export interface HomePayload {
  entitlement: MembershipSnapshot
  plan: { name: string; type: string; interval: string; priceCents: number } | null
  upcoming: ClassBooking[]
  stats: { visits: number; classesAttended: number; noShows: number; lateCancels: number; lastVisitAt: string | null }
  unreadNotifications: number
  recentVisits: { id: string; checkedInAt: string; sessionTitle: string | null; method: string }[]
}

export interface ClassBooking {
  bookingId: string
  bookingStatus: string
  waitlistPosition: number | null
  sessionId: string
  title: string
  startsAt: string
  endsAt: string
  branchName: string | null
  roomName: string | null
  trainerName: string | null
  checkedIn: boolean
}

export interface SessionOption {
  id: string
  title: string
  startsAt: string
  endsAt: string
  capacity: number
  bookedCount: number
  waitlistCount: number
  spotsLeft: number
  trainerName: string | null
  roomName: string | null
  branchName: string | null
  creditCost: number
  cancelWindowHours: number
  status: string
  myBooking: { id: string; status: string; waitlistPosition: number | null } | null
}

export const apiClient = {
  login: (identifier: string, password: string) =>
    api<AuthPayload>('/auth/login', { body: { identifier, password }, skipAuth: true }),

  register: (input: {
    email: string
    password: string
    firstName: string
    lastName: string
    phone?: string
    acceptWaiver?: boolean
  }) => api<AuthPayload>('/auth/register', { body: input, skipAuth: true }),

  logout: (allDevices = false) => api<{ revoked: number }>('/auth/logout', { body: { allDevices } }),

  me: () => api<{ user: SessionUser; profile: unknown; membership: unknown }>('/auth/me'),

  updateMe: (input: Record<string, unknown>) => api('/auth/me', { method: 'PATCH', body: input }),

  deleteMe: (reason?: string) => api('/auth/me', { method: 'DELETE', body: { reason } }),

  forgotPassword: (email: string) => api('/auth/forgot-password', { body: { email }, skipAuth: true }),

  registerDevice: (token: string, platform: string) => api('/auth/device', { body: { token, platform } }),

  home: () => api<HomePayload>('/me/home'),

  sessions: (query = '') => api<SessionOption[]>(`/me/sessions${query}`),

  book: (sessionId: string) => api<{ waitlisted: boolean; message: string }>('/me/bookings', { body: { sessionId } }),

  cancelBooking: (bookingId: string) => api<{ late: boolean; penaltyCents: number }>(`/me/bookings/${bookingId}`, { method: 'DELETE', body: {} }),

  myBookings: () => api<ClassBooking[]>('/me/bookings'),

  visits: (page = 1) => api<{ rows: { id: string; checkedInAt: string; method: string; sessionTitle: string | null; branchName: string | null }[] }>(`/me/visits?page=${page}`),

  payments: () =>
    api<{
      payments: { id: string; amountCents: number; status: string; currency: string; createdAt: string; invoiceNumber: string | null; description: string | null }[]
      invoices: { id: string; number: string; status: string; totalCents: number; issuedAt: string; description: string | null }[]
      totals: { lifetimeCents: number; refundedCents: number; failedCount: number }
    }>('/me/payments'),

  purchase: (planId: string) => api<{ totalCents: number; membership: unknown }>('/me/purchase', { body: { planId } }),

  notifications: () => api<{ rows: { id: string; title: string; body: string; readAt: string | null; createdAt: string }[]; unread: number }>('/me/notifications'),

  pass: () => api<{ token: string; expiresAt: string }>('/me/pass'),

  today: () => api<{ sessions: SessionOption[]; checkedInToday: boolean }>('/me/today'),

  trainerDay: (date?: string) =>
    api<{ date: string; sessions: SessionOption[]; upcomingTotal: number }>(`/trainer/day${date ? `?date=${date}` : ''}`),

  trainerCheckIn: (sessionId: string, memberId: string) =>
    api(`/trainer/sessions/${sessionId}/check-in`, { body: { memberId, method: 'CLASS' } }),
}
