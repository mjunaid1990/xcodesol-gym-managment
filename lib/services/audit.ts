import type { Database } from '@/lib/db/client'
import { auditLogs } from '@/lib/db/schema'

export interface AuditInput {
  actorId?: string | null
  actorEmail?: string | null
  action: string
  entity: string
  entityId?: string | null
  branchId?: string | null
  meta?: Record<string, unknown>
  ip?: string | null
}

/**
 * Append-only audit trail. Never throws: a failure to record history must not roll
 * back the business operation the user already performed, but it is logged loudly.
 */
export async function writeAudit(db: Database, input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      branchId: input.branchId ?? null,
      meta: input.meta ?? {},
      ip: input.ip ?? null,
    })
  } catch (error) {
    console.error('[audit] failed to write audit log', input.action, error)
  }
}
