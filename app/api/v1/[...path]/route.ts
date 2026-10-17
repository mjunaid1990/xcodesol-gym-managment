import { handleApiRequest } from '@/lib/api/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ path?: string[] }> }

async function dispatch(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params
  return handleApiRequest(request, path ?? [])
}

export const GET = dispatch
export const POST = dispatch
export const PATCH = dispatch
export const PUT = dispatch
export const DELETE = dispatch

export async function OPTIONS(request: Request, context: RouteContext) {
  return dispatch(request, context)
}
