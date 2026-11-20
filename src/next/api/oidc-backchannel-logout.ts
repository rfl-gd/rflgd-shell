import { NextResponse } from 'next/server.js'

import { loadOidcEnv } from '../../core/auth/oidc-config'
import { backchannelLogout } from '../../core/oidc-backchannel-logout'
import { toNextResponse } from '../context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** OIDC Back-Channel Logout: the platform ends sessions of this module. */
export async function POST(req: Request): Promise<NextResponse> {
  const env = loadOidcEnv()
  if (!env) return NextResponse.json({ error: 'oidc-not-configured' }, { status: 503 })
  return toNextResponse(await backchannelLogout(req, { env }))
}
