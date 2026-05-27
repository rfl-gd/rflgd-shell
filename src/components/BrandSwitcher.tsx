'use client'

import { useEffect, useState } from 'react'
import { loadAppConfig } from '../config'

type Booking = {
  id: string
  service: string
  label: string
  status: string
  url: string | null
  iconUrl: string | null
}

type ShellInfo = {
  user: { email: string; name?: string | null }
  org: { name: string; slug: string } | null
  bookings: Booking[]
  catalogUrl: string
  baseUrl: string
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'wartet',
  provisioning: 'wird bereitgestellt',
  ready: 'bereit',
  failed: 'fehlgeschlagen',
  suspended: 'pausiert',
  cancelled: 'gekuendigt',
}

const StackIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={(size * 30) / 32} viewBox="0 0 32 30" fill="none" aria-hidden style={{ flexShrink: 0 }}>
    <path d="M32,0 H23 A3,3 0 0,0 20,3 A3,3 0 0,0 23,6 H32 Z" fill="#B09A6A" />
    <path d="M32,11 H12 A2,2 0 0,0 10,13 A2,2 0 0,0 12,15 H32 Z" fill="#B09A6A" opacity="0.45" />
    <path d="M32,23 H1.5 A1.5,1.5 0 0,0 0,24.5 A1.5,1.5 0 0,0 1.5,26 H32 Z" fill="#B09A6A" opacity="0.25" />
  </svg>
)

export function BrandSwitcher({ variant = 'header' }: { variant?: 'header' | 'sidebar' }) {
  const config = loadAppConfig()
  const [shell, setShell] = useState<ShellInfo | null>(null)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancel = false
    fetch('/api/shell-info', { credentials: 'include' })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          setError(true)
          return null
        }
        return r.ok ? r.json() : null
      })
      .then((d) => { if (!cancel && d) setShell(d) })
      .catch(() => setError(true))
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest('[data-brand-switcher]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const ready = (shell?.bookings ?? []).filter((b) => b.status === 'ready' && b.url)
  const provisioning = (shell?.bookings ?? []).filter(
    (b) => b.status === 'provisioning' || b.status === 'pending',
  )
  const catalogUrl = shell?.catalogUrl ?? 'https://app.rfl.gd/catalog'
  const orgName = shell?.org?.name ?? null

  const compact = variant === 'sidebar'

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="Reflagged Apps wechseln"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 6 : 8,
        cursor: 'pointer',
        background: 'transparent',
        border: 'none',
        padding: compact ? '8px 12px 10px' : '4px 8px',
        borderRadius: compact ? 6 : 4,
        width: compact ? '100%' : 'auto',
        textAlign: 'left',
        fontFamily: 'inherit',
        color: 'inherit',
        marginBottom: compact ? 8 : 0,
        borderBottom: compact ? '1px solid rgba(176,154,106,0.12)' : 'none',
      }}
    >
      <StackIcon size={compact ? 20 : 22} />
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.15 }}>
        <div style={{
          fontFamily: "'Red Hat Display', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: compact ? 13 : 17,
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: '#2C1E14',
        }}>
          {config.appLabel}
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: compact ? 9 : 10.5,
          letterSpacing: '0.1em',
          color: '#7A6A58',
          marginTop: 2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {orgName ? `${orgName} · rfl.gd` : 'rfl.gd'}
        </div>
      </div>
      {orgName && !compact ? (
        <span style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          padding: '2px 8px',
          borderRadius: 99,
          border: '1px solid rgba(44,30,20,0.1)',
          background: 'rgba(44,30,20,0.03)',
          color: '#7A6A58',
          whiteSpace: 'nowrap',
        }}>
          {orgName}
        </span>
      ) : null}
      <span aria-hidden style={{ color: '#7A6A58', fontSize: 10, marginLeft: compact ? 2 : 4 }}>
        {open ? '▴' : '▾'}
      </span>
    </button>
  )

  const popover = open ? (
    <div
      role="menu"
      data-brand-switcher
      style={{
        position: compact ? 'fixed' : 'absolute',
        left: compact ? 280 : 0,
        top: compact ? 'auto' : '100%',
        zIndex: compact ? 2147483646 : 30,
        marginTop: compact ? 0 : 8,
        width: 280,
        borderRadius: 14,
        border: '1px solid rgba(176,154,106,0.16)',
        background: '#FFFFFF',
        padding: 8,
        boxShadow: '0 1px 0 rgba(176,154,106,0.08), 0 12px 40px rgba(0,0,0,0.15)',
      }}
    >
      {/* Workspace */}
      <div style={{ padding: '10px 12px 6px', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#7A6A58', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        Workspace
      </div>
      {shell?.org ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(176,154,106,0.15)', color: '#B09A6A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Red Hat Display', system-ui, sans-serif", fontWeight: 600 }}>
            {shell.org.name.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13.5, color: '#2C1E14' }}>{shell.org.name}</div>
            <div style={{ fontSize: 11.5, color: '#7A6A58', marginTop: 2 }}>{ready.length} Service{ready.length === 1 ? '' : 's'} aktiv</div>
          </div>
        </div>
      ) : error ? (
        <a href="/api/oidc/signin" style={{ display: 'block', padding: '8px 12px 12px', fontSize: 13, color: '#B09A6A', textDecoration: 'none' }}>
          Anmelden, um Services zu sehen →
        </a>
      ) : (
        <div style={{ padding: '8px 12px 12px', fontSize: 13, color: '#7A6A58' }}>
          {shell === null ? 'wird geladen…' : 'kein Workspace verfügbar'}
        </div>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid rgba(176,154,106,0.12)', margin: '6px 0' }} />

      {/* Apps */}
      <div style={{ padding: '6px 12px 6px', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#7A6A58', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        Apps
      </div>
      {ready.length === 0 ? (
        <div style={{ padding: '8px 12px 12px', fontSize: 13, color: '#7A6A58' }}>
          {error ? 'Zum Anzeigen bitte anmelden.' : 'Noch keine aktiven Services.'}
        </div>
      ) : (
        ready.map((b) => {
          const active = b.service === config.appKey
          return (
            <a key={b.id} href={b.url ?? '#'} role="menuitem" style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8,
              textDecoration: 'none', color: '#2C1E14',
              background: active ? 'rgba(176,154,106,0.15)' : 'transparent',
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: active ? 'rgba(176,154,106,0.25)' : 'rgba(176,138,122,0.25)', color: active ? '#B09A6A' : '#B08A7A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Red Hat Display', system-ui, sans-serif", fontWeight: 600 }}>
                {b.label.slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13.5 }}>{b.label}</div>
                <div style={{ fontSize: 11.5, color: '#7A6A58', marginTop: 2 }}>
                  {active ? 'aktuell geöffnet' : (b.url ?? '').replace(/^https?:\/\//, '')}
                </div>
              </div>
              {active ? (
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: '#B09A6A', padding: '2px 6px', background: 'rgba(176,154,106,0.15)', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  aktiv
                </span>
              ) : null}
            </a>
          )
        })
      )}

      {provisioning.length > 0 ? (
        <>
          <div style={{ marginTop: 12, padding: '6px 12px 6px', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#7A6A58', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            In Vorbereitung
          </div>
          {provisioning.map((b) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', fontSize: 13, color: '#7A6A58' }}>
              <span>{b.label}</span>
              <span style={{ fontSize: 10 }}>{STATUS_LABELS[b.status]}</span>
            </div>
          ))}
        </>
      ) : null}

      <hr style={{ border: 'none', borderTop: '1px solid rgba(176,154,106,0.12)', margin: '6px 0' }} />

      {/* Catalog link */}
      <a href={catalogUrl} role="menuitem" style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8,
        textDecoration: 'none', color: '#2C1E14',
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(176,154,106,0.16)', color: '#B09A6A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          ↗
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13.5 }}>Reflagged Plattform</div>
          <div style={{ fontSize: 11.5, color: '#7A6A58', marginTop: 2 }}>Katalog & Settings</div>
        </div>
      </a>

      {/* Signout */}
      <a href="/api/oidc/signout" role="menuitem" style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8,
        textDecoration: 'none', color: '#2C1E14',
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#F5F0EB', color: '#7A6A58', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          ⏻
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13.5 }}>Logout</div>
          <div style={{ fontSize: 11.5, color: '#7A6A58', marginTop: 2 }}>aus allen Services abmelden</div>
        </div>
      </a>
    </div>
  ) : null

  return (
    <div data-brand-switcher style={{ position: 'relative' }}>
      {trigger}
      {popover}
    </div>
  )
}
