export const ROLES = ['MEMBER', 'TRAINER', 'STAFF', 'MANAGER', 'ADMIN', 'OWNER'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  MEMBER: 'Member',
  TRAINER: 'Trainer',
  STAFF: 'Front desk',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
  OWNER: 'Owner',
}

export const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const MEMBERSHIP_STATUSES = ['PENDING', 'ACTIVE', 'FROZEN', 'EXPIRED', 'CANCELLED'] as const
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]

export const BOOKING_STATUSES = ['BOOKED', 'WAITLISTED', 'CANCELLED', 'ATTENDED', 'NO_SHOW'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

export const PLAN_TYPES = ['MEMBERSHIP', 'CLASS_PACK', 'DAY_PASS'] as const
export type PlanType = (typeof PLAN_TYPES)[number]

export const PLAN_INTERVALS = ['MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_TIME'] as const
export type PlanInterval = (typeof PLAN_INTERVALS)[number]

export const INTERVAL_MONTHS: Record<PlanInterval, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
  ONE_TIME: 0,
}

export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const
export const INVOICE_STATUSES = ['OPEN', 'PAID', 'VOID', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const

export const PERMISSIONS = [
  'branch:read',
  'branch:write',
  'member:read',
  'member:write',
  'member:delete',
  'plan:read',
  'plan:write',
  'membership:read',
  'membership:write',
  'class:read',
  'class:write',
  'booking:read',
  'booking:write',
  'attendance:read',
  'attendance:write',
  'payment:read',
  'payment:write',
  'payment:refund',
  'invoice:read',
  'report:read',
  'staff:read',
  'staff:write',
  'announcement:read',
  'announcement:write',
  'audit:read',
  'setting:read',
  'setting:write',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const STAFF_PERMISSIONS: Permission[] = [
  'branch:read',
  'member:read',
  'member:write',
  'plan:read',
  'membership:read',
  'membership:write',
  'class:read',
  'booking:read',
  'booking:write',
  'attendance:read',
  'attendance:write',
  'payment:read',
  'payment:write',
  'invoice:read',
  'report:read',
  'announcement:read',
]

const TRAINER_PERMISSIONS: Permission[] = [
  'branch:read',
  'member:read',
  'class:read',
  'booking:read',
  'attendance:read',
  'attendance:write',
  'announcement:read',
]

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: [...PERMISSIONS],
  MANAGER: PERMISSIONS.filter((p) => p !== 'setting:write'),
  STAFF: STAFF_PERMISSIONS,
  TRAINER: TRAINER_PERMISSIONS,
  MEMBER: [],
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export const ROLE_RANK: Record<Role, number> = {
  MEMBER: 1,
  TRAINER: 2,
  STAFF: 3,
  MANAGER: 4,
  ADMIN: 5,
  OWNER: 6,
}

export const WAIVER_VERSION = '2026-01'
export const CURRENCY = 'USD'
export const TAX_RATE = 0
export const CHECKIN_COOLDOWN_MINUTES = 30
