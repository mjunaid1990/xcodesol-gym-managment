import { eq } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { invoices, memberships, payments, refunds } from '@/lib/db/schema'
import { notFound } from '@/lib/api/http'
import { writeAudit } from './audit'
import { notify } from './notifications'

export type Provider = 'stripe' | 'mock'

export function activeProvider(): Provider {
  return process.env.STRIPE_SECRET_KEY?.trim() ? 'stripe' : 'mock'
}

export interface ChargeInput {
  amountCents: number
  currency: string
  memberId: string
  invoiceId: string
  invoiceNumber: string
  description: string
  idempotencyKey: string
}

export interface ChargeResult {
  provider: Provider
  providerRef: string
  clientSecret: string | null
  status: 'PENDING' | 'SUCCEEDED'
}

/**
 * Creates a payment intent. Card data never touches our servers: the mobile app or web
 * client confirms the intent with Stripe directly, so PCI scope stays at SAQ-A.
 */
export async function createCharge(input: ChargeInput): Promise<ChargeResult> {
  if (activeProvider() === 'mock') {
    // Local/demo mode: succeed immediately so the whole purchase flow is testable offline.
    return {
      provider: 'mock',
      providerRef: `mock_pi_${input.idempotencyKey.slice(0, 24)}`,
      clientSecret: null,
      status: 'SUCCEEDED',
    }
  }

  const { default: Stripe } = await import('stripe')
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

  const intent = await stripe.paymentIntents.create(
    {
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      description: input.description,
      metadata: {
        memberId: input.memberId,
        invoiceId: input.invoiceId,
        invoiceNumber: input.invoiceNumber,
      },
      automatic_payment_methods: { enabled: true },
    },
    { idempotencyKey: input.idempotencyKey },
  )

  return {
    provider: 'stripe',
    providerRef: intent.id,
    clientSecret: intent.client_secret ?? null,
    status: 'PENDING',
  }
}

export async function refundCharge(
  provider: string,
  providerRef: string,
  amountCents: number,
): Promise<{ providerRef: string | null }> {
  if (provider !== 'stripe' || !process.env.STRIPE_SECRET_KEY) return { providerRef: null }

  const { default: Stripe } = await import('stripe')
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const refund = await stripe.refunds.create(
    { payment_intent: providerRef, amount: amountCents },
    { idempotencyKey: `refund_${providerRef}_${amountCents}` },
  )
  return { providerRef: refund.id }
}

export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  try {
    const { default: Stripe } = await import('stripe')
    const stripe = new Stripe('sk_test_placeholder')
    stripe.webhooks.constructEvent(payload, signatureHeader, secret)
    return true
  } catch {
    return false
  }
}

/* -------------------------------------------------------------------------- */
/* Ledger state transitions                                                    */
/* -------------------------------------------------------------------------- */

export async function markPaymentSucceeded(db: Database, paymentId: string): Promise<void> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
  if (!payment) throw notFound('Payment')
  if (payment.status === 'SUCCEEDED' || payment.status === 'PARTIALLY_REFUNDED') return // idempotent

  const paidAt = new Date()
  await db
    .update(payments)
    .set({ status: 'SUCCEEDED', paidAt, failureReason: null, updatedAt: paidAt, attempts: payment.attempts + 1 })
    .where(eq(payments.id, paymentId))

  if (payment.invoiceId) {
    const [invoice] = await db
      .update(invoices)
      .set({ status: 'PAID', amountPaidCents: payment.amountCents, paidAt })
      .where(eq(invoices.id, payment.invoiceId))
      .returning()

    if (invoice?.membershipId) {
      // Payment success is what actually starts the membership.
      await db
        .update(memberships)
        .set({ status: 'ACTIVE', updatedAt: paidAt })
        .where(eq(memberships.id, invoice.membershipId))
    }
  }

  await notify(db, {
    userId: payment.memberId,
    type: 'PAYMENT_SUCCEEDED',
    title: 'Payment received',
    body: `We received your payment of ${(payment.amountCents / 100).toFixed(2)} ${payment.currency}.`,
    channels: ['IN_APP', 'EMAIL'],
    meta: { paymentId },
  })
}

export async function markPaymentFailed(
  db: Database,
  paymentId: string,
  reason = 'card_declined',
): Promise<void> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
  if (!payment) throw notFound('Payment')

  await db
    .update(payments)
    .set({ status: 'FAILED', failureReason: reason, attempts: payment.attempts + 1, updatedAt: new Date() })
    .where(eq(payments.id, paymentId))

  if (payment.invoiceId) {
    await db.update(invoices).set({ status: 'OPEN' }).where(eq(invoices.id, payment.invoiceId))
  }

  await notify(db, {
    userId: payment.memberId,
    type: 'PAYMENT_FAILED',
    title: 'Payment failed',
    body: `Your payment of ${(payment.amountCents / 100).toFixed(2)} ${payment.currency} did not go through (${reason}). Update your card to keep your membership active.`,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    meta: { paymentId, reason },
  })
}

export interface RefundInput {
  paymentId: string
  amountCents?: number
  reason: string
  actorId?: string | null
  actorEmail?: string | null
}

export async function refundPayment(db: Database, input: RefundInput) {
  const [payment] = await db.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1)
  if (!payment) throw notFound('Payment')

  const alreadyRefunded = payment.refundedCents
  const amount = input.amountCents ?? payment.amountCents - alreadyRefunded
  if (amount <= 0) throw notFound('Refundable balance')
  if (alreadyRefunded + amount > payment.amountCents) {
    throw new Error('Refund exceeds the captured amount')
  }

  const providerResult = await refundCharge(payment.provider, payment.providerRef ?? '', amount)
  const totalRefunded = alreadyRefunded + amount
  const fullyRefunded = totalRefunded >= payment.amountCents

  await db.insert(refunds).values({
    paymentId: payment.id,
    amountCents: amount,
    reason: input.reason,
    actorId: input.actorId ?? null,
    providerRef: providerResult.providerRef,
  })

  await db
    .update(payments)
    .set({
      refundedCents: totalRefunded,
      status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      updatedAt: new Date(),
    })
    .where(eq(payments.id, payment.id))

  if (payment.invoiceId) {
    await db
      .update(invoices)
      .set({ status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED' })
      .where(eq(invoices.id, payment.invoiceId))
  }

  await writeAudit(db, {
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    action: 'payment.refund',
    entity: 'payment',
    entityId: payment.id,
    meta: { amountCents: amount, reason: input.reason, fullyRefunded },
  })

  await notify(db, {
    userId: payment.memberId,
    type: 'PAYMENT_SUCCEEDED',
    title: 'Refund processed',
    body: `We refunded ${(amount / 100).toFixed(2)} ${payment.currency} to your original payment method.`,
    channels: ['IN_APP', 'EMAIL'],
    meta: { paymentId: payment.id, amountCents: amount },
  })

  return { refundedCents: totalRefunded, fullyRefunded }
}

/** Retry a failed payment by cloning the intent (new attempt, same invoice). */
export async function retryFailedPayment(db: Database, paymentId: string, actorId?: string | null) {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
  if (!payment) throw notFound('Payment')
  if (payment.status !== 'FAILED') throw new Error('Only failed payments can be retried')

  const [invoice] = payment.invoiceId
    ? await db.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).limit(1)
    : [undefined]

  const attempt = payment.attempts + 1
  const result = await createCharge({
    amountCents: payment.amountCents,
    currency: payment.currency,
    memberId: payment.memberId,
    invoiceId: payment.invoiceId ?? '',
    invoiceNumber: invoice?.number ?? 'retry',
    description: `Retry attempt ${attempt} for invoice ${invoice?.number ?? payment.id}`,
    idempotencyKey: `retry_${payment.id}_${attempt}_${Date.now()}`,
  })

  const [created] = await db
    .insert(payments)
    .values({
      invoiceId: payment.invoiceId,
      memberId: payment.memberId,
      membershipId: payment.membershipId,
      branchId: payment.branchId,
      amountCents: payment.amountCents,
      currency: payment.currency,
      status: result.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'PENDING',
      provider: result.provider,
      providerRef: result.providerRef,
      clientSecret: result.clientSecret,
      method: payment.method,
      attempts: attempt,
      idempotencyKey: `retry_${payment.id}_${attempt}`,
      paidAt: result.status === 'SUCCEEDED' ? new Date() : null,
    })
    .returning()

  if (result.status === 'SUCCEEDED') {
    await markPaymentSucceeded(db, created!.id)
  }

  await writeAudit(db, {
    actorId,
    action: 'payment.retry',
    entity: 'payment',
    entityId: created!.id,
    meta: { originalPaymentId: payment.id, attempt },
  })

  return created!
}


