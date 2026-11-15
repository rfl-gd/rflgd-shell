import { describe, expect, it } from 'vitest'

import { deleteCookie, jsonResponse, setCookie } from '../core/http'
import { toNextResponse } from './context'

describe('toNextResponse', () => {
  it('carries every core cookie into the Next cookie view, deletions included', () => {
    const core = jsonResponse({ ok: true })
    setCookie(core, 'state', '{"a":"b;c"}', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 })
    deleteCookie(core, 'session', { httpOnly: true, sameSite: 'lax', path: '/' })

    const res = toNextResponse(core)

    expect(res.cookies.get('state')).toMatchObject({ value: '{"a":"b;c"}', maxAge: 600, path: '/' })
    expect(res.cookies.get('session')).toMatchObject({ value: '', maxAge: 0, path: '/' })

    res.cookies.set('other', 'v')
    const headers = res.headers.getSetCookie()
    expect(headers).toContainEqual(expect.stringMatching(/^state=.*Max-Age=600/))
    expect(headers).toContainEqual(expect.stringMatching(/^session=;.*Max-Age=0/))
    expect(headers).toContainEqual(expect.stringMatching(/^other=v/))
  })

  it('keeps status, body and other headers', async () => {
    const res = toNextResponse(jsonResponse({ ok: true }, 418))

    expect(res.status).toBe(418)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.json()).toEqual({ ok: true })
  })
})
