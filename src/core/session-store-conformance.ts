import { describe, expect, it } from 'vitest'
import { jsonResponse } from './http'
import type { ShellSession, ShellSessionStore } from './session-store'

/** A request that carries the cookie `res` sets, as a browser would send it next. */
function followUpRequest(req: Request, res: Response): Request {
  const setCookieHeader = res.headers.get('set-cookie') ?? ''
  return new Request(req.url, { headers: { cookie: setCookieHeader.split(';')[0] } })
}

/**
 * Behaviour every `ShellSessionStore` must show. `make` returns a store, a
 * request carrying `session`, and that session. Stores exposing `saved` /
 * `ended` (the memory store) are checked through them; others through the
 * cookie their response sets.
 */
export function sessionStoreConformance(
  name: string,
  make: () => { store: ShellSessionStore; req: Request; session: ShellSession },
): void {
  describe(`${name} session store conformance`, () => {
    it('load returns the session', async () => {
      const { store, req, session } = make()
      expect(await store.load(req)).toEqual(session)
    })

    it('refresh of a session without refresh token returns null', async () => {
      const { store, req, session } = make()
      expect(await store.refresh(req, { ...session, refreshToken: null })).toBeNull()
    })

    it('save carries the new access token', async () => {
      const { store, req, session } = make()
      const res = await store.save(req, { ...session, accessToken: 'saved' }, jsonResponse({}))
      expect(res).toBeInstanceOf(Response)
      if ('saved' in store) {
        expect((store.saved as ShellSession[]).at(-1)?.accessToken).toBe('saved')
      } else {
        expect((await store.load(followUpRequest(req, res)))?.accessToken).toBe('saved')
      }
    })

    it('end makes the next load null', async () => {
      const { store, req } = make()
      const res = await store.end(req, jsonResponse({}))
      expect(res).toBeInstanceOf(Response)
      if ('ended' in store) {
        expect(store.ended).toBe(1)
      } else {
        expect(await store.load(followUpRequest(req, res))).toBeNull()
      }
    })
  })
}
