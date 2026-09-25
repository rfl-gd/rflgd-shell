import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from './oidc-callback'

/**
 * The provider may answer the authorization request with `error=…` instead
 * of a code. Before this test existed, that was an unhandled throw from
 * validateAuthResponse() — an HTTP 500 that swallowed the provider's own
 * sentence ("Ihr Account hat keinen Zugriff auf diese Service-Instanz").
 */

beforeEach(() => {
  vi.stubEnv('OIDC_ISSUER', 'https://id.example.test/oidc')
  vi.stubEnv('OIDC_CLIENT_ID', 'client')
  vi.stubEnv('OIDC_CLIENT_SECRET', 'secret')
  vi.stubEnv('AUTH_SECRET', 'x'.repeat(32))
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://app.example.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const callback = (query: string, cookie?: string): Request =>
  new Request(`https://app.example.test/api/oidc/callback?${query}`, {
    headers: cookie ? { cookie } : {},
  })

describe('GET /api/oidc/callback with a provider error', () => {
  it('answers access_denied with 403 and the provider\'s own sentence', async () => {
    const res = await GET(
      callback(
        'error=access_denied&error_description=Ihr+Account+hat+keinen+Zugriff+auf+diese+Service-Instanz.&state=abc',
        'rflgd-oidc-state=%7B%7D',
      ),
    )

    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('Ihr Account hat keinen Zugriff auf diese Service-Instanz.')
    expect(body).toContain('access_denied')
  })

  it('needs no state cookie to say no', async () => {
    const res = await GET(callback('error=access_denied'))

    expect(res.status).toBe(403)
    expect(await res.text()).toContain('Ihr Account ist dieser Anwendung nicht zugeordnet.')
  })

  it('answers any other provider error with 400', async () => {
    const res = await GET(callback('error=server_error'))

    expect(res.status).toBe(400)
    expect(await res.text()).toContain('server_error')
  })

  it('escapes the description — the URL is anyone\'s to craft', async () => {
    const res = await GET(
      callback(`error=access_denied&error_description=${encodeURIComponent('<script>alert(1)</script>')}`),
    )

    const body = await res.text()
    expect(body).not.toContain('<script>')
    expect(body).toContain('&#60;script&#62;')
  })

  it('clears the state cookie so the next attempt starts clean', async () => {
    const res = await GET(callback('error=access_denied', 'rflgd-oidc-state=%7B%7D'))

    expect(res.headers.get('set-cookie')).toMatch(/rflgd-oidc-state=;/)
  })
})
