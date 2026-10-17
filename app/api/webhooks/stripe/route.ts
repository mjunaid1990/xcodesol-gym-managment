import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { payments } from '@/lib/db/schema'
import { markPaymentFailed, markPaymentSucceeded, verifyStripeSignature } from '@/lib/services/payments'
import { writeAudit } from '@/lib/services/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Stripe drives payment state; our database follows. Every event is idempotent, so
 * a retried delivery cannot double-credit an invoice.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const signature = request.headers.get('stripe-signature')
  const payload = await request.text()

  if (!secret || !signature) {
    return NextResponse.json(
      { error: { code: 'not_configured', message: 'Stripe webhooks are not configured' } },
      { status: 501 },
    )
  }

  const valid = await verifyStripeSignature(payload, signature, secret)
  if (!valid) {
    return NextResponse.json({ error: { code: 'invalid_signature', message: 'Signature failed' } }, { status: 400 })
  }

  const event = JSON.parse(payload) as {
    id: string
    type: string
    data: { object: Record<string, unknown> }
  }

  const db = await getDb()
  const object = event.data.object ?? {}

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const providerRef = String(object.id)
        const [payment] = await db.select().from(payments).where(eq(payments.providerRef, providerRef)).limit(1)
        if (payment) {
          await markPaymentSucceeded(db, payment.id)
        } else {
          // Late-arriving intent: resolve through metadata.
          const invoiceId = (object.metadata as Record<string, string> | undefined)?.invoiceId
          if (invoiceId) {
            const [byInvoice] = await db.select().from(payments).where(eq(payments.invoiceId, invoiceId)).limit(1)
            if (byInvoice) {
              await db.update(payments).set({ providerRef }).where(eq(payments.id, byInvoice.id))
              await markPaymentSucceeded(db, byInvoice.id)
            }
          }
        }
        break
      }
      case 'payment_intent.payment_failed': {
        const providerRef = String(object.id)
        const [payment] = await db.select().from(payments).where(eq(payments.providerRef, providerRef)).limit(1)
        if (payment) {
          const reason =
            (object.last_payment_error as { code?: string } | undefined)?.code ??
            (object.last_payment_error as { message?: string } | undefined)?.message ??
            'card_declined'
          await markPaymentFailed(db, payment.id, reason)
        }
        break
      }
      case 'charge.refunded':
      case 'refund.updated':
      default:
        // Refunds initiated in-app are already recorded; other events are acknowledged
        // so Stripe stops retrying.
        break
    }

    await writeAudit(db, {
      action: `stripe.${event.type}`,
      entity: 'payment',
      entityId: String(object.id ?? ''),
      meta: { eventId: event.id },
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[stripe] webhook handling failed', error)
    // 500 tells Stripe to retry; the transition guards make a retry safe.
    return NextResponse.json({ error: { code: 'handler_failed', message: 'Retry' } }, { status: 500 })
  }
}
