import { INTERVAL_MONTHS, type PlanInterval } from '@/lib/constants'

export interface DiscountLike {
  percentOff?: number | null
  amountOffCents?: number | null
}

/** Discounts never produce a negative invoice. */
export function applyDiscount(subtotalCents: number, discount?: DiscountLike | null): number {
  if (!discount) return 0
  let value = 0
  if (discount.percentOff) value = Math.round((subtotalCents * discount.percentOff) / 100)
  if (discount.amountOffCents) value = Math.max(value, discount.amountOffCents)
  return Math.min(value, subtotalCents)
}

export function invoiceTotals(subtotalCents: number, discountCents: number, taxRatePercent = 0) {
  const taxable = Math.max(0, subtotalCents - discountCents)
  const taxCents = Math.round((taxable * taxRatePercent) / 100)
  return {
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: taxable + taxCents,
  }
}

export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date)
  const day = next.getUTCDate()
  next.setUTCMonth(next.getUTCMonth() + months)
  // Guard against 31 Jan + 1 month rolling into March.
  if (next.getUTCDate() < day) next.setUTCDate(0)
  return next
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 86_400_000))
}

/**
 * Unused-value credit when a member switches plans mid-term:
 * remaining days / total days * what they paid. Rounded to the cent, never negative.
 */
export function prorationCreditCents(
  priceCents: number,
  periodStart: Date,
  periodEnd: Date,
  now = new Date(),
): number {
  const totalDays = daysBetween(periodStart, periodEnd)
  if (totalDays <= 0) return 0
  const remainingDays = daysBetween(now, periodEnd)
  if (remainingDays <= 0) return 0
  return Math.min(priceCents, Math.round((priceCents * remainingDays) / totalDays))
}

export function nextPeriodEnd(from: Date, interval: PlanInterval): Date {
  const months = INTERVAL_MONTHS[interval]
  if (months <= 0) return addDays(from, 1)
  return addMonths(from, months)
}

/** Late-cancel / no-show penalty lines are separate invoices, never edits to the original. */
export function penaltyAmount(configuredCents: number, isLate: boolean): number {
  return isLate ? Math.max(0, configuredCents) : 0
}
