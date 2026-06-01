import { NextResponse } from 'next/server'
import {
  OIDC_COOKIE,
  loadOidcEnv,
  providerOrigin,
  secureCookies,
  signedOutPath,
} from '../auth/oidc-config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function clearSession(res: NextResponse): void {
  // Explicit attributes so the delete actually matches the cookie set at login.
  res.cookies.set(OIDC_COOKIE, '', {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

export async function GET(req: Request): Promise<NextResponse> {
  const env = loadOidcEnv()
  const fallbackOrigin = new URL(req.url).origin
  const origin = (env?.baseUrl ?? fallbackOrigin).replace(/\/$/, '')
  const localLanding = `${origin}${signedOutPath()}`

  if (!env) {
    const res = NextResponse.redirect(localLanding)
    clearSession(res)
    return res
  }

  // Provider single-logout endpoint lives at the issuer origin.
  const target = new URL(`${providerOrigin(env)}/api/sso/signout`)
  target.searchParams.set('post_logout_redirect_uri', localLanding)

  const res = NextResponse.redirect(target)
  clearSession(res)
  return res
}

export const POST = GET
