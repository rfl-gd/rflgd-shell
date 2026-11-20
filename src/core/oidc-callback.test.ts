import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OidcEnv } from './auth/oidc-config'
import { loadOidcEnv } from './auth/oidc-config'
import { sessionCookieValue, verifySessionCookie } from './auth/oidc-cookie'
import { cookieSessionStore } from './cookie-session-store'
import { oidcCallback } from './oidc-callback'

/**
 * The provider may answer the authorization request with `error=…` instead
 * of a code. Before this test existed, that was an unhandled throw from
 * validateAuthResponse() — an HTTP 500 that swallowed the provider's own
 * sentence ("Ihr Account hat keinen Zugriff auf diese Service-Instanz").
 */

let env: OidcEnv

beforeEach(() => {
  vi.stubEnv('OIDC_ISSUER', 'https://id.example.test/oidc')
  vi.stubEnv('OIDC_CLIENT_ID', 'client')
  vi.stubEnv('OIDC_CLIENT_SECRET', 'secret')
  vi.stubEnv('AUTH_SECRET', 'x'.repeat(32))
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://app.example.test')
  vi.stubEnv('RFLGD_SERVER_URL', '')
  env = loadOidcEnv() as OidcEnv
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const run = (req: Request): Promise<Response> => oidcCallback(req, { env, sessions: cookieSessionStore(env) })

const callback = (query: string, cookie?: string): Request =>
  new Request(`https://app.example.test/api/oidc/callback?${query}`, {
    headers: cookie ? { cookie } : {},
  })

describe('oidcCallback with a provider error', () => {
  const stateCookie = (state: string) => `rflgd-oidc-state=${encodeURIComponent(JSON.stringify({ state }))}`

  it('answers access_denied with 403 and the provider\'s own sentence when the state matches', async () => {
    const res = await run(
      callback(
        'error=access_denied&error_description=Ihr+Account+hat+keinen+Zugriff+auf+diese+Service-Instanz.&state=abc',
        stateCookie('abc'),
      ),
    )

    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('Ihr Account hat keinen Zugriff auf diese Service-Instanz.')
    expect(body).toContain('access_denied')
  })

  it('needs no state cookie to say no', async () => {
    const res = await run(callback('error=access_denied'))

    expect(res.status).toBe(403)
    expect(await res.text()).toContain('Ihr Account ist dieser Anwendung nicht zugeordnet.')
  })

  it('answers any other provider error with 400', async () => {
    const res = await run(callback('error=server_error'))

    expect(res.status).toBe(400)
    expect(await res.text()).toContain('server_error')
  })

  it('shows unknown_error instead of a code it does not know', async () => {
    const res = await run(callback(`error=${encodeURIComponent('Call +1 555 0100 for support')}`))

    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain('Der Anmeldedienst hat die Anmeldung abgelehnt (unknown_error).')
    expect(body).toContain('Fehlercode: unknown_error')
    expect(body).not.toContain('555')
  })

  it.each([
    ['without a state cookie', 'error=access_denied&state=abc&error_description=Call+555', undefined],
    ['without a state in the URL', 'error=access_denied&error_description=Call+555', stateCookie('abc')],
    ['with a different state', 'error=access_denied&state=xyz&error_description=Call+555', stateCookie('abc')],
  ])('shows the fixed text instead of the description %s', async (_, query, cookie) => {
    const res = await run(callback(query, cookie))

    const body = await res.text()
    expect(body).not.toContain('555')
    expect(body).toContain('Ihr Account ist dieser Anwendung nicht zugeordnet.')
  })

  it('escapes the description', async () => {
    const res = await run(
      callback(
        `error=access_denied&state=abc&error_description=${encodeURIComponent('<script>alert(1)</script>')}`,
        stateCookie('abc'),
      ),
    )

    const body = await res.text()
    expect(body).not.toContain('<script>')
    expect(body).toContain('&#60;script&#62;')
  })

  it('clears the state cookie so the next attempt starts clean', async () => {
    const res = await run(callback('error=access_denied', 'rflgd-oidc-state=%7B%7D'))

    expect(res.headers.get('set-cookie')).toMatch(/rflgd-oidc-state=;/)
  })
})

/**
 * The provider issued a code and then refused to exchange it. Seen live after
 * an "Einloggen als" session ended: the browser's provider session still
 * belonged to the impersonated account, every code was minted for it, and the
 * exchange refused each one — an unhandled throw, so a bare HTTP 500, again
 * on every reload.
 */
describe('oidcCallback when the token exchange is refused', () => {
  const discovery = {
    issuer: 'https://id.example.test/oidc',
    authorization_endpoint: 'https://id.example.test/oidc/auth',
    token_endpoint: 'https://id.example.test/oidc/token',
    jwks_uri: 'https://id.example.test/oidc/jwks',
  }
  const state = 'state-123'
  const cookie = `rflgd-oidc-state=${encodeURIComponent(
    JSON.stringify({ codeVerifier: 'v'.repeat(43), state, nonce: 'n', callback: '/chat' }),
  )}`

  const refusing = (error: string) =>
    vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input instanceof Request ? input.url : input)
      if (href.includes('.well-known')) return Response.json(discovery)
      return Response.json(
        { error, error_description: 'grant request is invalid' },
        { status: 400 },
      )
    })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('answers invalid_grant with a page that signs out at the platform, not a 500', async () => {
    vi.stubGlobal('fetch', refusing('invalid_grant'))

    const res = await run(callback(`code=abc&state=${state}`, cookie))

    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain('Anmeldung abgelaufen')
    // A plain retry lands in the same dead provider session; signing out ends it.
    expect(body).toContain('href="/api/oidc/signout"')
    expect(body).toContain('invalid_grant')
    expect(res.headers.get('set-cookie') ?? '').toContain('rflgd-oidc-state=;')
  })

  it('answers any other refused exchange with the readable error page', async () => {
    vi.stubGlobal('fetch', refusing('invalid_client'))

    const res = await run(callback(`code=abc&state=${state}`, cookie))

    expect(res.status).toBe(400)
    expect(await res.text()).toContain('invalid_client')
  })
})

/** A provider that exchanges any code for an ID token carrying `claims`. */
describe('oidcCallback on success', () => {
  const discovery = {
    issuer: 'https://id.example.test/oidc',
    authorization_endpoint: 'https://id.example.test/oidc/auth',
    token_endpoint: 'https://id.example.test/oidc/token',
    jwks_uri: 'https://id.example.test/oidc/jwks',
  }
  const state = 'state-123'
  const nonce = 'nonce-123'
  const stateCookie = (callbackPath: unknown) =>
    `rflgd-oidc-state=${encodeURIComponent(
      JSON.stringify({ codeVerifier: 'v'.repeat(43), state, nonce, callback: callbackPath }),
    )}`

  const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const idToken = (claims: Record<string, unknown>) => {
    const now = Math.floor(Date.now() / 1000)
    const payload = { iss: discovery.issuer, aud: 'client', iat: now, exp: now + 300, nonce, ...claims }
    // The token endpoint is reached over TLS, so the ID token's signature is not checked.
    return `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url(payload)}.c2lnbmF0dXJl`
  }

  const exchanging = (claims: Record<string, unknown>) =>
    vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input instanceof Request ? input.url : input)
      if (href.includes('.well-known')) return Response.json(discovery)
      return Response.json({
        access_token: 'at',
        refresh_token: 'rt',
        token_type: 'bearer',
        expires_in: 300,
        id_token: idToken(claims),
      })
    })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['an absolute URL', 'https://evil.example.test/'],
    ['a protocol-relative URL', '//evil.example.test'],
    ['a non-string value', 42],
  ])('redirects to /admin when the state cookie was changed to %s', async (_, callbackPath) => {
    vi.stubGlobal('fetch', exchanging({ sub: 'u1', email: 'ada@example.test' }))

    const res = await run(callback(`code=abc&state=${state}`, stateCookie(callbackPath)))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://app.example.test/admin')
  })
  it('saves the mapped claims, clears the state cookie and redirects to the callback path', async () => {
    vi.stubGlobal(
      'fetch',
      exchanging({
        sub: 'u1',
        email: 'ada@example.test',
        name: 'Ada',
        email_verified: true,
        tenant_id: 't1',
        tenant_slug: 'acme',
        org_slug: 'acme-org',
        org_role: 'owner',
        platform_role: 'admin',
        accessible_services: ['chat', 42, 'crm'],
      }),
    )

    const res = await run(callback(`code=abc&state=${state}`, stateCookie('/chat?tab=files#top')))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://app.example.test/chat?tab=files#top')
    const cookies = res.headers.getSetCookie()
    expect(cookies.some((c) => c.startsWith('rflgd-oidc-state=;'))).toBe(true)
    const token = sessionCookieValue(cookies.map((c) => c.split(';')[0]).join('; '))
    const saved = await verifySessionCookie(env.authSecret, token ?? '')
    expect(saved).toMatchObject({
      sub: 'u1',
      email: 'ada@example.test',
      name: 'Ada',
      accessToken: 'at',
      refreshToken: 'rt',
      emailVerified: true,
      tenantId: 't1',
      tenantSlug: 'acme',
      orgSlug: 'acme-org',
      orgRole: 'owner',
      platformRole: 'admin',
      accessibleServices: ['chat', 'crm'],
    })
  })

  it("keeps the ID token's sid and its iat (the platform's clock) as the sign-in time", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 7
    vi.stubGlobal(
      'fetch',
      exchanging({ sub: 'u1', email: 'ada@example.test', sid: 'provider-sid', iat: issuedAt }),
    )

    const res = await run(callback(`code=abc&state=${state}`, stateCookie('/')))

    const token = sessionCookieValue(res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '))
    const saved = await verifySessionCookie(env.authSecret, token ?? '')
    expect(saved?.sid).toBe('provider-sid')
    expect(saved?.signedInAt).toBe(issuedAt * 1000)
    expect(saved?.accessTokenExpiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })
})
