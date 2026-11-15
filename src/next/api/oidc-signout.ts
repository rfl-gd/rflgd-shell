import { NextResponse } from 'next/server'

import { signedOutPath } from '../../core/auth/oidc-config'
import { clearSessionCookieOn, oidcSignout } from '../../core/oidc-signout'
import { oidcContext, toNextResponse } from '../context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function clearSessionCookie(res: NextResponse): void {
  clearSessionCookieOn(res)
}

export async function GET(req: Request): Promise<NextResponse> {
  const ctx = oidcContext()
  if (!ctx) {
    // Without a provider there is no single-logout: land on the local signed-out page.
    const res = NextResponse.redirect(`${new URL(req.url).origin}${signedOutPath()}`)
    clearSessionCookie(res)
    return res
  }
  return toNextResponse(await oidcSignout(req, ctx))
}

export const POST = GET
