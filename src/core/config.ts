export type AppConfig = {
  appKey: string
  appLabel: string
  defaultRole: string
}

type Env = Record<string, string | undefined>

/**
 * The process env where there is one (Node, Next), nothing elsewhere. Reads
 * each variable by its full `process.env.NAME` so bundlers that inline public
 * variables at build time (Next's `NEXT_PUBLIC_*`) still see them; where no
 * bundler replaced them and there is no `process` (e.g. Vite), the
 * `ReferenceError` is caught.
 */
function processEnv(): Env {
  try {
    return {
      NEXT_PUBLIC_RFLGD_APP_KEY: process.env.NEXT_PUBLIC_RFLGD_APP_KEY,
      NEXT_PUBLIC_RFLGD_APP_LABEL: process.env.NEXT_PUBLIC_RFLGD_APP_LABEL,
      RFLGD_DEFAULT_USER_ROLE: process.env.RFLGD_DEFAULT_USER_ROLE,
    }
  } catch {
    return {}
  }
}

export function loadAppConfig(env: Env = processEnv()): AppConfig {
  return {
    appKey: env.NEXT_PUBLIC_RFLGD_APP_KEY ?? 'unknown',
    appLabel: env.NEXT_PUBLIC_RFLGD_APP_LABEL ?? 'Reflagged App',
    defaultRole: env.RFLGD_DEFAULT_USER_ROLE ?? 'user',
  }
}
