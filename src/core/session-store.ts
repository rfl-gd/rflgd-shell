import type { OidcSessionToken } from '../lib/auth/oidc-config'

/** The signed-in user's session; `accessToken` may be null (shellInfo answers `no-access-token`). */
export type ShellSession = Omit<OidcSessionToken, 'iat' | 'exp'>

/**
 * Where a host keeps the shell session. The cookie store is the default; hosts
 * with their own session handling provide another implementation and check it
 * with `sessionStoreConformance`.
 */
export interface ShellSessionStore {
  /** The session the request carries, or null. */
  load(req: Request): Promise<ShellSession | null>
  /** The session with fresh tokens, or null when it cannot be refreshed. */
  refresh(req: Request, session: ShellSession): Promise<ShellSession | null>
  /** Persists `session` on `res` and returns it. */
  save(req: Request, session: ShellSession, res: Response): Promise<Response>
  /** Ends the session on `res` and returns it. */
  end(req: Request, res: Response): Promise<Response>
}
