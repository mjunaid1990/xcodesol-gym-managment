import type { Database } from '@/lib/db/client'
import type { Permission } from '@/lib/constants'
import type { User } from '@/lib/db/schema'

export interface ApiContext {
  request: Request
  db: Database
  user: User | null
  params: Record<string, string>
  query: URLSearchParams
  url: URL
}

export type ApiHandler = (ctx: ApiContext) => Promise<unknown>

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** e.g. `members/:id/notes` */
  path: string
  handler: ApiHandler
  /** Required permission for staff/admin endpoints. */
  permission?: Permission
  /** Any-of permissions (used by dashboards that span domains). */
  anyPermission?: Permission[]
  /** Route is available to any signed-in user (e.g. own profile). */
  authenticated?: boolean
  /** Route does not require authentication at all. */
  public?: boolean
  description: string
}

export function numberParam(value: string | null | undefined, fallback?: number): number | undefined {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function boolParam(value: string | null | undefined): boolean | undefined {
  if (value === null || value === undefined || value === '') return undefined
  return value === 'true' || value === '1'
}

export function dateParam(value: string | null | undefined, fallback?: Date): Date | undefined {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date
}
