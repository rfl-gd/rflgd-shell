import { afterEach, beforeEach, vi } from 'vitest'

import type { OidcEnv } from './auth/oidc-config'
import { loadOidcEnv } from './auth/oidc-config'
import { memorySessionStore } from './memory-session-store'
import { backchannelLogout } from './oidc-backchannel-logout'
import { oidcSignin } from './oidc-signin'
import { oidcSignout } from './oidc-signout'
import { shellInfo } from './shell-info'
import { describeShellContract } from './shell-contract-conformance'

const discovery = {
  issuer: 'https://id.example.test/oidc',
  authorization_endpoint: 'https://id.example.test/oidc/auth',
  token_endpoint: 'https://id.example.test/oidc/token',
  jwks_uri: 'https://id.example.test/oidc/jwks',
}

let env: OidcEnv

beforeEach(() => {
  vi.stubEnv('OIDC_ISSUER', 'https://id.example.test/oidc')
  vi.stubEnv('OIDC_CLIENT_ID', 'client')
  vi.stubEnv('OIDC_CLIENT_SECRET', 'secret')
  vi.stubEnv('AUTH_SECRET', 'x'.repeat(32))
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://app.example.test')
  vi.stubEnv('RFLGD_SERVER_URL', '')
  env = loadOidcEnv() as OidcEnv
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(discovery)))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** A host app wired the way the README shows: the core handlers at the contract's paths. */
async function handle(req: Request): Promise<Response> {
  const sessions = memorySessionStore({ session: null })
  switch (new URL(req.url).pathname) {
    case '/api/shell-info':
      return shellInfo(req, { platformUrl: 'https://id.example.test', sessions })
    case '/api/oidc/signin':
      return oidcSignin(req, { env, sessions })
    case '/api/oidc/signout':
      return oidcSignout(req, { env, sessions })
    case '/api/oidc/backchannel-logout':
      return backchannelLogout(req, { env })
    default:
      return new Response(null, { status: 404 })
  }
}

describeShellContract({ handle, origin: 'https://app.example.test' })
