import { describe, expect, it } from 'vitest'

import { cookieValue, deleteCookie, jsonResponse, parseSetCookie, redirectResponse, setCookie } from './http'

describe('http helpers', () => {
  it('sets a cookie on a redirect response', () => {
    const res = redirectResponse('https://x.test/a')
    setCookie(res, 'c', 'v', { path: '/' })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://x.test/a')
    expect(res.headers.get('set-cookie')).toBe('c=v; Path=/')
  })

  it('encodes the value so JSON survives the round trip', () => {
    const res = jsonResponse({})
    const value = JSON.stringify({ a: 'b;c', d: '"e",f' })
    setCookie(res, 's', value, { path: '/' })
    const raw = cookieValue(`x=1; s=${res.headers.get('set-cookie')!.split(';')[0].slice(2)}`, 's')
    expect(decodeURIComponent(raw!)).toBe(value)
  })

  it('keeps two cookies on one response', () => {
    const res = jsonResponse({ ok: true })
    setCookie(res, 'a', '1', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 })
    deleteCookie(res, 'b', { path: '/' })
    expect(res.headers.getSetCookie()).toEqual([
      'a=1; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=lax',
      'b=; Path=/; Max-Age=0',
    ])
  })

  it('jsonResponse carries status and content type', async () => {
    const res = jsonResponse({ error: 'x' }, 401)
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'x' })
  })

  it('parses its own Set-Cookie back into name, value and attributes', () => {
    const res = jsonResponse({})
    const value = JSON.stringify({ a: 'b;c', d: '"e",f' })
    setCookie(res, 's', value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 })

    expect(parseSetCookie(res.headers.get('set-cookie')!)).toEqual({
      name: 's',
      value,
      attrs: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 },
    })
  })

  it('parses a deletion with Max-Age=0', () => {
    const res = jsonResponse({})
    deleteCookie(res, 'd', { httpOnly: true, sameSite: 'lax', path: '/' })

    expect(parseSetCookie(res.headers.get('set-cookie')!)).toEqual({
      name: 'd',
      value: '',
      attrs: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 },
    })
  })
})
