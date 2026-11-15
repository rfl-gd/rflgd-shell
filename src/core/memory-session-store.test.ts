import { memorySessionStore } from './memory-session-store'
import type { ShellSession } from './session-store'
import { sessionStoreConformance } from './session-store-conformance'

const session: ShellSession = {
  sub: 'u1',
  email: 'ada@example.test',
  accessToken: 'old',
  refreshToken: null,
  orgSlug: 'acme',
  accessibleServices: ['*'],
}

sessionStoreConformance('memory', () => ({
  store: memorySessionStore({ session }),
  req: new Request('https://app.example.test/'),
  session,
}))
