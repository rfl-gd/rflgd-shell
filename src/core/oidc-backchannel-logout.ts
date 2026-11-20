import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose'
import * as oauth from 'oauth4webapi'

import type { OidcEnv } from './auth/oidc-config'
import { recordLogout } from './auth/revocations'
import { jsonResponse } from './http'

export type BackchannelLogoutContext = { env: OidcEnv }

/** The event a logout token must carry (OpenID Connect Back-Channel Logout 1.0, §2.4). */
export const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout'

/** How far a logout token's `iat` may be from now, in seconds. */
export const LOGOUT_TOKEN_MAX_SKEW = 300

/** A key set is fetched again for an unknown `kid` at most this often (key rotation). */
const JWKS_REFETCH_MS = 60_000

type Verifier = {
  issuer: string
  jwksUri: string
  keys: ReturnType<typeof createLocalJWKSet>
  fetchedAt: number
}

const VERIFIERS = Symbol.for('rflgd.shell.logout-verifiers')

/** Fetched with `fetch`, like the discovery, rather than jose's own HTTP client. */
async function fetchKeys(jwksUri: string): Promise<ReturnType<typeof createLocalJWKSet>> {
  const res = await fetch(jwksUri, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`jwks answered ${res.status}`)
  return createLocalJWKSet((await res.json()) as JSONWebKeySet)
}

/** The issuer's metadata and key set, discovered once per process and issuer. */
async function verifierFor(issuer: string): Promise<Verifier> {
  const holder = globalThis as { [VERIFIERS]?: Map<string, Promise<Verifier>> }
  const cache = (holder[VERIFIERS] ??= new Map())
  let pending = cache.get(issuer)
  if (!pending) {
    const issuerUrl = new URL(issuer)
    pending = oauth
      .discoveryRequest(issuerUrl, { algorithm: 'oidc' })
      .then((res) => oauth.processDiscoveryResponse(issuerUrl, res))
      .then(async (as) => {
        if (!as.jwks_uri) throw new Error('issuer publishes no jwks_uri')
        return { issuer: as.issuer, jwksUri: as.jwks_uri, keys: await fetchKeys(as.jwks_uri), fetchedAt: Date.now() }
      })
    // A failed discovery is retried by the next logout instead of being cached.
    pending.catch(() => cache.delete(issuer))
    cache.set(issuer, pending)
  }
  return pending
}

async function verifyLogoutToken(token: string, verifier: Verifier, audience: string): Promise<JWTPayload> {
  const options = { issuer: verifier.issuer, audience, clockTolerance: LOGOUT_TOKEN_MAX_SKEW }
  try {
    return (await jwtVerify(token, verifier.keys, options)).payload
  } catch (error) {
    // The platform rotated its keys: fetch them again, once a minute at most.
    if (!(error instanceof errors.JWKSNoMatchingKey) || Date.now() - verifier.fetchedAt < JWKS_REFETCH_MS) {
      throw error
    }
    verifier.keys = await fetchKeys(verifier.jwksUri)
    verifier.fetchedAt = Date.now()
    return (await jwtVerify(token, verifier.keys, options)).payload
  }
}

function invalid(reason: string): Response {
  console.warn(`backchannel-logout refused: ${reason}`)
  return jsonResponse({ error: 'invalid_request' }, 400)
}

/** The checks of §2.6 beyond signature, `iss` and `aud`. Returns the reason a token fails, or null. */
function logoutClaimsProblem(claims: JWTPayload, now: number): string | null {
  if (typeof claims.iat !== 'number') return 'no iat'
  if (Math.abs(now - claims.iat) > LOGOUT_TOKEN_MAX_SKEW) return 'iat out of range'
  const events = claims.events
  if (!events || typeof events !== 'object' || !(BACKCHANNEL_LOGOUT_EVENT in events)) return 'no logout event'
  if ('nonce' in claims) return 'nonce present'
  const hasSid = typeof claims.sid === 'string' && claims.sid.length > 0
  const hasSub = typeof claims.sub === 'string' && claims.sub.length > 0
  if (!hasSid && !hasSub) return 'neither sid nor sub'
  return null
}

/**
 * `POST /api/oidc/backchannel-logout`: the platform names a provider session
 * (`sid`) or a person (`sub`) whose sessions in this module end now. Every
 * later session read refuses them (see `revocations`). Answers 200 with
 * `Cache-Control: no-store`, or 400 for a token that fails validation.
 */
export async function backchannelLogout(req: Request, ctx: BackchannelLogoutContext): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const form = new URLSearchParams(await req.text().catch(() => ''))
  const token = form.get('logout_token')
  if (!token) return invalid('no logout_token')

  let verifier: Verifier
  try {
    verifier = await verifierFor(ctx.env.issuer)
  } catch (error) {
    console.warn('backchannel-logout: issuer discovery failed', error instanceof Error ? error.message : error)
    return jsonResponse({ error: 'temporarily_unavailable' }, 503)
  }

  let claims: JWTPayload
  try {
    claims = await verifyLogoutToken(token, verifier, ctx.env.clientId)
  } catch (error) {
    return invalid(error instanceof Error ? error.message : 'unverifiable token')
  }

  const problem = logoutClaimsProblem(claims, Math.floor(Date.now() / 1000))
  if (problem) return invalid(problem)

  recordLogout({
    sid: typeof claims.sid === 'string' ? claims.sid : null,
    sub: typeof claims.sub === 'string' ? claims.sub : null,
  })
  const res = new Response(null, { status: 200 })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
