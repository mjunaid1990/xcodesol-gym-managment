import { z } from 'zod'
import { created, ok, readJson, readQuery } from '@/lib/api/http'
import {
  addMemberNote,
  bulkMemberAction,
  createMember,
  deleteMemberNote,
  getMember,
  listMembers,
  memberTimeline,
  setMemberStatus,
  updateMember,
} from '@/lib/services/members'
import { bulkMemberSchema, memberCreateSchema, memberFilterSchema, memberUpdateSchema } from '@/lib/api/schemas'
import type { ApiContext } from '@/lib/api/context'

const noteSchema = z.object({ body: z.string().trim().min(2).max(2000), isPinned: z.boolean().optional() })

export function actorOf(ctx: ApiContext) {
  return {
    id: ctx.user?.id ?? null,
    email: ctx.user?.email ?? null,
    ip: ctx.request.headers.get('x-forwarded-for'),
  }
}

export async function handleListMembers(ctx: ApiContext) {
  const filters = readQuery(ctx.request, memberFilterSchema)
  const result = await listMembers(ctx.db, {
    ...filters,
    hasWaiver: filters.hasWaiver === undefined ? undefined : filters.hasWaiver === 'true',
  })
  return { data: result }
}

export async function handleCreateMember(ctx: ApiContext) {
  const body = await readJson(ctx.request, memberCreateSchema)
  const result = await createMember(ctx.db, { ...body, actor: actorOf(ctx) })
  return created({ member: result.member, membership: result.membershipResult?.membership ?? null })
}

export async function handleGetMember(ctx: ApiContext) {
  return { data: await getMember(ctx.db, ctx.params.id!) }
}

export async function handleUpdateMember(ctx: ApiContext) {
  const body = await readJson(ctx.request, memberUpdateSchema)
  return { data: await updateMember(ctx.db, ctx.params.id!, { ...body, actor: actorOf(ctx) }) }
}

export async function handleArchiveMember(ctx: ApiContext) {
  const member = await setMemberStatus(ctx.db, ctx.params.id!, 'INACTIVE', actorOf(ctx))
  return { data: { id: member.id, status: member.status } }
}

export async function handleAddMemberNote(ctx: ApiContext) {
  const body = await readJson(ctx.request, noteSchema)
  const note = await addMemberNote(ctx.db, ctx.params.id!, body.body, {
    authorId: ctx.user?.id ?? null,
    isPinned: body.isPinned,
  })
  return created(note)
}

export async function handleDeleteMemberNote(ctx: ApiContext) {
  await deleteMemberNote(ctx.db, ctx.params.noteId!, actorOf(ctx))
  return ok({ deleted: true })
}

export async function handleBulkMembers(ctx: ApiContext) {
  const body = await readJson(ctx.request, bulkMemberSchema)
  const results = await bulkMemberAction(ctx.db, body.memberIds, body.action, {
    note: body.note,
    credits: body.credits,
    actor: actorOf(ctx),
  })
  return { data: { results, succeeded: results.filter((row) => row.ok).length } }
}

export async function handleMemberTimeline(ctx: ApiContext) {
  return { data: await memberTimeline(ctx.db, ctx.params.id!) }
}
