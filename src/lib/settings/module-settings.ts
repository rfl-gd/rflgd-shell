/**
 * Server-side access to the module's per-tenant settings stored in the base.
 *
 * The module's OIDC client belongs to exactly one booking, so the base knows
 * tenant and module from the client_credentials token alone. All values are
 * fetched in one request and cached; reads never throw and never block start-up
 * — the caller's fallback (normally the manifest default) applies until the
 * base has answered once, and the last good values survive outages.
 *
 * ```ts
 * const settings = createModuleSettings()
 * if (!(await settings.get('documents.enabled', true))) return forbidden()
 * ```
 */
import { createClientCredentials, resolveClientCredentials } from '../auth/client-credentials'

export type SettingValue = boolean | number | string

export interface ModuleSettings {
  /** Current value, refreshed when the cache is older than `ttlMs`. */
  get<T extends SettingValue>(key: string, fallback: T): Promise<T>
  /** Last known value without waiting; starts a background refresh when stale. */
  peek<T extends SettingValue>(key: string, fallback: T): T
  /** Reloads all values now. Never throws. */
  refresh(): Promise<void>
}

type Options = {
  issuer?: string
  clientId?: string
  clientSecret?: string
  fetch?: typeof fetch
  /** Cache window, default 60 s. */
  ttlMs?: number
}

const SCOPE = 'settings:read'

export function createModuleSettings(options: Options = {}): ModuleSettings {
  const config = resolveClientCredentials(options)
  const doFetch = options.fetch ?? fetch
  const ttlMs = options.ttlMs ?? 60_000
  const credentials = config ? createClientCredentials(config, SCOPE, doFetch) : null

  let values: Record<string, unknown> = {}
  let etag: string | null = null
  let loadedAt = 0
  let inFlight: Promise<void> | null = null

  async function request(token: string): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` }
    if (etag) headers['if-none-match'] = etag
    return doFetch(`${config?.baseUrl}/api/modules/settings`, { headers, cache: 'no-store' })
  }

  async function load(): Promise<void> {
    if (!credentials) return
    try {
      let res = await request(await credentials.token())
      if (res.status === 401) {
        credentials.reset()
        res = await request(await credentials.token())
      }
      if (res.status === 304) {
        loadedAt = Date.now()
        return
      }
      const body = (await res.json().catch(() => null)) as {
        success?: boolean
        data?: { values?: Record<string, unknown> }
      } | null
      if (!res.ok || !body?.success || !body.data?.values) return
      values = body.data.values
      etag = res.headers.get('etag')
      loadedAt = Date.now()
    } catch {
      // Unreachable base: keep the last good values (or the fallbacks).
    }
  }

  function refresh(): Promise<void> {
    inFlight ??= load().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  const isStale = () => Date.now() - loadedAt >= ttlMs

  function pick<T extends SettingValue>(key: string, fallback: T): T {
    const value = values[key]
    return typeof value === typeof fallback ? (value as T) : fallback
  }

  return {
    async get(key, fallback) {
      if (isStale()) await refresh()
      return pick(key, fallback)
    },
    peek(key, fallback) {
      if (isStale()) void refresh()
      return pick(key, fallback)
    },
    refresh,
  }
}
