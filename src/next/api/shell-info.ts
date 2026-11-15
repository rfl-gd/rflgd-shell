import { NextResponse } from 'next/server'

import { shellInfo } from '../../core/shell-info'
import { shellInfoContext, toNextResponse } from '../context'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<NextResponse> {
  const ctx = shellInfoContext()
  if (!ctx) return NextResponse.json({ error: 'oidc-not-configured' }, { status: 503 })
  return toNextResponse(await shellInfo(req, ctx))
}
