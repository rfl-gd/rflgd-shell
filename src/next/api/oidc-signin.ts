import { NextResponse } from 'next/server'

import { oidcSignin } from '../../core/oidc-signin'
import { oidcContext, toNextResponse } from '../context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<NextResponse> {
  const ctx = oidcContext()
  if (!ctx) return NextResponse.json({ error: 'oidc-not-configured' }, { status: 500 })
  return toNextResponse(await oidcSignin(req, ctx))
}
