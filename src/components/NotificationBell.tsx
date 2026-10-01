'use client'

import { useEffect, useState } from 'react'

type ShellInfo = { unreadNotifications?: number; baseUrl?: string; org?: { tenantSlug?: string | null } | null }

/**
 * Bell for module headers: unread count from rflgd-base (via the module's
 * /api/shell-info proxy) and a link to the central inbox. Renders nothing
 * until the shell info is known, so a module without a session stays clean.
 */
export function NotificationBell({
  inboxUrl,
  className,
}: {
  /** Override the inbox link; defaults to `<baseUrl>/benachrichtigungen`. */
  inboxUrl?: string
  className?: string
}) {
  const [info, setInfo] = useState<ShellInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/shell-info', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ShellInfo | null) => {
        if (!cancelled) setInfo(data)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  if (!info) return null
  const unread = info.unreadNotifications ?? 0
  const href = inboxUrl ?? `${(info.baseUrl ?? 'https://app.rfl.gd').replace(/\/$/, '')}/benachrichtigungen`
  const label = unread > 0 ? `Benachrichtigungen, ${unread} ungelesen` : 'Benachrichtigungen'

  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      data-testid="rflgd-notification-bell"
      className={className}
      style={{
        position: 'relative',
        display: 'inline-grid',
        placeItems: 'center',
        width: 40,
        height: 40,
        borderRadius: 10,
        color: 'inherit',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 ? (
        <span
          data-testid="rflgd-notification-badge"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 999,
            background: '#7D551A',
            color: '#fff',
            fontSize: 9,
            lineHeight: '16px',
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </a>
  )
}
