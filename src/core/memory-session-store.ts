import type { ShellSession, ShellSessionStore } from './session-store'

export type MemorySessionStore = ShellSessionStore & { saved: ShellSession[]; ended: number }

/**
 * In-memory session store for tests: `load` answers `session`, `refresh`
 * answers `refreshed`, and `save`/`end` are recorded in `saved`/`ended`.
 */
export function memorySessionStore(options: {
  session: ShellSession | null
  refreshed?: ShellSession | null
}): MemorySessionStore {
  const store: MemorySessionStore = {
    saved: [],
    ended: 0,
    async load() {
      return options.session
    },
    async refresh(_req, session) {
      if (!session.refreshToken) return null
      return options.refreshed ?? null
    },
    async save(_req, session, res) {
      store.saved.push(session)
      return res
    },
    async end(_req, res) {
      store.ended += 1
      return res
    },
  }
  return store
}
