import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Schema conventions
 * - Money is an integer count of minor units (cents). No floats.
 * - Status/role values are text validated by Zod at the edge. Adding a status then
 *   needs no migration, and the same schema runs on PGlite and Postgres.
 * - Every operational table is reachable from `branches` so multi-branch filtering,
 *   exports and the audit trail can be scoped consistently.
 */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  addressLine: text('address_line'),
  city: text('city'),
  country: text('country').default('US'),
  timezone: text('timezone').notNull().default('UTC'),
  phone: text('phone'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    role: text('role').notNull().default('MEMBER'),
    status: text('status').notNull().default('ACTIVE'),
    avatarUrl: text('avatar_url'),
    jobTitle: text('job_title'),
    hourlyRateCents: integer('hourly_rate_cents'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    pushTokens: jsonb('push_tokens').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_phone_uq').on(t.phone),
    index('users_role_idx').on(t.role),
    index('users_branch_idx').on(t.branchId),
  ],
)

export const memberProfiles = pgTable(
  'member_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dateOfBirth: date('date_of_birth'),
    gender: text('gender'),
    addressLine: text('address_line'),
    city: text('city'),
    postalCode: text('postal_code'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    healthNotes: text('health_notes'),
    waiverSignedAt: timestamp('waiver_signed_at', { withTimezone: true }),
    waiverVersion: text('waiver_version'),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('member_profiles_user_uq').on(t.userId)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sessions_token_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
)

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(), // EMAIL_VERIFY | PASSWORD_RESET
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('verification_token_uq').on(t.tokenHash),
    index('verification_user_idx').on(t.userId, t.purpose),
  ],
)

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull().default('MEMBERSHIP'), // MEMBERSHIP | CLASS_PACK | DAY_PASS
  interval: text('interval').notNull().default('MONTHLY'), // MONTHLY | QUARTERLY | ANNUAL | ONE_TIME
  priceCents: integer('price_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  classCredits: integer('class_credits'),
  freezeDaysPerYear: integer('freeze_days_per_year').notNull().default(0),
  autoRenew: boolean('auto_renew').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const discounts = pgTable(
  'discounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    description: text('description'),
    percentOff: integer('percent_off'),
    amountOffCents: integer('amount_off_cents'),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    maxRedemptions: integer('max_redemptions'),
    redemptions: integer('redemptions').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('discounts_code_uq').on(t.code)],
)

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('PENDING'), // PENDING | ACTIVE | FROZEN | EXPIRED | CANCELLED
    priceCents: integer('price_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    autoRenew: boolean('auto_renew').notNull().default(true),
    creditsRemaining: integer('credits_remaining'),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
    freezeEndsAt: timestamp('freeze_ends_at', { withTimezone: true }),
    frozenDaysUsed: integer('frozen_days_used').notNull().default(0),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('memberships_member_idx').on(t.memberId, t.status),
    index('memberships_ends_idx').on(t.endsAt),
  ],
)

export const membershipEvents = pgTable(
  'membership_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // CREATED | RENEWED | FROZEN | UNFROZEN | CANCELLED | CHANGED | EXPIRED
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    amountCents: integer('amount_cents'),
    note: text('note'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('membership_events_membership_idx').on(t.membershipId)],
)

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id').references(() => memberships.id, { onDelete: 'set null' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    subtotalCents: integer('subtotal_cents').notNull(),
    discountCents: integer('discount_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    amountPaidCents: integer('amount_paid_cents').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    status: text('status').notNull().default('OPEN'), // OPEN | PAID | VOID | REFUNDED | PARTIALLY_REFUNDED
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    description: text('description'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoices_number_uq').on(t.number),
    index('invoices_member_idx').on(t.memberId),
    index('invoices_status_idx').on(t.status, t.issuedAt),
  ],
)

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id').references(() => memberships.id, { onDelete: 'set null' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    status: text('status').notNull().default('PENDING'), // PENDING | SUCCEEDED | FAILED | REFUNDED | PARTIALLY_REFUNDED
    provider: text('provider').notNull().default('mock'), // stripe | mock | cash | terminal
    providerRef: text('provider_ref'),
    clientSecret: text('client_secret'),
    method: text('method'), // card | apple_pay | cash | transfer
    failureReason: text('failure_reason'),
    attempts: integer('attempts').notNull().default(0),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    refundedCents: integer('refunded_cents').notNull().default(0),
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_idempotency_uq').on(t.idempotencyKey),
    index('payments_member_idx').on(t.memberId, t.createdAt),
    index('payments_status_idx').on(t.status, t.createdAt),
  ],
)

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payments.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  reason: text('reason').notNull(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  providerRef: text('provider_ref'),
  createdAt: createdAt(),
})

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  capacity: integer('capacity').notNull().default(20),
  isActive: boolean('is_active').notNull().default(true),
})

export const classTemplates = pgTable(
  'class_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    trainerId: uuid('trainer_id').references(() => users.id, { onDelete: 'set null' }),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    capacity: integer('capacity').notNull().default(20),
    durationMin: integer('duration_min').notNull().default(60),
    startTime: text('start_time').notNull().default('18:00'), // local HH:mm
    dayOfWeek: integer('day_of_week').notNull().default(1), // 0 = Sunday
    recurrence: text('recurrence').notNull().default('WEEKLY'), // WEEKLY | BIWEEKLY | NONE
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),
    creditCost: integer('credit_cost').notNull().default(1),
    cancelWindowHours: integer('cancel_window_hours').notNull().default(6),
    lateCancelPenaltyCents: integer('late_cancel_penalty_cents').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('class_templates_branch_idx').on(t.branchId)],
)

export const classSessions = pgTable(
  'class_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id').references(() => classTemplates.id, { onDelete: 'set null' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    trainerId: uuid('trainer_id').references(() => users.id, { onDelete: 'set null' }),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    capacity: integer('capacity').notNull().default(20),
    status: text('status').notNull().default('SCHEDULED'), // SCHEDULED | CANCELLED | COMPLETED
    creditCost: integer('credit_cost').notNull().default(1),
    cancelWindowHours: integer('cancel_window_hours').notNull().default(6),
    lateCancelPenaltyCents: integer('late_cancel_penalty_cents').notNull().default(0),
    notes: text('notes'),
    cancellationReason: text('cancellation_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('class_sessions_starts_idx').on(t.startsAt),
    index('class_sessions_branch_starts_idx').on(t.branchId, t.startsAt),
    index('class_sessions_trainer_idx').on(t.trainerId, t.startsAt),
    uniqueIndex('class_sessions_template_start_uq').on(t.templateId, t.startsAt),
  ],
)

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => classSessions.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('BOOKED'), // BOOKED | WAITLISTED | CANCELLED | ATTENDED | NO_SHOW
    waitlistPosition: integer('waitlist_position'),
    creditCharged: boolean('credit_charged').notNull().default(false),
    lateCancel: boolean('late_cancel').notNull().default(false),
    bookedAt: timestamp('booked_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    attendedAt: timestamp('attended_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('bookings_session_member_uq').on(t.sessionId, t.memberId),
    index('bookings_session_status_idx').on(t.sessionId, t.status),
    index('bookings_member_idx').on(t.memberId, t.bookedAt),
  ],
)

export const attendance = pgTable(
  'attendance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => classSessions.id, { onDelete: 'set null' }),
    method: text('method').notNull().default('QR'), // QR | MANUAL | NFC | BIOMETRIC | CLASS
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }).notNull().defaultNow(),
    checkedInBy: uuid('checked_in_by').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
  },
  (t) => [
    index('attendance_member_idx').on(t.memberId, t.checkedInAt),
    index('attendance_branch_idx').on(t.branchId, t.checkedInAt),
  ],
)

export const memberNotes = pgTable(
  'member_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    isPinned: boolean('is_pinned').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('member_notes_member_idx').on(t.memberId)],
)

export const announcements = pgTable('announcements', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  audience: text('audience').notNull().default('ALL'), // ALL | MEMBERS | TRAINERS | STAFF
  channels: jsonb('channels').$type<string[]>().notNull().default(['PUSH', 'EMAIL']),
  status: text('status').notNull().default('DRAFT'), // DRAFT | SENT
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
})

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // BOOKING_CONFIRMED | CLASS_REMINDER | EXPIRY | PAYMENT_FAILED | ANNOUNCEMENT
    title: text('title').notNull(),
    body: text('body').notNull(),
    channel: text('channel').notNull().default('IN_APP'),
    status: text('status').notNull().default('QUEUED'), // QUEUED | SENT | FAILED | SIMULATED
    error: text('error'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email'),
    action: text('action').notNull(), // member.update, payment.refund, auth.login ...
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_entity_idx').on(t.entity, t.entityId),
  ],
)

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
})

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    ip: text('ip'),
    success: boolean('success').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('login_attempts_email_idx').on(t.email, t.createdAt)],
)

export type Branch = typeof branches.$inferSelect
export type User = typeof users.$inferSelect
export type MemberProfile = typeof memberProfiles.$inferSelect
export type Plan = typeof plans.$inferSelect
export type Membership = typeof memberships.$inferSelect
export type Invoice = typeof invoices.$inferSelect
export type Payment = typeof payments.$inferSelect
export type ClassSession = typeof classSessions.$inferSelect
export type Booking = typeof bookings.$inferSelect
export type Attendance = typeof attendance.$inferSelect
export type Announcement = typeof announcements.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect
