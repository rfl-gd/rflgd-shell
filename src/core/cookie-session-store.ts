import { OIDC_COOKIE, OIDC_SESSION_TTL, secureCookies } from '../lib/auth/oidc-config'
import type { OidcEnv } from '../lib/auth/oidc-config'
import { sessionCookieValue, signSessionCookie, verifySessionCookie } from '../lib/auth/oidc-cookie'
import { refreshAccessToken } from '../lib/auth/oidc-refresh'
import { deleteCookie, setCookie } from './http'
import type { ShellSession, ShellSessionStore } from './session-store'

/** Deletes the session cookie on `res` with the attributes it was set with. */
export function clearSessionCookieOn(res: Response): void {
  deleteCookie(res, OIDC_COOKIE, { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/' })
}

/** Keeps the session in the signed `rflgd-session` cookie. */
export function cookieSessionStore(env: OidcEnv): ShellSessionStore {
  return {
    async load(req) {
      const token = sessionCookieValue(req.headers.get('cookie'))
      if (!token) return null
      const verified = await verifySessionCookie(env.authSecret, token)
      if (!verified) return null
      const { iat: _iat, exp: _exp, ...session } = verified
      return session
    },

    async refresh(_req, session) {
      if (!session.refreshToken) return null
      const refreshed = await refreshAccessToken(env, session.refreshToken)
      return refreshed ? { ...session, ...refreshed } : null
    },

    async save(_req, session: ShellSession, res) {
      // Re-sign with every membership/workspace claim preserved; dropping one
      // would silently degrade entitlement gating after each refresh.
      const token = await signSessionCookie(env.authSecret, session)
      setCookie(res, OIDC_COOKIE, token, {
        httpOnly: true,
        secure: secureCookies(),
        sameSite: 'lax',
        path: '/',
        maxAge: OIDC_SESSION_TTL,
      })
      return res
    },

    async end(_req, res) {
      clearSessionCookieOn(res)
      return res
    },
  }
}
