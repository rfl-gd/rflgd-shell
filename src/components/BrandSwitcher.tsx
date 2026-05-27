'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadAppConfig } from '../config'

type Booking = {
  id: string
  service: string
  label: string
  status: string
  url: string | null
  iconUrl: string | null
}

type Org = {
  id: string
  slug: string
  name: string
  logoUrl: string | null
}

type ShellInfo = {
  user: { email: string; name?: string | null }
  org: Org | null
  orgs?: Org[]
  bookings: Booking[]
  catalogUrl: string
  baseUrl: string
}

const StackIcon = ({ size = 22 }: { size?: number }) => (
  <svg
    width={size}
    height={(size * 30) / 32}
    viewBox="0 0 32 30"
    fill="none"
    aria-hidden
    style={{ flexShrink: 0 }}
  >
    <path d="M32,0 H23 A3,3 0 0,0 20,3 A3,3 0 0,0 23,6 H32 Z" fill="#B09A6A" />
    <path d="M32,11 H12 A2,2 0 0,0 10,13 A2,2 0 0,0 12,15 H32 Z" fill="#B09A6A" opacity="0.45" />
    <path
      d="M32,23 H1.5 A1.5,1.5 0 0,0 0,24.5 A1.5,1.5 0 0,0 1.5,26 H32 Z"
      fill="#B09A6A"
      opacity="0.25"
    />
  </svg>
)

export function BrandSwitcher() {
  const config = loadAppConfig()
  const [shell, setShell] = useState<ShellInfo | null>(null)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

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
      .then((d) => {
        if (!cancel && d) setShell(d)
      })
      .catch(() => setError(true))
    return () => {
      cancel = true
    }
  }, [])

  // Track trigger position for portal popover — anchor below-left.
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const update = () => {
      const r = triggerRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 8, left: r.left })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

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
  const orgName = shell?.org?.name ?? null
  const baseUrl = shell?.baseUrl ?? 'https://app.rfl.gd'
  const orgs = shell?.orgs ?? (shell?.org ? [shell.org] : [])
  const showWorkspaceSection = orgs.length > 1

  const trigger = (
    <div ref={triggerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Reflagged Apps wechseln"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          background: 'transparent',
          border: 'none',
          padding: '4px 8px',
          borderRadius: 4,
          fontFamily: 'inherit',
          color: 'inherit',
        }}
      >
        <StackIcon size={22} />
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.15 }}>
          <div
            style={{
              fontFamily: "'Red Hat Display', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 17,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: '#2C1E14',
            }}
          >
            {config.appLabel}
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              letterSpacing: '0.1em',
              color: '#7A6A58',
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {orgName ? `${orgName} · rfl.gd` : 'rfl.gd'}
          </div>
        </div>
        {orgName ? (
          <span
            style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              padding: '2px 8px',
              borderRadius: 99,
              border: '1px solid rgba(44,30,20,0.1)',
              background: 'rgba(44,30,20,0.03)',
              color: '#7A6A58',
              whiteSpace: 'nowrap',
            }}
          >
            {orgName}
          </span>
        ) : null}
        <span aria-hidden style={{ color: '#7A6A58', fontSize: 10, marginLeft: 4 }}>
          {open ? '▴' : '▾'}
        </span>
      </button>
    </div>
  )

  const sectionLabelStyle: React.CSSProperties = {
    padding: '10px 12px 6px',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    color: '#7A6A58',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
  }

  const popover = open ? (
    <div
      role="menu"
      data-brand-switcher
      style={{
        position: pos ? 'fixed' : 'absolute',
        left: pos ? pos.left : 0,
        top: pos ? pos.top : '100%',
        zIndex: 2147483647,
        marginTop: pos ? 0 : 8,
        width: 280,
        borderRadius: 14,
        border: '1px solid rgba(176,154,106,0.16)',
        background: '#FFFFFF',
        padding: 8,
        boxShadow: '0 1px 0 rgba(176,154,106,0.08), 0 12px 40px rgba(0,0,0,0.15)',
      }}
    >
      {showWorkspaceSection ? (
        <>
          <div style={sectionLabelStyle}>Workspace</div>
          {orgs.map((o) => {
            const isCurrent = o.id === shell?.org?.id
            return (
              <div
                key={o.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: isCurrent ? 'rgba(176,154,106,0.15)' : 'transparent',
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'rgba(176,154,106,0.15)',
                    color: '#B09A6A',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: "'Red Hat Display', system-ui, sans-serif",
                    fontWeight: 600,
                  }}
                >
                  {o.name.slice(0, 1).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13.5, color: '#2C1E14' }}>{o.name}</div>
                  <div style={{ fontSize: 11.5, color: '#7A6A58', marginTop: 2 }}>
                    {isCurrent
                      ? `${ready.length} Service${ready.length === 1 ? '' : 's'} aktiv`
                      : o.slug}
                  </div>
                </div>
                {isCurrent ? (
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 9.5,
                      color: '#B09A6A',
                      padding: '2px 6px',
                      background: 'rgba(176,154,106,0.15)',
                      borderRadius: 4,
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                    }}
                  >
                    aktuell
                  </span>
                ) : null}
              </div>
            )
          })}
          <hr
            style={{
              border: 'none',
              borderTop: '1px solid rgba(176,154,106,0.12)',
              margin: '6px 0',
            }}
          />
        </>
      ) : null}

      <div style={sectionLabelStyle}>Apps</div>
      {error && !shell ? (
        <a
          href="/api/oidc/signin"
          style={{ display: 'block', padding: '8px 12px 12px', fontSize: 13, color: '#B09A6A', textDecoration: 'none' }}
        >
          Anmelden, um Services zu sehen →
        </a>
      ) : (
        <>
          {/* Base app is always a first-class entry — that's where users land
              to book new services. */}
          <a
            href={baseUrl}
            role="menuitem"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 8,
              textDecoration: 'none',
              color: '#2C1E14',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(176,154,106,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <StackIcon size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 13.5 }}>Reflagged Base</div>
              <div style={{ fontSize: 11.5, color: '#7A6A58', marginTop: 2 }}>
                Katalog & Settings
              </div>
            </div>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9.5,
                color: '#7A6A58',
                padding: '2px 6px',
                background: 'rgba(176,154,106,0.08)',
                borderRadius: 4,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}
            >
              Hub
            </span>
          </a>

          {ready.length === 0 ? (
            <div style={{ padding: '8px 12px 12px', fontSize: 13, color: '#7A6A58' }}>
              Noch keine aktiven Services.
            </div>
          ) : (
            ready.map((b) => {
              const active = b.service === config.appKey
              return (
                <a
                  key={b.id}
                  href={b.url ?? '#'}
                  role="menuitem"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 8,
                    textDecoration: 'none',
                    color: '#2C1E14',
                    background: active ? 'rgba(176,154,106,0.15)' : 'transparent',
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: active ? 'rgba(176,154,106,0.25)' : 'rgba(176,138,122,0.25)',
                      color: active ? '#B09A6A' : '#B08A7A',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: "'Red Hat Display', system-ui, sans-serif",
                      fontWeight: 600,
                    }}
                  >
                    {b.label.slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13.5 }}>{b.label}</div>
                    <div style={{ fontSize: 11.5, color: '#7A6A58', marginTop: 2 }}>
                      {active ? 'aktuell geöffnet' : 'bereit'}
                    </div>
                  </div>
                  {active ? (
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 9.5,
                        color: '#B09A6A',
                        padding: '2px 6px',
                        background: 'rgba(176,154,106,0.15)',
                        borderRadius: 4,
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                      }}
                    >
                      aktuell
                    </span>
                  ) : (
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 9.5,
                        color: '#3F8F5C',
                        padding: '2px 6px',
                        background: 'rgba(63,143,92,0.12)',
                        borderRadius: 4,
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                      }}
                    >
                      bereit
                    </span>
                  )}
                </a>
              )
            })
          )}
        </>
      )}
    </div>
  ) : null

  if (mounted && open && pos) {
    return (
      <div data-brand-switcher style={{ position: 'relative' }}>
        {trigger}
        {createPortal(popover, document.body)}
      </div>
    )
  }

  return (
    <div data-brand-switcher style={{ position: 'relative' }}>
      {trigger}
      {popover}
    </div>
  )
}
