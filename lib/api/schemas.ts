import { z } from 'zod'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(EMAIL_PATTERN, 'Enter a valid email address')
  .transform((value) => value.toLowerCase())

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(200)
  .refine((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value), {
    message: 'Include at least one letter and one number',
  })

export const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(40)
  .regex(/^[+0-9()\-\s]+$/, 'Enter a valid phone number')

export const idSchema = z.string().uuid()

export const paginationSchema = {
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
}

export const dateRangeSchema = {
  from: z.string().optional(),
  to: z.string().optional(),
  branchId: z.string().uuid().optional(),
}

export const memberFilterSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  membershipStatus: z.enum(['PENDING', 'ACTIVE', 'FROZEN', 'EXPIRED', 'CANCELLED']).optional(),
  branchId: z.string().uuid().optional(),
  hasWaiver: z.enum(['true', 'false']).optional(),
  inactiveForDays: z.coerce.number().int().min(1).max(365).optional(),
  sort: z.enum(['recent', 'name', 'expiring', 'outstanding']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

export const memberCreateSchema = z.object({
  email: emailSchema,
  phone: phoneSchema.optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  password: passwordSchema.optional(),
  branchId: z.string().uuid().optional(),
  dateOfBirth: z.string().max(20).optional(),
  addressLine: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  postalCode: z.string().max(20).optional(),
  emergencyContactName: z.string().max(120).optional(),
  emergencyContactPhone: phoneSchema.optional(),
  healthNotes: z.string().max(2000).optional(),
  acceptWaiver: z.boolean().optional(),
  planId: z.string().uuid().optional(),
  takePayment: z.boolean().optional(),
})

export const memberUpdateSchema = memberCreateSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  avatarUrl: z.string().max(500).optional(),
  marketingOptIn: z.boolean().optional(),
})

export const planSchema = z.object({
  branchId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().max(500).optional(),
  type: z.enum(['MEMBERSHIP', 'CLASS_PACK', 'DAY_PASS']),
  interval: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_TIME']),
  priceCents: z.coerce.number().int().min(0).max(100_000_000),
  currency: z.string().length(3).optional(),
  classCredits: z.coerce.number().int().min(0).max(1000).nullish(),
  freezeDaysPerYear: z.coerce.number().int().min(0).max(365).optional(),
  autoRenew: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
})

export const discountSchema = z.object({
  code: z.string().trim().min(3).max(40).transform((value) => value.toUpperCase()),
  description: z.string().max(300).optional(),
  percentOff: z.coerce.number().int().min(1).max(100).optional(),
  amountOffCents: z.coerce.number().int().min(1).optional(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  maxRedemptions: z.coerce.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
})

export const membershipPurchaseSchema = z.object({
  memberId: z.string().uuid(),
  planId: z.string().uuid(),
  discountCode: z.string().trim().max(40).optional(),
  autoRenew: z.boolean().optional(),
  skipPayment: z.boolean().optional(),
  startsAt: z.string().optional(),
})

export const membershipActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('renew'), skipPayment: z.boolean().optional(), discountCode: z.string().optional() }),
  z.object({
    action: z.literal('freeze'),
    days: z.coerce.number().int().min(1).max(180),
    reason: z.string().max(300).optional(),
  }),
  z.object({ action: z.literal('unfreeze') }),
  z.object({
    action: z.literal('cancel'),
    reason: z.string().trim().min(3).max(300),
    immediate: z.boolean().optional(),
  }),
  z.object({ action: z.literal('change-plan'), newPlanId: z.string().uuid(), skipPayment: z.boolean().optional() }),
])

export const sessionCreateSchema = z.object({
  branchId: z.string().uuid(),
  title: z.string().trim().min(2).max(120),
  trainerId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
  startsAt: z.string(),
  durationMin: z.coerce.number().int().min(15).max(300),
  capacity: z.coerce.number().int().min(1).max(200),
  creditCost: z.coerce.number().int().min(0).max(10).optional(),
  cancelWindowHours: z.coerce.number().int().min(0).max(72).optional(),
  lateCancelPenaltyCents: z.coerce.number().int().min(0).optional(),
  notes: z.string().max(500).optional(),
  allowConflictOverride: z.boolean().optional(),
})

export const templateCreateSchema = z.object({
  branchId: z.string().uuid(),
  title: z.string().trim().min(2).max(120),
  description: z.string().max(500).optional(),
  trainerId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
  capacity: z.coerce.number().int().min(1).max(200),
  durationMin: z.coerce.number().int().min(15).max(300),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  recurrence: z.enum(['WEEKLY', 'BIWEEKLY', 'NONE']).optional(),
  startsOn: z.string().min(8),
  endsOn: z.string().optional(),
  creditCost: z.coerce.number().int().min(0).max(10).optional(),
  cancelWindowHours: z.coerce.number().int().min(0).max(72).optional(),
  lateCancelPenaltyCents: z.coerce.number().int().min(0).optional(),
  horizonWeeks: z.coerce.number().int().min(1).max(52).optional(),
})

export const bookingCreateSchema = z.object({
  sessionId: z.string().uuid(),
  memberId: z.string().uuid().optional(),
  overrideEntitlement: z.boolean().optional(),
})

export const checkInSchema = z.object({
  qrToken: z.string().min(10).optional(),
  memberId: z.string().uuid().optional(),
  search: z.string().min(2).max(120).optional(),
  branchId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  method: z.enum(['QR', 'MANUAL', 'NFC', 'BIOMETRIC', 'CLASS']).optional(),
  overrideReason: z.string().max(200).optional(),
})

export const staffCreateSchema = z.object({
  email: emailSchema,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  role: z.enum(['TRAINER', 'STAFF', 'MANAGER', 'ADMIN']),
  phone: phoneSchema.optional(),
  branchId: z.string().uuid().optional(),
  jobTitle: z.string().max(120).optional(),
  hourlyRateCents: z.coerce.number().int().min(0).max(1_000_000).optional(),
  password: passwordSchema.optional(),
})

export const announcementSchema = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(2).max(4000),
  audience: z.enum(['ALL', 'MEMBERS', 'TRAINERS', 'STAFF']).optional(),
  channels: z.array(z.enum(['IN_APP', 'PUSH', 'EMAIL', 'SMS'])).min(1).optional(),
})

export const refundSchema = z.object({
  amountCents: z.coerce.number().int().min(1).optional(),
  reason: z.string().trim().min(3).max(300),
})

export const bulkMemberSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['activate', 'deactivate', 'suspend', 'note', 'grant-credits']),
  note: z.string().max(1000).optional(),
  credits: z.coerce.number().int().min(1).max(100).optional(),
})
