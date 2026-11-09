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

import { createClientCredentials, resolveClientCredentials, TokenRequestError } from '../auth/client-credentials'
import type { Block } from './blocks'

export type { Block } from './blocks'

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
  /**
   * Structured mail content (status, facts, tables, conversations, …). The
   * base renders it in the tenant's branding; `body` stays the short inbox text.
   */
  blocks?: Block[]
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

export function createNotifier(options: NotifierOptions = {}) {
  const config = resolveClientCredentials(options)
  if (!config) {
    throw new Error('createNotifier: OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required')
  }
  const doFetch = options.fetch ?? fetch
  const { baseUrl } = config
  const credentials = createClientCredentials(config, SCOPE, doFetch)

  async function token(): Promise<string> {
    try {
      return await credentials.token()
    } catch (err) {
      if (err instanceof TokenRequestError) throw new NotifyError(err.message, err.status, err.code)
      throw err
    }
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
        credentials.reset()
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
