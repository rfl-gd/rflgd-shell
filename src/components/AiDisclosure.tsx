'use client'

import { useEffect, useState, type CSSProperties } from 'react'

import { fetchShellInfo, isOk } from '../lib/shell-info/fetch-shell-info'

/** Copy of AI_DISCLOSURE_TEXT in rflgd-base; shown until the platform's text arrives. */
export const AI_DISCLOSURE_FALLBACK = 'KI-System der Reflagged GmbH'

type Props = {
  /** Point the input or trigger at this id via `aria-describedby` (use `useId()`). */
  id: string
  /**
   * `aiDisclosure` from shell data the module already holds, `null` while it
   * loads. Omit it to let the component read the shared /api/shell-info request.
   */
  text?: string | null
  className?: string
  style?: CSSProperties
}

/**
 * Notice required by Art. 50(1) EU AI Act: one muted line at the point where
 * people interact with the module's AI (below the input, or at the trigger).
 */
export function AiDisclosure({ id, text, className, style }: Props) {
  const [fetched, setFetched] = useState<string | null>(null)
  const readsShellInfo = text === undefined

  useEffect(() => {
    if (!readsShellInfo) return
    let cancel = false
    fetchShellInfo()
      .then(({ status, body }) => {
        const value = isOk(status) ? (body as { aiDisclosure?: unknown } | null)?.aiDisclosure : null
        if (!cancel && typeof value === 'string') setFetched(value)
      })
      .catch(() => undefined)
    return () => {
      cancel = true
    }
  }, [readsShellInfo])

  return (
    <p id={id} className={className} style={style}>
      {text || fetched || AI_DISCLOSURE_FALLBACK}
    </p>
  )
}
