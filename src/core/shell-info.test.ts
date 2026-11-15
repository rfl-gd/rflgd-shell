import { afterEach, describe, expect, it, vi } from 'vitest'
import { memorySessionStore } from './memory-session-store'
import type { ShellSession } from './session-store'
import { shellInfo } from './shell-info'

const platformUrl = 'https://platform.example.test'
const req = new Request('https://app.example.test/api/shell-info')
const nowSeconds = () => Math.floor(Date.now() / 1000)

const session: ShellSession = {
  sub: 'u1',
  email: 'ada@example.test',
  accessToken: 'old',
  refreshToken: 'r1',
  accessTokenExpiresAt: nowSeconds() + 3600,
}
const refreshed: ShellSession = { ...session, accessToken: 'new', refreshToken: 'r2' }

function stubUpstream(...statuses: number[]) {
  const fetchMock = vi.fn(async () => {
    const status = statuses.shift() ?? 200
    return new Response(JSON.stringify(status === 200 ? { user: { email: 'a@b' } } : {}), { status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function bearerOf(fetchMock: ReturnType<typeof stubUpstream>, call: number) {
  const init = fetchMock.mock.calls[call] as unknown as [string, RequestInit]
  return (init[1].headers as Record<string, string>).Authorization
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shellInfo', () => {
  it('answers no-session without a session', async () => {
    const sessions = memorySessionStore({ session: null })
    const res = await shellInfo(req, { platformUrl, sessions })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'no-session' })
  })

  it('answers no-access-token when the session has none', async () => {
    const sessions = memorySessionStore({ session: { ...session, accessToken: null } })
    const res = await shellInfo(req, { platformUrl, sessions })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'no-access-token' })
  })

  it('refreshes up front when the access token is about to expire', async () => {
    const fetchMock = stubUpstream(200)
    const sessions = memorySessionStore({
      session: { ...session, accessTokenExpiresAt: nowSeconds() + 10 },
      refreshed,
    })
    const res = await shellInfo(req, { platformUrl, sessions })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]).toEqual([
      `${platformUrl}/api/shell/me`,
      { headers: { Authorization: 'Bearer new' }, cache: 'no-store' },
    ])
    expect(sessions.saved.length).toBe(1)
    expect(sessions.saved[0]).toMatchObject({ accessToken: 'new' })
  })

  it('retries once after an upstream 401', async () => {
    const fetchMock = stubUpstream(401, 200)
    const sessions = memorySessionStore({ session, refreshed })
    const res = await shellInfo(req, { platformUrl, sessions })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bearerOf(fetchMock, 0)).toBe('Bearer old')
    expect(bearerOf(fetchMock, 1)).toBe('Bearer new')
    expect(sessions.saved.length).toBe(1)
  })

  it('ends the module session after the refresh fails too', async () => {
    const fetchMock = stubUpstream(401)
    const sessions = memorySessionStore({ session, refreshed: null })
    const res = await shellInfo(req, { platformUrl, sessions })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'session-ended' })
    expect(sessions.ended).toBe(1)
    expect(sessions.saved.length).toBe(0)
  })

  it('ends the module session when the platform refuses the refreshed token too', async () => {
    const fetchMock = stubUpstream(401, 401)
    const sessions = memorySessionStore({ session, refreshed })
    const res = await shellInfo(req, { platformUrl, sessions })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bearerOf(fetchMock, 1)).toBe('Bearer new')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'session-ended' })
    expect(sessions.ended).toBe(1)
    expect(sessions.saved.length).toBe(0)
  })

  it('calls upstream with the old token and saves nothing when the proactive refresh fails', async () => {
    const fetchMock = stubUpstream(200)
    const sessions = memorySessionStore({
      session: { ...session, accessTokenExpiresAt: nowSeconds() + 10 },
      refreshed: null,
    })
    const res = await shellInfo(req, { platformUrl, sessions })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bearerOf(fetchMock, 0)).toBe('Bearer old')
    expect(sessions.saved.length).toBe(0)
  })

  it('keeps the session on other upstream failures', async () => {
    stubUpstream(503)
    const sessions = memorySessionStore({ session })
    const res = await shellInfo(req, { platformUrl, sessions })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'upstream-failed', status: 503 })
    expect(sessions.ended).toBe(0)
  })

  it('passes the platform body through', async () => {
    stubUpstream(200)
    const sessions = memorySessionStore({ session })
    const res = await shellInfo(req, { platformUrl, sessions })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: { email: 'a@b' } })
    expect(sessions.saved.length).toBe(0)
  })
})
