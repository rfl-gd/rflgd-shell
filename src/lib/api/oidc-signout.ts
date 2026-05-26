import { NextResponse } from 'next/server'
import { OIDC_COOKIE, loadOidcEnv } from '../auth/oidc-config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SIGNED_OUT_PATH = '/admin/login?signed-out=1'

export async function GET(req: Request): Promise<NextResponse> {
  const env = loadOidcEnv()
  const fallbackOrigin = new URL(req.url).origin
  const origin = (env?.baseUrl ?? fallbackOrigin).replace(/\/$/, '')
  const localLanding = `${origin}${SIGNED_OUT_PATH}`

  if (!env) {
    const res = NextResponse.redirect(localLanding)
    res.cookies.delete(OIDC_COOKIE)
    return res
  }

  const baseUrl = env.issuer.replace(/\/oidc\/?$/, '')
  const target = new URL(`${baseUrl}/api/sso/signout`)
  target.searchParams.set('post_logout_redirect_uri', localLanding)

  const res = NextResponse.redirect(target)
  res.cookies.delete(OIDC_COOKIE)
  return res
}

export const POST = GET
