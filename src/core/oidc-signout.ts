import { providerOrigin, signedOutPath } from '../lib/auth/oidc-config'
import { redirectResponse } from './http'
import type { OidcContext } from './oidc-signin'

export { clearSessionCookieOn } from './cookie-session-store'

/** Ends the session and redirects through the provider's single-logout to the signed-out landing. */
export async function oidcSignout(req: Request, ctx: OidcContext): Promise<Response> {
  const { env, sessions } = ctx
  const origin = (env.baseUrl || new URL(req.url).origin).replace(/\/$/, '')
  const localLanding = `${origin}${signedOutPath()}`

  // Provider single-logout endpoint lives at the issuer origin.
  const target = new URL(`${providerOrigin(env)}/api/sso/signout`)
  target.searchParams.set('post_logout_redirect_uri', localLanding)

  return sessions.end(req, redirectResponse(target))
}
