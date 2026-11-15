'use client'

import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { loadAppConfig } from '../core/config'

export type ShellConfig = {
  appKey: string
  appLabel: string
  /** Where the components fetch the shell info from. */
  shellInfoUrl: string
}

const ShellConfigContext = createContext<ShellConfig | null>(null)

/** The provided config, or the env-based one, with the default shell-info URL. */
export function resolveShellConfig(provided: Partial<ShellConfig> | null): ShellConfig {
  const fallback = provided ?? loadAppConfig()
  return {
    appKey: fallback.appKey ?? 'unknown',
    appLabel: fallback.appLabel ?? 'Reflagged App',
    shellInfoUrl: provided?.shellInfoUrl ?? '/api/shell-info',
  }
}

export function ShellProvider({
  config,
  children,
}: {
  config: Partial<ShellConfig> & Pick<ShellConfig, 'appKey' | 'appLabel'>
  children: ReactNode
}) {
  const value = useMemo(() => resolveShellConfig(config), [config])
  return <ShellConfigContext.Provider value={value}>{children}</ShellConfigContext.Provider>
}

/** The shell config from the nearest `ShellProvider`, or from the env without one. */
export function useShellConfig(): ShellConfig {
  return resolveShellConfig(useContext(ShellConfigContext))
}
