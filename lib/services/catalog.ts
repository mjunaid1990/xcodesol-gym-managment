import { asc, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { branches, discounts, plans } from '@/lib/db/schema'

/** Plans with the live member count, used by the pricing screen and the member form. */
export async function listPlansWithCounts(db: Database, includeInactive = true) {
  return db
    .select({
      id: plans.id,
      name: plans.name,
      description: plans.description,
      type: plans.type,
      interval: plans.interval,
      priceCents: plans.priceCents,
      currency: plans.currency,
      classCredits: plans.classCredits,
      freezeDaysPerYear: plans.freezeDaysPerYear,
      autoRenew: plans.autoRenew,
      isActive: plans.isActive,
      branchId: plans.branchId,
      sortOrder: plans.sortOrder,
      activeMembers: sql<number>`(select count(*)::int from memberships m where m.plan_id = plans.id and m.status in ('ACTIVE','FROZEN'))`,
    })
    .from(plans)
    .where(includeInactive ? undefined : eq(plans.isActive, true))
    .orderBy(asc(plans.sortOrder), asc(plans.priceCents))
}

export async function listDiscounts(db: Database) {
  return db.select().from(discounts).orderBy(desc(discounts.createdAt)).limit(100)
}

export async function listBranches(db: Database, activeOnly = true) {
  return db
    .select()
    .from(branches)
    .where(activeOnly ? eq(branches.isActive, true) : undefined)
    .orderBy(asc(branches.name))
}
