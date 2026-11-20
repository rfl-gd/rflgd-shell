import { OIDC_SESSION_TTL } from './oidc-config'

/**
 * Sessions the platform logged out through OIDC Back-Channel Logout.
 *
 * The session lives in a signed cookie the module cannot reach, so a logout
 * is remembered here and every session read checks it: a session of that
 * `sid` (or, without `sid`, of that `sub`) signed in at or before the logout
 * is refused. A later sign-in — even with the same `sid`, which the platform
 * may hand out again — stays valid.
 *
 * Kept in memory on `globalThis`, so every route bundle of one process shares
 * it (Next bundles the shell per route). Lost on restart and not shared
 * between instances: the platform revokes the session's tokens as well, so a
 * missed entry ends the session at the module's next call to the platform.
 */

/**
 * `legacySubs`: the person behind each `sid` logout, for sessions minted
 * before shell 2.2, which carry no `sid` and could not be matched otherwise.
 */
type Registry = { sids: Map<string, number>; subs: Map<string, number>; legacySubs: Map<string, number> }

const KEY = Symbol.for('rflgd.shell.revocations')
const TTL_MS = OIDC_SESSION_TTL * 1000

function registry(): Registry {
  const holder = globalThis as { [KEY]?: Registry }
  holder[KEY] ??= { sids: new Map(), subs: new Map(), legacySubs: new Map() }
  return holder[KEY]
}

function prune(now: number): void {
  const { sids, subs, legacySubs } = registry()
  for (const entries of [sids, subs, legacySubs]) {
    for (const [key, at] of entries) if (now - at > TTL_MS) entries.delete(key)
  }
}

/**
 * Records a logout of the provider session `sid`, or of every session of `sub`
 * when the token names no session. `at` is milliseconds since the epoch on the
 * platform's clock (from the logout token), like a session's `signedInAt`.
 */
export function recordLogout(target: { sid?: string | null; sub?: string | null }, at: number = Date.now()): void {
  prune(Date.now())
  const { sids, subs, legacySubs } = registry()
  const later = (entries: Map<string, number>, key: string) => entries.set(key, Math.max(at, entries.get(key) ?? 0))
  if (target.sid) {
    later(sids, target.sid)
    if (target.sub) later(legacySubs, target.sub)
  } else if (target.sub) {
    later(subs, target.sub)
  }
}

/** True when the platform logged this session out after it was signed in. */
export function isSessionRevoked(session: { sub: string; sid?: string | null; signedInAt?: number | null }): boolean {
  const { sids, subs, legacySubs } = registry()
  const signedInAt = session.signedInAt ?? 0
  // A session without `sid` (minted before 2.2) ends with any logout of its person.
  const bySid = session.sid ? sids.get(session.sid) : legacySubs.get(session.sub)
  const bySub = subs.get(session.sub)
  return (bySid !== undefined && bySid >= signedInAt) || (bySub !== undefined && bySub >= signedInAt)
}

/** Forgets every recorded logout. For tests. */
export function clearRevocations(): void {
  const { sids, subs, legacySubs } = registry()
  sids.clear()
  subs.clear()
  legacySubs.clear()
}
