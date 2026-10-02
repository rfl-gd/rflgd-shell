'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * What rflgd-base sends in `impersonation` while a platform admin acts as a
 * customer ("Einloggen als"). Absent otherwise, and from older platforms.
 */
export type ImpersonationInfo = {
  tenantName: string
  userName: string
  roleLabel: string | null
  startedBy: string | null
  /** Unix ms. */
  expiresAt: number
  /** Platform time when this was built; the countdown follows its clock. */
  serverNow: number
  platformUrl: string
  /** PATCH extends by 30 minutes, DELETE ends — on the platform, with CORS. */
  actionsUrl: string
}

const HOST_ID = 'rflgd-impersonation-capsule'

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`
}

const timeOfDay = (ms: number) =>
  new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  })

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const pill: React.CSSProperties = {
  minHeight: 36,
  padding: '0 12px',
  borderRadius: 999,
  border: '1px solid #57534e',
  background: 'transparent',
  color: '#e7e5e4',
  font: `500 13px ${FONT}`,
  cursor: 'pointer',
}

/**
 * The support-session capsule: a small red tab glued to the bottom edge, so it
 * never covers a module's header or menu. A click opens the details above it
 * with "+30 min", "Zum Unternehmen" and "Beenden". A thin red frame marks the
 * viewport. Rendered once per page even when an app mounts the switcher twice.
 */
export function ImpersonationCapsule({ info }: { info: ImpersonationInfo }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [expiresAt, setExpiresAt] = useState(info.expiresAt)
  const [skew] = useState(() => info.serverNow - Date.now())
  const [now, setNow] = useState(info.serverNow)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const remaining = expiresAt - now

  // First instance on the page owns the capsule; a second switcher stays quiet.
  useEffect(() => {
    if (document.getElementById(HOST_ID)) return
    const el = document.createElement('div')
    el.id = HOST_ID
    document.body.appendChild(el)
    setHost(el)
    return () => el.remove()
  }, [])

  useEffect(() => {
    if (!host) return
    const id = window.setInterval(() => setNow(Date.now() + skew), 1000)
    return () => window.clearInterval(id)
  }, [host, skew])

  // Ran out: the platform refuses the session now; reloading signs in afresh.
  useEffect(() => {
    if (host && remaining <= 0) window.location.reload()
  }, [host, remaining])

  if (!host) return null

  const call = async (method: 'PATCH' | 'DELETE') => {
    const res = await fetch(info.actionsUrl, {
      method,
      credentials: 'include',
    })
    if (!res.ok) throw new Error(String(res.status))
    return res
  }

  const extend = async () => {
    setBusy(true)
    setFailed(null)
    try {
      const data = (await (await call('PATCH')).json()) as {
        expiresAt: number
      }
      setExpiresAt(data.expiresAt)
    } catch {
      setFailed('Verlängern hat nicht geklappt.')
    } finally {
      setBusy(false)
    }
  }

  const end = async (toPlatform: boolean) => {
    setBusy(true)
    setFailed(null)
    try {
      await call('DELETE')
      // The module session belongs to the customer; reloading lets the
      // platform refuse it and the module sign in again.
      if (toPlatform) window.location.assign(info.platformUrl)
      else window.location.reload()
    } catch {
      setBusy(false)
      setFailed('Beenden hat nicht geklappt.')
    }
  }

  return createPortal(
    <>
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2147483000,
          pointerEvents: 'none',
          boxShadow: 'inset 0 0 0 2px #b91c1c',
        }}
      />
      <div
        data-testid="impersonation-banner"
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 0,
          transform: 'translateX(-50%)',
          zIndex: 2147483001,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          font: `13px ${FONT}`,
        }}
      >
        {open ? (
          <div
            id={`${HOST_ID}-details`}
            style={{
              width: 'min(400px, calc(100vw - 24px))',
              boxSizing: 'border-box',
              borderRadius: 18,
              background: '#1c1917',
              color: '#e7e5e4',
              boxShadow: '0 24px 60px rgba(28,25,23,0.35)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#ffffff' }}>{info.userName}</div>
              <div style={{ color: '#a8a29e' }}>
                {info.roleLabel ? `${info.roleLabel} · ` : ''}
                {info.tenantName}
              </div>
            </div>
            <dl
              style={{
                margin: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '6px 16px',
              }}
            >
              {info.startedBy ? (
                <>
                  <dt style={{ color: '#a8a29e' }}>Gestartet von</dt>
                  <dd
                    style={{
                      margin: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {info.startedBy}
                  </dd>
                </>
              ) : null}
              <dt style={{ color: '#a8a29e' }}>Endet um</dt>
              <dd style={{ margin: 0 }}>{timeOfDay(expiresAt)} Uhr</dd>
            </dl>
            <p style={{ margin: 0, color: '#a8a29e' }}>Beim Beenden wirst du auch hier abgemeldet.</p>
            {failed ? <p style={{ margin: 0, color: '#fca5a5' }}>{failed}</p> : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" style={pill} disabled={busy} onClick={extend}>
                +30 min
              </button>
              <button type="button" style={pill} disabled={busy} onClick={() => end(true)}>
                Zum Unternehmen
              </button>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                disabled={busy}
                onClick={() => end(false)}
                data-testid="end-impersonation-button"
                style={{
                  ...pill,
                  border: 'none',
                  background: '#fafaf9',
                  color: '#1c1917',
                  fontWeight: 600,
                  padding: '0 14px',
                }}
              >
                {busy ? '…' : 'Beenden'}
              </button>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`${HOST_ID}-details`}
          data-testid="impersonation-capsule"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            height: 30,
            maxWidth: 'calc(100vw - 24px)',
            padding: '0 8px 0 14px',
            border: 'none',
            borderRadius: '12px 12px 0 0',
            background: '#b91c1c',
            color: '#ffffff',
            font: `500 12.5px ${FONT}`,
            cursor: 'pointer',
            boxShadow: '0 -6px 20px rgba(28,25,23,0.18)',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: '#fecaca',
              flex: 'none',
            }}
          />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            Als <strong style={{ fontWeight: 600 }}>{info.userName}</strong> bei {info.tenantName}
          </span>
          <span
            style={{
              flex: 'none',
              padding: '2px 8px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.16)',
              font: `500 11.5px ${MONO}`,
            }}
          >
            {clock(remaining)}
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
            style={{ flex: 'none' }}
          >
            <path d={open ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'} />
          </svg>
        </button>
      </div>
    </>,
    host,
  )
}
