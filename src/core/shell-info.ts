import { jsonResponse } from './http'
import type { ShellSession, ShellSessionStore } from './session-store'

/**
 * Renew the access token this many seconds before its declared expiry, so a
 * token about to lapse mid-request is refreshed up front rather than after a
 * guaranteed 401 round-trip.
 */
export const REFRESH_SKEW_SECONDS = 30

export type ShellInfoContext = { platformUrl: string; sessions: ShellSessionStore }

/**
 * Answers the shell's user/app info by asking the platform's `/api/shell/me`
 * with the session's access token, refreshing it through the session store
 * when it is about to expire or the platform rejects it.
 */
export async function shellInfo(req: Request, ctx: ShellInfoContext): Promise<Response> {
  const { platformUrl, sessions } = ctx
  let session = await sessions.load(req)
  if (!session) return jsonResponse({ error: 'no-session' }, 401)
  if (!session.accessToken) return jsonResponse({ error: 'no-access-token' }, 401)

  const callUpstream = (current: ShellSession) =>
    fetch(`${platformUrl}/api/shell/me`, {
      headers: { Authorization: `Bearer ${current.accessToken}` },
      cache: 'no-store',
    })

  let refreshedSession: ShellSession | null = null

  // Proactive refresh: renew an expired (or nearly expired) access token
  // before calling upstream instead of burning a 401 round-trip.
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (
    session.refreshToken &&
    typeof session.accessTokenExpiresAt === 'number' &&
    session.accessTokenExpiresAt - REFRESH_SKEW_SECONDS <= nowSeconds
  ) {
    const refreshed = await sessions.refresh(req, session)
    if (refreshed) {
      session = refreshed
      refreshedSession = refreshed
    }
  }

  let upstream = await callUpstream(session)

  // Reactive backstop: the token was rejected before its declared expiry
  // (revoked, clock skew, rotated elsewhere) — try one refresh and retry.
  if (upstream.status === 401 && session.refreshToken) {
    const refreshed = await sessions.refresh(req, session)
    if (refreshed) {
      session = refreshed
      refreshedSession = refreshed
      upstream = await callUpstream(session)
    }
  }

  // Refused even after a refresh: the platform has ended this session (e.g. an
  // impersonation the admin closed). Drop it so the module signs in afresh
  // instead of carrying on as the customer.
  if (upstream.status === 401) {
    return sessions.end(req, jsonResponse({ error: 'session-ended' }, 401))
  }

  if (!upstream.ok) {
    return jsonResponse({ error: 'upstream-failed', status: upstream.status }, upstream.status)
  }

  const res = jsonResponse(await upstream.json())
  return refreshedSession ? sessions.save(req, refreshedSession, res) : res
}
