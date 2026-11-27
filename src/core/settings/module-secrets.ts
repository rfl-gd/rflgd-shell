/**
 * Server-only access to the module's `secret` settings (API tokens and other
 * credentials of its integrations) stored encrypted in the base.
 *
 * Fetched from `/api/modules/settings/secrets` with the module's own
 * client_credentials token, so the base answers only with this module's
 * secrets for its own tenant. Values are cached in memory and never logged;
 * errors name the key, never a value.
 *
 * ```ts
 * const secrets = createModuleSecrets<'lexware.api-token'>()
 * const token = await secrets.require('lexware.api-token')
 * ```
 */
import { createClientCredentials, resolveClientCredentials } from '../auth/client-credentials'

export type ModuleSecretErrorCode = 'missing' | 'unavailable' | 'unconfigured' | 'browser'

export class ModuleSecretError extends Error {
  constructor(
    readonly code: ModuleSecretErrorCode,
    readonly key: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'ModuleSecretError'
  }
}

export interface ModuleSecrets<K extends string = string> {
  /**
   * The secret, or `null` when it is not set in the base. Throws
   * `ModuleSecretError` (`unavailable`) when the base never answered, so
   * "base down" is not mistaken for "not configured".
   */
  get(key: K): Promise<string | null>
  /** The secret; throws `ModuleSecretError` (`missing`) when it is not set. */
  require(key: K): Promise<string>
  /** Reloads now (e.g. after the third-party API rejected a token). Never throws. */
  refresh(): Promise<void>
}

type Options = {
  issuer?: string
  clientId?: string
  clientSecret?: string
  fetch?: typeof fetch
  /** Cache window, default 60 s. */
  ttlMs?: number
  /** Per request to the base (token and secrets), default 3 s. */
  requestTimeoutMs?: number
  /** Pause after a failed load before the next attempt, default 10 s. */
  retryAfterMs?: number
}

const SCOPE = 'settings:read'

export function createModuleSecrets<K extends string = string>(
  options: Options = {},
): ModuleSecrets<K> {
  if (typeof window !== 'undefined') {
    throw new ModuleSecretError(
      'browser',
      null,
      'createModuleSecrets is server-only: module secrets must never reach the browser',
    )
  }
  const config = resolveClientCredentials(options)
  const doFetch = options.fetch ?? fetch
  const ttlMs = options.ttlMs ?? 60_000
  const requestTimeoutMs = options.requestTimeoutMs ?? 3_000
  const retryAfterMs = options.retryAfterMs ?? 10_000
  const timedFetch: typeof fetch = (input, init) =>
    doFetch(input, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) })
  const credentials = config ? createClientCredentials(config, SCOPE, timedFetch) : null

  let values: Record<string, string> | null = null
  let loadedAt = 0
  let retryAt = 0
  let inFlight: Promise<void> | null = null

  const request = (token: string) =>
    timedFetch(`${config?.baseUrl}/api/modules/settings/secrets`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

  async function load(): Promise<void> {
    if (!credentials) return
    try {
      let res = await request(await credentials.token())
      if (res.status === 401) {
        credentials.reset()
        res = await request(await credentials.token())
      }
      const body = (await res.json().catch(() => null)) as {
        success?: boolean
        data?: { values?: Record<string, unknown> }
      } | null
      if (!res.ok || !body?.success || !body.data?.values) {
        retryAt = Date.now() + retryAfterMs
        return
      }
      values = Object.fromEntries(
        Object.entries(body.data.values).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
      loadedAt = Date.now()
    } catch {
      // Unreachable base: keep the last good values and back off.
      retryAt = Date.now() + retryAfterMs
    }
  }

  function refresh(): Promise<void> {
    inFlight ??= load().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  const isStale = () => Date.now() - loadedAt >= ttlMs && Date.now() >= retryAt

  async function get(key: K): Promise<string | null> {
    if (!credentials) {
      throw new ModuleSecretError(
        'unconfigured',
        key,
        `module secret "${key}": OIDC_ISSUER, OIDC_CLIENT_ID or OIDC_CLIENT_SECRET is not set`,
      )
    }
    if (isStale()) await refresh()
    if (values === null) {
      throw new ModuleSecretError(
        'unavailable',
        key,
        `module secret "${key}": the platform could not be reached`,
      )
    }
    return values[key] ?? null
  }

  return {
    get,
    async require(key) {
      const value = await get(key)
      if (value === null) {
        throw new ModuleSecretError(
          'missing',
          key,
          `module secret "${key}" is not set — a tenant or platform admin must add it under Einstellungen → Module`,
        )
      }
      return value
    },
    refresh,
  }
}
