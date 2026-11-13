/**
 * Server-side access to a user's groups, module roles and module access as
 * the base sees them.
 *
 * Built like the settings client: the module's own client_credentials token
 * (scope `directory:read`) tells the base tenant and module, every call has a
 * deadline, failures back off, answers are revalidated by ETag. Reads never
 * throw. When the base cannot answer, the result is "unknown":
 * `{ access: true, groups: [], roles: [] }` — the module then only allows what
 * needs no role and no group, and the session is not ended.
 *
 * ```ts
 * const me = await getUserAccess(session.sub)
 * if (!hasRole(me, 'editor')) return forbidden()
 * ```
 */
import { createClientCredentials, resolveClientCredentials } from '../auth/client-credentials'

export type UserAccess = {
  access: boolean
  groups: Array<{ id: number; name: string; externalId: string | null }>
  roles: string[]
}

export type DirectoryGroup = {
  id: number
  name: string
  source: 'manual' | 'entra'
  state: 'active' | 'removed'
  externalId: string | null
  memberCount: number
}

export interface DirectoryClient {
  /** Access, groups and roles of one user; the unknown fallback when the base cannot say. Never throws. */
  getUserAccess(sub: string): Promise<UserAccess>
  /** All groups of the tenant, `removed` ones included; `[]` when unknown. Never throws. */
  listGroups(): Promise<DirectoryGroup[]>
  /**
   * True only when the base definitively said the user lost access (a 200
   * with `access: false`, or a 404). Answers from the cache without waiting
   * and refreshes a missing or stale entry in the background.
   */
  isAccessRevoked(sub: string): boolean
}

type Options = {
  issuer?: string
  clientId?: string
  clientSecret?: string
  fetch?: typeof fetch
  /** How long an answer counts as fresh, default 5 min. */
  ttlMs?: number
  /** How long the last good answer is served while the base cannot answer, default 60 min. */
  maxStaleMs?: number
  /** Per request to the base (token and directory), default 3 s. */
  requestTimeoutMs?: number
  /** Pause after a failed load before the next attempt, default 10 s. */
  retryAfterMs?: number
  /** How long a `403 forbidden` (module does not take part) is remembered, default 60 min. */
  forbiddenTtlMs?: number
  /** Users kept in the cache, default 1 000; the oldest entry is dropped. */
  maxEntries?: number
}

type Entry<T> = { value: T; etag: string | null; fetchedAt: number }

/** What a load learned; `null` means the base gave no usable answer. */
type Outcome<T> = { kind: 'value'; value: T; etag: string | null } | { kind: 'not-modified' } | { kind: 'forbidden' } | null

const SCOPE = 'directory:read'
const MINUTE = 60_000

const unknownAccess = (): UserAccess => ({ access: true, groups: [], roles: [] })
const noAccess = (): UserAccess => ({ access: false, groups: [], roles: [] })

function isUserAccess(data: unknown): data is UserAccess {
  const d = data as UserAccess | null
  return (
    typeof d?.access === 'boolean' &&
    Array.isArray(d.roles) &&
    d.roles.every((r) => typeof r === 'string') &&
    Array.isArray(d.groups) &&
    d.groups.every((g) => typeof g?.id === 'number' && typeof g.name === 'string')
  )
}

function isGroupList(data: unknown): data is DirectoryGroup[] {
  return Array.isArray(data) && data.every((g) => typeof g?.id === 'number' && typeof g.name === 'string')
}

export function createDirectoryClient(options: Options = {}): DirectoryClient {
  const config = resolveClientCredentials(options)
  // Resolved per call so a fetch replaced after start-up (tests, instrumentation) is used.
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? fetch)(input, init)
  const ttlMs = options.ttlMs ?? 5 * MINUTE
  const maxStaleMs = options.maxStaleMs ?? 60 * MINUTE
  const requestTimeoutMs = options.requestTimeoutMs ?? 3_000
  const retryAfterMs = options.retryAfterMs ?? 10_000
  const forbiddenTtlMs = options.forbiddenTtlMs ?? 60 * MINUTE
  const maxEntries = options.maxEntries ?? 1_000
  const timedFetch: typeof fetch = (input, init) =>
    doFetch(input, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) })
  const credentials = config ? createClientCredentials(config, SCOPE, timedFetch) : null

  const users = new Map<string, Entry<UserAccess>>()
  const userLoads = new Map<string, Promise<void>>()
  let groups: Entry<DirectoryGroup[]> | null = null
  let groupsLoad: Promise<void> | null = null
  /** No new attempt before this time after a failure — the base is shared, so is the pause. */
  let retryAt = 0
  /** The module declares neither roles nor `directoryAccess`; no requests before this time. */
  let forbiddenUntil = 0

  const isFresh = (entry: Entry<unknown> | null | undefined) => !!entry && Date.now() - entry.fetchedAt < ttlMs
  const isUsable = (entry: Entry<unknown> | null | undefined) =>
    !!entry && Date.now() - entry.fetchedAt < maxStaleMs
  const mayAsk = () => !!credentials && Date.now() >= retryAt && Date.now() >= forbiddenUntil

  async function request(path: string, etag: string | null): Promise<Response> {
    const send = async () => {
      const headers: Record<string, string> = { authorization: `Bearer ${await credentials!.token()}` }
      if (etag) headers['if-none-match'] = etag
      return timedFetch(`${config!.baseUrl}${path}`, { headers, cache: 'no-store' })
    }
    let res = await send()
    if (res.status === 401) {
      credentials!.reset()
      res = await send()
    }
    return res
  }

  async function fetchOutcome<T>(
    path: string,
    etag: string | null,
    read: (data: unknown) => T | null,
    onNotFound?: () => T,
  ): Promise<Outcome<T>> {
    try {
      const res = await request(path, etag)
      if (res.status === 304) return { kind: 'not-modified' }
      const body = (await res.json().catch(() => null)) as {
        success?: boolean
        data?: unknown
        error?: { code?: string }
      } | null
      if (res.status === 403 && body?.error?.code === 'forbidden') return { kind: 'forbidden' }
      if (res.status === 404 && body?.error?.code === 'not-found' && onNotFound) {
        return { kind: 'value', value: onNotFound(), etag: null }
      }
      const value = res.ok && body?.success ? read(body.data) : null
      return value ? { kind: 'value', value, etag: res.headers.get('etag') } : null
    } catch {
      // Unreachable or hanging base, or no token: handled like any failure below.
      return null
    }
  }

  /** Applies an outcome to a cache slot; returns the slot's new content. */
  function settle<T>(entry: Entry<T> | null | undefined, outcome: Outcome<T>): Entry<T> | null | undefined {
    if (outcome?.kind === 'forbidden') {
      forbiddenUntil = Date.now() + forbiddenTtlMs
      return entry
    }
    if (outcome?.kind === 'not-modified') return entry ? { ...entry, fetchedAt: Date.now() } : entry
    if (outcome?.kind === 'value') return { value: outcome.value, etag: outcome.etag, fetchedAt: Date.now() }
    retryAt = Date.now() + retryAfterMs
    return entry
  }

  function refreshUser(sub: string): Promise<void> {
    const running = userLoads.get(sub)
    if (running) return running
    const load = (async () => {
      const outcome = await fetchOutcome(
        `/api/modules/directory/users/${encodeURIComponent(sub)}`,
        users.get(sub)?.etag ?? null,
        (data) => (isUserAccess(data) ? data : null),
        noAccess,
      )
      const next = settle(users.get(sub), outcome)
      if (next) {
        // Re-insert so the map's order is the order of the last answer: the first key is the oldest.
        users.delete(sub)
        users.set(sub, next)
        while (users.size > maxEntries) users.delete(users.keys().next().value as string)
      }
    })().finally(() => userLoads.delete(sub))
    userLoads.set(sub, load)
    return load
  }

  function refreshGroups(): Promise<void> {
    groupsLoad ??= (async () => {
      const outcome = await fetchOutcome(
        '/api/modules/directory/groups',
        groups?.etag ?? null,
        (data) => {
          const list = (data as { groups?: unknown } | null)?.groups
          return isGroupList(list) ? list : null
        },
      )
      groups = settle(groups, outcome) ?? null
    })().finally(() => {
      groupsLoad = null
    })
    return groupsLoad
  }

  return {
    async getUserAccess(sub) {
      if (!isFresh(users.get(sub)) && mayAsk()) await refreshUser(sub)
      if (Date.now() < forbiddenUntil) return unknownAccess()
      const entry = users.get(sub)
      return isUsable(entry) ? entry!.value : unknownAccess()
    },
    async listGroups() {
      if (!isFresh(groups) && mayAsk()) await refreshGroups()
      if (Date.now() < forbiddenUntil) return []
      return isUsable(groups) ? groups!.value : []
    },
    isAccessRevoked(sub) {
      const entry = users.get(sub)
      if (!isFresh(entry) && mayAsk()) void refreshUser(sub)
      if (Date.now() < forbiddenUntil) return false
      return isUsable(entry) && entry!.value.access === false
    },
  }
}

// One client per process, shared by every bundle that imports this file (route
// handlers, server components, the Payload auth strategy) so the session check
// and the module's own reads use the same cache. Created on first use so the
// OIDC env vars are read at runtime, not at import.
const CLIENT_KEY = Symbol.for('@reflagged/shell/directory')

function defaultClient(): DirectoryClient {
  const store = globalThis as typeof globalThis & { [CLIENT_KEY]?: DirectoryClient }
  return (store[CLIENT_KEY] ??= createDirectoryClient())
}

export function getUserAccess(sub: string): Promise<UserAccess> {
  return defaultClient().getUserAccess(sub)
}

export function listGroups(): Promise<DirectoryGroup[]> {
  return defaultClient().listGroups()
}

/**
 * Whether the shell should end this user's module session: the base said the
 * user lost access, and enforcement is not switched off with
 * `RFLGD_DIRECTORY_ENFORCE=false`. Never waits for the base.
 */
export function isSessionAccessRevoked(sub: string): boolean {
  if (process.env.RFLGD_DIRECTORY_ENFORCE === 'false') return false
  return defaultClient().isAccessRevoked(sub)
}

export function hasRole(a: UserAccess, role: string): boolean {
  return a.access && a.roles.includes(role)
}

export function inGroup(a: UserAccess, groupId: number): boolean {
  return a.access && a.groups.some((g) => g.id === groupId)
}
