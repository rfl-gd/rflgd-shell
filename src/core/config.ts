export type AppConfig = {
  appKey: string
  appLabel: string
  defaultRole: string
}

export function loadAppConfig(): AppConfig {
  return {
    appKey: process.env.NEXT_PUBLIC_RFLGD_APP_KEY ?? 'unknown',
    appLabel: process.env.NEXT_PUBLIC_RFLGD_APP_LABEL ?? 'Reflagged App',
    defaultRole: process.env.RFLGD_DEFAULT_USER_ROLE ?? 'user',
  }
}
