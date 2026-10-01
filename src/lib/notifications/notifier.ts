/**
 * Server-side helper for modules: post notifications to the rflgd-base inbox.
 *
 *   const notifier = createNotifier()           // reads OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET
 *   await notifier.notify({
 *     idempotencyKey: `absence-${id}-approved`,
 *     topic: 'kollega.absence.approved',
 *     category: 'activity',
 *     title: 'Urlaub genehmigt',
 *     actionUrl: `https://kollega.acme.rfl.gd/abwesenheiten/${id}`,
 *     recipients: [{ email: requester.email }],
 *   })
 *
 * The token is fetched with the client_credentials grant (scope
 * `notifications:write`) and cached until shortly before it expires.
 * Modules send data, never HTML; the base renders and brands every mail.
 */

export type NotificationRecipient =
  | { userId: number }
  | { email: string }
  | { role: 'org:admins' | 'org:members' }

export type NotifyInput = {
  idempotencyKey: string
  /** `<module>.<object>.<event>`, lower case. */
  topic: string
  category: 'transactional' | 'activity'
  title: string
  body?: string
  /** https link on the module's or tenant's domain. */
  actionUrl?: string
  actionLabel?: string
  data?: Record<string, unknown>
  recipients: NotificationRecipient[]
}

export type NotifyResult = { ids: number[]; recipients: number; skipped: number }

export class NotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'NotifyError'
  }
}

type NotifierOptions = {
  issuer?: string
  clientId?: string
  clientSecret?: string
  fetch?: typeof fetch
}

const SCOPE = 'notifications:write'
const EXPIRY_SKEW_MS = 60_000

export function createNotifier(options: NotifierOptions = {}) {
  const issuer = (options.issuer ?? process.env.OIDC_ISSUER ?? '').replace(/\/$/, '')
  const clientId = options.clientId ?? process.env.OIDC_CLIENT_ID ?? ''
  const clientSecret = options.clientSecret ?? process.env.OIDC_CLIENT_SECRET ?? ''
  const doFetch = options.fetch ?? fetch
  if (!issuer || !clientId || !clientSecret) {
    throw new Error('createNotifier: OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required')
  }
  const baseUrl = issuer.replace(/\/oidc$/, '')
  let cached: { token: string; expiresAt: number } | null = null

  async function token(): Promise<string> {
    if (cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now()) return cached.token
    const res = await doFetch(`${issuer}/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }),
    })
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string
      expires_in?: number
      error?: string
    }
    if (!res.ok || !body.access_token) {
      throw new NotifyError(`token request failed: ${body.error ?? res.status}`, res.status, body.error ?? 'token')
    }
    cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 600) * 1000 }
    return cached.token
  }

  async function send(input: NotifyInput, accessToken: string): Promise<Response> {
    return doFetch(`${baseUrl}/api/notifications`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  }

  return {
    async notify(input: NotifyInput): Promise<NotifyResult> {
      let res = await send(input, await token())
      if (res.status === 401) {
        cached = null
        res = await send(input, await token())
      }
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean
        data?: NotifyResult
        error?: { code?: string; message?: string }
      }
      if (!res.ok || !body.success || !body.data) {
        throw new NotifyError(body.error?.message ?? `notify failed (${res.status})`, res.status, body.error?.code ?? 'failed')
      }
      return body.data
    },
  }
}
