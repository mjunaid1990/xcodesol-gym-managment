import { z } from 'zod'
import { created, readJson, readQuery } from '@/lib/api/http'
import { checkIn, checkInByQrPass, checkInBySearch, floorStats, listVisits, memberCheckInSummary } from '@/lib/services/attendance'
import { checkInSchema } from '@/lib/api/schemas'
import { signQrPass } from '@/lib/auth/tokens'
import { numberParam } from '@/lib/api/context'
import type { ApiContext } from '@/lib/api/context'
import { actorOf } from './members'

const visitFilterSchema = z.object({
  memberId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  method: z.enum(['QR', 'MANUAL', 'NFC', 'BIOMETRIC', 'CLASS']).optional(),
  sessionId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export async function handleListVisits(ctx: ApiContext) {
  const query = readQuery(ctx.request, visitFilterSchema)
  const result = await listVisits(ctx.db, {
    ...query,
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? new Date(query.to) : undefined,
  })
  return { data: result }
}

export async function handleCheckIn(ctx: ApiContext) {
  const body = await readJson(ctx.request, checkInSchema)
  const actor = actorOf(ctx)
  const branchId = body.branchId ?? ctx.user?.branchId ?? undefined

  if (body.qrToken) {
    const result = await checkInByQrPass(ctx.db, body.qrToken, { branchId, actor })
    return created(result)
  }

  if (body.search) {
    const result = await checkInBySearch(ctx.db, body.search, {
      branchId,
      actor,
      overrideReason: body.overrideReason,
    })
    return created(result)
  }

  if (body.memberId) {
    const result = await checkIn(ctx.db, {
      memberId: body.memberId,
      branchId,
      sessionId: body.sessionId,
      method: body.method ?? 'MANUAL',
      overrideReason: body.overrideReason,
      actor,
    })
    return created(result)
  }

  // A member checking themselves in from the app.
  if (!ctx.user) throw new Error('Provide a QR token, member id, or search term')
  const result = await checkIn(ctx.db, {
    memberId: ctx.user.id,
    branchId,
    method: body.method ?? 'MANUAL',
    actor,
  })
  return created(result)
}

export async function handleFloor(ctx: ApiContext) {
  const branchId = ctx.query.get('branchId') ?? ctx.user?.branchId ?? undefined
  return { data: await floorStats(ctx.db, branchId ?? undefined) }
}

/** Members request a fresh rotating pass; it expires in 90 seconds. */
export async function handleGeneratePass(ctx: ApiContext) {
  const pass = signQrPass(ctx.user!.id)
  return { data: { token: pass.token, expiresAt: pass.expiresAt, memberId: ctx.user!.id } }
}

export async function handleMyCheckInSummary(ctx: ApiContext) {
  return { data: await memberCheckInSummary(ctx.db, ctx.user!.id) }
}

export async function handleCheckInStats(ctx: ApiContext) {
  const rows = await listVisits(ctx.db, {
    branchId: ctx.query.get('branchId') ?? undefined,
    limit: numberParam(ctx.query.get('limit'), 20),
  })
  return { data: rows }
}
