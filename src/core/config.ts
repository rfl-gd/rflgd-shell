export type AppConfig = {
  appKey: string
  appLabel: string
  defaultRole: string
}

type Env = Record<string, string | undefined>

/**
 * The process env where there is one (Node, Next), nothing elsewhere. Reads
 * each variable by its full `process.env.NAME` so bundlers that inline public
 * variables at build time (Next's `NEXT_PUBLIC_*`) still see them.
 */
function processEnv(): Env {
  if (typeof process === 'undefined') return {}
  return {
    NEXT_PUBLIC_RFLGD_APP_KEY: process.env.NEXT_PUBLIC_RFLGD_APP_KEY,
    NEXT_PUBLIC_RFLGD_APP_LABEL: process.env.NEXT_PUBLIC_RFLGD_APP_LABEL,
    RFLGD_DEFAULT_USER_ROLE: process.env.RFLGD_DEFAULT_USER_ROLE,
  }
}

export function loadAppConfig(env: Env = processEnv()): AppConfig {
  return {
    appKey: env.NEXT_PUBLIC_RFLGD_APP_KEY ?? 'unknown',
    appLabel: env.NEXT_PUBLIC_RFLGD_APP_LABEL ?? 'Reflagged App',
    defaultRole: env.RFLGD_DEFAULT_USER_ROLE ?? 'user',
  }
}
