import { eq, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { appSettings } from '@/lib/db/schema'
import { writeAudit } from './audit'

export interface GymSettings {
  name: string
  supportEmail: string
  supportPhone: string
  currency: string
  checkin: {
    qrEnabled: boolean
    qrTtlSeconds: number
    allowManualOverride: boolean
    cooldownMinutes: number
  }
  billing: {
    autoRenewReminderDays: number
    retryFailedPayments: boolean
    retryScheduleDays: number[]
    taxRatePercent: number
  }
  classes: {
    defaultCancelWindowHours: number
    defaultCapacity: number
    waitlistEnabled: boolean
    autoPromoteWaitlist: boolean
  }
}

export const DEFAULT_SETTINGS: GymSettings = {
  name: 'Xcodesol Gym',
  supportEmail: 'help@xcodesol.test',
  supportPhone: '',
  currency: 'USD',
  checkin: { qrEnabled: true, qrTtlSeconds: 90, allowManualOverride: true, cooldownMinutes: 30 },
  billing: { autoRenewReminderDays: 7, retryFailedPayments: true, retryScheduleDays: [1, 3, 7], taxRatePercent: 0 },
  classes: { defaultCancelWindowHours: 6, defaultCapacity: 20, waitlistEnabled: true, autoPromoteWaitlist: true },
}

export async function getSettings(db: Database): Promise<GymSettings> {
  const rows = await db.select().from(appSettings)
  const byKey = new Map(rows.map((row) => [row.key, row.value as Record<string, unknown>]))

  const gym = byKey.get('gym') ?? {}
  const checkin = byKey.get('checkin') ?? {}
  const billing = byKey.get('billing') ?? {}
  const classes = byKey.get('classes') ?? {}

  return {
    name: (gym.name as string) ?? DEFAULT_SETTINGS.name,
    supportEmail: (gym.supportEmail as string) ?? DEFAULT_SETTINGS.supportEmail,
    supportPhone: (gym.supportPhone as string) ?? DEFAULT_SETTINGS.supportPhone,
    currency: (gym.currency as string) ?? DEFAULT_SETTINGS.currency,
    checkin: { ...DEFAULT_SETTINGS.checkin, ...checkin },
    billing: { ...DEFAULT_SETTINGS.billing, ...billing },
    classes: { ...DEFAULT_SETTINGS.classes, ...classes },
  }
}

export async function updateSettings(
  db: Database,
  section: 'gym' | 'checkin' | 'billing' | 'classes',
  value: Record<string, unknown>,
  actor?: { id?: string | null; email?: string | null },
): Promise<GymSettings> {
  const existing = await db.select().from(appSettings).where(eq(appSettings.key, section)).limit(1)
  const merged = { ...(existing[0]?.value ?? {}), ...value }

  await db
    .insert(appSettings)
    .values({ key: section, value: merged, updatedBy: actor?.id ?? null })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: merged, updatedBy: actor?.id ?? null, updatedAt: sql`now()` },
    })

  await writeAudit(db, {
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: `setting.${section}.update`,
    entity: 'app_setting',
    entityId: section,
    meta: value,
  })

  return getSettings(db)
}

export async function getSettingSections(db: Database) {
  const rows = await db.select().from(appSettings)
  const map = new Map(rows.map((row) => [row.key, row.value]))
  return {
    gym: map.get('gym') ?? {},
    checkin: map.get('checkin') ?? {},
    billing: map.get('billing') ?? {},
    classes: map.get('classes') ?? {},
    updatedAt: rows.reduce<Date | null>((latest, row) => {
      if (!latest || row.updatedAt > latest) return row.updatedAt
      return latest
    }, null),
  }
}
