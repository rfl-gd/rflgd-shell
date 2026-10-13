export type ShellInfoResult = { status: number; body: unknown }

let inFlight: Promise<ShellInfoResult> | null = null

/**
 * Loads the module's /api/shell-info proxy once for every component that asks
 * at the same time. Parallel calls would each refresh an expired access token
 * with the same refresh token, and the provider may revoke the grant when a
 * rotated refresh token comes back. Settled results are not cached, so a later
 * mount still sees fresh data.
 */
export function fetchShellInfo(): Promise<ShellInfoResult> {
  if (inFlight) return inFlight
  const request = (async () => {
    const res = await fetch('/api/shell-info', { credentials: 'include' })
    const body: unknown = await res.json().catch(() => null)
    return { status: res.status, body }
  })()
  inFlight = request
  const clear = () => {
    if (inFlight === request) inFlight = null
  }
  request.then(clear, clear)
  return request
}

export const isOk = (status: number): boolean => status >= 200 && status < 300
