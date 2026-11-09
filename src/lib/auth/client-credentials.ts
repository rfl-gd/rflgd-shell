/**
 * OAuth client_credentials token for a module's own OIDC client — the way a
 * module talks to the base server-to-server (notifications, settings).
 * Cached until shortly before it expires.
 */

export type ClientCredentialsConfig = {
  issuer: string
  clientId: string
  clientSecret: string
  /** Base URL of the platform, derived from the issuer (`…/oidc` stripped). */
  baseUrl: string
}

/** Reads the module's OIDC client from options or the standard env vars; null when incomplete. */
export function resolveClientCredentials(options: {
  issuer?: string
  clientId?: string
  clientSecret?: string
}): ClientCredentialsConfig | null {
  const issuer = (options.issuer ?? process.env.OIDC_ISSUER ?? '').replace(/\/$/, '')
  const clientId = options.clientId ?? process.env.OIDC_CLIENT_ID ?? ''
  const clientSecret = options.clientSecret ?? process.env.OIDC_CLIENT_SECRET ?? ''
  if (!issuer || !clientId || !clientSecret) return null
  return { issuer, clientId, clientSecret, baseUrl: issuer.replace(/\/oidc$/, '') }
}

const EXPIRY_SKEW_MS = 60_000

export class TokenRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'TokenRequestError'
  }
}

export function createClientCredentials(
  config: ClientCredentialsConfig,
  scope: string,
  doFetch: typeof fetch = fetch,
): { token(): Promise<string>; reset(): void } {
  let cached: { token: string; expiresAt: number } | null = null
  return {
    async token() {
      if (cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now()) return cached.token
      const res = await doFetch(`${config.issuer}/token`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${btoa(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`)}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        access_token?: string
        expires_in?: number
        error?: string
      }
      if (!res.ok || !body.access_token) {
        throw new TokenRequestError(`token request failed: ${body.error ?? res.status}`, res.status, body.error ?? 'token')
      }
      cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 600) * 1000 }
      return cached.token
    },
    reset() {
      cached = null
    },
  }
}
