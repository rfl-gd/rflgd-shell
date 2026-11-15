import { NextResponse } from 'next/server.js'

import { deniedPage } from '../../core/denied-page'
import { oidcCallback } from '../../core/oidc-callback'
import { oidcContext, toNextResponse } from '../context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<NextResponse> {
  const ctx = oidcContext()
  if (!ctx) return NextResponse.json({ error: 'oidc-not-configured' }, { status: 500 })
  return toNextResponse(await oidcCallback(req, ctx))
}

/** A readable page for a sign-in the provider refused (403 for access_denied, 400 otherwise). */
export function deniedResponse(error: string, description: string | null): NextResponse {
  return toNextResponse(deniedPage(error, description))
}
