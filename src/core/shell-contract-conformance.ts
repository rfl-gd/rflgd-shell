import { describe, expect, it } from 'vitest'

export type ShellContractTarget = {
  /** The host app's request handler: a Web `Request` in, its `Response` out. */
  handle: (req: Request) => Promise<Response>
  /** Origin the requests are addressed to, e.g. `https://app.example.test`. */
  origin: string
}

const isRedirect = (res: Response) => res.status >= 300 && res.status < 400

/**
 * The observable part of the reFlagged Shell Contract (docs/contract.md) for a
 * visitor without a session: `/api/shell-info`, `/api/oidc/signin`,
 * `/api/oidc/signout` and `/api/oidc/backchannel-logout` at their fixed paths. Any network the routes need (the
 * identity provider's discovery document) is the caller's to stub.
 */
export function describeShellContract({ handle, origin }: ShellContractTarget): void {
  const base = origin.replace(/\/$/, '')
  // A same-origin browser navigation, as when the switcher's links are clicked. Apps may refuse
  // cross-site GETs (sign-out CSRF), so the suite never sends one.
  const get = (path: string) =>
    handle(
      new Request(`${base}${path}`, {
        redirect: 'manual',
        headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', referer: `${base}/` },
      }),
    )

  describe('reFlagged Shell Contract', () => {
    it('GET /api/shell-info without a session answers 401 JSON with an error', async () => {
      const res = await get('/api/shell-info')
      expect(res.status).toBe(401)
      expect(res.headers.get('content-type') ?? '').toContain('application/json')
      const body = (await res.json()) as { error?: unknown }
      expect(typeof body.error).toBe('string')
    })

    it('GET /api/oidc/signin redirects into the sign-in flow', async () => {
      const res = await get(`/api/oidc/signin?callbackUrl=${encodeURIComponent('/x')}`)
      expect(isRedirect(res)).toBe(true)
      const location = res.headers.get('location')
      expect(location).toBeTruthy()
      // Not back into itself: the route starts the flow directly.
      expect(new URL(location as string, base).href.startsWith(`${base}/api/oidc/signin`)).toBe(false)
    })

    it('GET /api/oidc/signin with an external callbackUrl neither fails nor redirects there', async () => {
      const external = 'https://elsewhere.invalid/after-login'
      const res = await get(`/api/oidc/signin?callbackUrl=${encodeURIComponent(external)}`)
      expect(res.status).toBeLessThan(500)
      expect(res.headers.get('location') ?? '').not.toMatch(/^https:\/\/elsewhere\.invalid/)
    })

    it('POST /api/oidc/backchannel-logout without a logout token answers 400 without a session', async () => {
      const res = await handle(
        new Request(`${base}/api/oidc/backchannel-logout`, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: '',
        }),
      )
      expect(res.status).toBe(400)
    })

    it('GET /api/oidc/signout redirects', async () => {
      const res = await get('/api/oidc/signout')
      expect(isRedirect(res)).toBe(true)
      expect(res.headers.get('location')).toBeTruthy()
    })
  })
}
