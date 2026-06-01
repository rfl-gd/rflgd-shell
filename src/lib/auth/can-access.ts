import type { OidcSessionToken } from './oidc-config'

/**
 * Feature-gating helper for the `accessible_services` claim.
 *
 * Semantics (from the provider contract):
 *   - `['*']`  → the user may access ALL services (platform/org admins).
 *   - `[]`     → the user may access NO services.
 *   - `[...]`  → the user may access exactly the listed product keys.
 *   - `null`/absent → claim was not requested (no `rflgd:memberships` scope)
 *                     OR a session minted before this field existed. We return
 *                     `false` (fail-closed) so callers must opt into gating
 *                     only once the claim is reliably present.
 */
export function hasService(
  accessibleServices: string[] | null | undefined,
  serviceKey: string,
): boolean {
  if (!Array.isArray(accessibleServices)) return false
  if (accessibleServices.includes('*')) return true
  return accessibleServices.includes(serviceKey)
}

/** Convenience overload taking the whole session token. */
export function sessionHasService(
  session: Pick<OidcSessionToken, 'accessibleServices'> | null | undefined,
  serviceKey: string,
): boolean {
  return hasService(session?.accessibleServices, serviceKey)
}
