'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadAppConfig } from '../config'
import { baseSearchUrl, isPaletteShortcut, matchApps, type PaletteApp } from '../lib/palette/palette'
import { ImpersonationCapsule, type ImpersonationInfo } from './ImpersonationCapsule'
import { ServiceIcon } from './ServiceIcon'
import { useTenantTheme } from './TenantTheme'

type Booking = {
  id: string
  service: string
  label: string
  status: string
  url: string | null
  iconUrl: string | null
  /**
   * Lucide name of the service icon, from rflgd-base. Optional: an older
   * platform does not send it, and then the initial stands in — the way it
   * always did.
   */
  icon?: string | null
}

type Org = {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  /** Tenant branding from rflgd-base ≥ Oct 2026; older platforms omit them. */
  logoDarkUrl?: string | null
  logoMarkUrl?: string | null
  /** Tenant palette stylesheet (`--brass-50…900`, `--rflgd-brand-primary`). */
  themeCssUrl?: string | null
}

type ShellInfo = {
  user: { email: string; name?: string | null; role?: string }
  org: Org | null
  orgs?: Org[]
  bookings: Booking[]
  /** Catalog entries; only `tagline` is read here (rflgd-base ≥ Oct 2026). */
  catalog?: Array<{ service: string; tagline: string | null }>
  catalogUrl: string
  baseUrl: string
  /** Set while a platform admin acts as this user (rflgd-base ≥ Oct 2026). */
  impersonation?: ImpersonationInfo | null
}

/**
 * Colours follow the tenant palette when the platform's theme.css is loaded
 * (`--rflgd-brand-primary`, `--brass-700`), and fall back to Reflagged brass.
 */
const BRAND = 'var(--rflgd-brand-primary, #B09A6A)'
const BRAND_TEXT = 'rgb(var(--brass-700, 125 85 26))'
const tint = (percent: number) =>
  `color-mix(in srgb, var(--rflgd-brand-primary, #B09A6A) ${percent}%, transparent)`

const StackIcon = ({ size = 22 }: { size?: number }) => (
  <svg
    width={size}
    height={(size * 30) / 32}
    viewBox="0 0 32 30"
    fill="none"
    aria-hidden
    style={{ flexShrink: 0 }}
  >
    <path d="M32,0 H23 A3,3 0 0,0 20,3 A3,3 0 0,0 23,6 H32 Z" style={{ fill: BRAND }} />
    <path d="M32,11 H12 A2,2 0 0,0 10,13 A2,2 0 0,0 12,15 H32 Z" style={{ fill: BRAND }} opacity="0.45" />
    <path
      d="M32,23 H1.5 A1.5,1.5 0 0,0 0,24.5 A1.5,1.5 0 0,0 1.5,26 H32 Z"
      style={{ fill: BRAND }}
      opacity="0.25"
    />
  </svg>
)

/** The tenant's logo mark (square) when it has one, else the Reflagged stack. */
function BrandMark({ org, size }: { org: Org | null | undefined; size: number }) {
  const [failed, setFailed] = useState(false)
  const src = org?.logoMarkUrl ?? null
  if (!src || failed) return <StackIcon size={size} />
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }}
    />
  )
}

const INK = '#2C1E14'
const MUTED = '#7A6A58'
const MONO = "'JetBrains Mono', monospace"
const PLATE: React.CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  color: BRAND_TEXT,
  background: 'linear-gradient(180deg, #fffdf6 0%, #f7edd6 52%, #f0e2c2 100%)',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,0.95), 0 0 0 1px rgba(125,85,26,0.13), 0 5px 12px -5px rgba(58,40,12,0.32)',
  flexShrink: 0,
}
const LABEL: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  color: MUTED,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
}
const KBD: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  color: MUTED,
  border: '1px solid rgba(44,30,20,0.14)',
  borderRadius: 4,
  padding: '0 5px',
  whiteSpace: 'nowrap',
}

function AppGlyph({ app, size }: { app: PaletteApp; size: number }) {
  return app.icon === null ? <StackIcon size={size} /> : <ServiceIcon name={app.icon} label={app.label} size={size} />
}

/**
 * Logo-as-switcher. One click on the trigger, or ⌘K / Ctrl+K anywhere,
 * opens the app palette (design "C · Spotlight", same as rflgd-base):
 * every app as an icon plate with its catalog tagline, a search across
 * apps, the user's workspaces, and logout.
 *
 * Platform admins also get a "Plattform" section. Switching a platform
 * tenant runs on Base's session, so it links to the Base palette with the
 * query prefilled instead of switching here.
 */
export function BrandSwitcher() {
  const config = loadAppConfig()
  const [shell, setShell] = useState<ShellInfo | null>(null)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const [shortcut, setShortcut] = useState('Strg K')
  const triggerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  useEffect(() => {
    setMounted(true)
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setShortcut('⌘K')
  }, [])

  useEffect(() => {
    let cancel = false
    fetch('/api/shell-info', { credentials: 'include' })
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          // The platform ended this session (e.g. an impersonation was
          // closed) and the route dropped it: reload into a fresh sign-in.
          const body = (await r.json().catch(() => null)) as { error?: string } | null
          if (!cancel && body?.error === 'session-ended') window.location.reload()
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

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 648)) })
  }

  const toggle = () => {
    if (!open) place()
    setOpen((v) => !v)
  }

  // Global shortcut.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return
      // Apps mount the switcher twice (mobile header, desktop sidebar) and hide
      // one with CSS; only the visible one answers, or both palettes open.
      if (!triggerRef.current?.getClientRects().length) return
      e.preventDefault()
      place()
      setOpen((v) => !v)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // While open: follow the trigger, close on outside click, focus the search.
  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    requestAnimationFrame(() => inputRef.current?.focus())
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest('[data-brand-switcher]')) return
      setOpen(false)
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  useTenantTheme(shell?.org?.themeCssUrl)

  const orgName = shell?.org?.name ?? null
  const baseUrl = shell?.baseUrl ?? 'https://app.rfl.gd'
  const orgs = shell?.orgs ?? (shell?.org ? [shell.org] : [])
  const isPlatformAdmin = shell?.user.role === 'superadmin' || shell?.user.role === 'reflagged_admin'

  const apps = useMemo<PaletteApp[]>(() => {
    const taglines = new Map((shell?.catalog ?? []).map((c) => [c.service, c.tagline]))
    const ready = (shell?.bookings ?? []).filter((b) => b.status === 'ready' && b.url)
    return [
      { key: 'base', label: 'Base', tagline: 'Start, Team und Einstellungen', icon: null, href: baseUrl, current: false },
      ...ready.map((b) => ({
        key: b.service,
        label: b.label,
        tagline: taglines.get(b.service) ?? null,
        icon: b.icon ?? '',
        href: b.url as string,
        current: b.service === config.appKey,
      })),
    ]
  }, [shell, baseUrl, config.appKey])

  const hits = useMemo(() => matchApps(apps, query), [apps, query])
  const hasQuery = query.trim().length > 0
  // The platform jump is the last row while searching, so ↓ reaches it.
  const rowCount = hits.length + (hasQuery && isPlatformAdmin ? 1 : 0)

  useEffect(() => setActive(0), [query])

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, rowCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && hasQuery) {
      e.preventDefault()
      const hit = hits[active]
      if (hit) window.location.assign(hit.href)
      else if (isPlatformAdmin) window.location.assign(baseSearchUrl(baseUrl, query))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (query) setQuery('')
      else {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
  }

  const trigger = (
    <div ref={triggerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Apps wechseln"
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
        <BrandMark org={shell?.org} size={22} />
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.15, textAlign: 'left' }}>
          <div
            style={{
              fontFamily: "'Red Hat Display', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 17,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: INK,
            }}
          >
            {config.appLabel}
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              letterSpacing: '0.1em',
              color: MUTED,
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {orgName ? `${orgName} · rfl.gd` : 'rfl.gd'}
          </div>
        </div>
        <span style={{ ...KBD, marginLeft: 4 }}>{shortcut}</span>
      </button>
    </div>
  )

  const tile = (app: PaletteApp) => (
    <a
      key={app.key}
      href={app.href}
      aria-current={app.current ? 'page' : undefined}
      data-testid={`brand-switcher-app-${app.key}`}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: '12px 8px',
        borderRadius: 12,
        textDecoration: 'none',
        textAlign: 'center',
        color: INK,
        background: app.current ? tint(15) : 'transparent',
      }}
    >
      {app.current ? (
        <span style={{ ...LABEL, position: 'absolute', top: 8, right: 8, fontSize: 9, color: BRAND_TEXT }}>Hier</span>
      ) : null}
      <span aria-hidden style={{ ...PLATE, width: 48, height: 48, borderRadius: 14 }}>
        <AppGlyph app={app} size={22} />
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{app.label}</span>
      {app.tagline ? (
        <span
          style={{
            fontSize: 11.5,
            lineHeight: 1.3,
            color: MUTED,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {app.tagline}
        </span>
      ) : null}
    </a>
  )

  const row = (key: string, index: number, href: string, icon: React.ReactNode, title: string, sub: string) => (
    <a
      key={key}
      id={`${listId}-${index}`}
      role="option"
      aria-selected={index === active}
      href={href}
      onMouseEnter={() => setActive(index)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 8,
        borderRadius: 10,
        textDecoration: 'none',
        color: INK,
        background: index === active ? 'rgba(44,30,20,0.05)' : 'transparent',
      }}
    >
      {icon}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{title}</span>
        <span
          style={{
            display: 'block',
            fontSize: 12,
            color: MUTED,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {sub}
        </span>
      </span>
      {index === active ? <span style={{ ...KBD, border: 'none' }}>↵</span> : null}
    </a>
  )

  const popover = open ? (
    <div
      role="dialog"
      aria-label="Apps und Workspaces"
      data-brand-switcher
      data-testid="brand-switcher-panel"
      style={{
        position: pos ? 'fixed' : 'absolute',
        left: pos ? pos.left : 0,
        top: pos ? pos.top : '100%',
        zIndex: 2147483647,
        marginTop: pos ? 0 : 8,
        width: 'min(640px, calc(100vw - 16px))',
        borderRadius: 16,
        border: `1px solid ${tint(16)}`,
        background: '#FFFFFF',
        overflow: 'hidden',
        boxShadow: `0 1px 0 ${tint(8)}, 0 24px 48px -20px rgba(58,40,12,0.35)`,
        fontFamily: "'Inter', system-ui, sans-serif",
        color: INK,
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          borderBottom: `1px solid ${tint(12)}`,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          role="combobox"
          aria-expanded={hasQuery}
          aria-controls={listId}
          aria-activedescendant={hasQuery && rowCount > 0 ? `${listId}-${active}` : undefined}
          aria-label={isPlatformAdmin ? 'App oder Unternehmen suchen' : 'App suchen'}
          placeholder={isPlatformAdmin ? 'App oder Unternehmen suchen …' : 'App suchen …'}
          data-testid="brand-switcher-search"
          style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', font: 'inherit', fontSize: 15, color: INK }}
        />
        <span style={KBD}>Esc</span>
      </label>

      <div style={{ maxHeight: 'min(32rem, 70vh)', overflowY: 'auto', padding: 16, display: 'grid', gap: 16 }}>
        {error && !shell ? (
          <a
            href={`/api/oidc/signin?callbackUrl=${encodeURIComponent(
              typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/',
            )}`}
            style={{ fontSize: 13, color: BRAND_TEXT, textDecoration: 'none' }}
          >
            Anmelden, um Services zu sehen →
          </a>
        ) : hasQuery ? (
          <div id={listId} role="listbox" aria-label="Treffer" style={{ display: 'grid', gap: 2 }}>
            {hits.length > 0 ? <div style={{ ...LABEL, padding: '0 8px 4px' }}>Apps</div> : null}
            {hits.map((app, i) =>
              row(
                app.key,
                i,
                app.href,
                <span aria-hidden style={{ ...PLATE, width: 36, height: 36, borderRadius: 10 }}>
                  <AppGlyph app={app} size={17} />
                </span>,
                app.label,
                app.tagline ?? '',
              ),
            )}
            {isPlatformAdmin ? (
              <>
                <div style={{ ...LABEL, padding: '10px 8px 4px', color: BRAND_TEXT }}>Plattform · Workspace wechseln</div>
                {row(
                  'platform',
                  hits.length,
                  baseSearchUrl(baseUrl, query),
                  <span aria-hidden style={{ ...PLATE, width: 36, height: 36, borderRadius: 10 }}>
                    <StackIcon size={17} />
                  </span>,
                  `„${query.trim()}“ unter Unternehmen suchen`,
                  'Öffnet Base, der Wechsel läuft dort',
                )}
              </>
            ) : hits.length === 0 ? (
              <div style={{ padding: 8, fontSize: 13, color: MUTED }}>Nichts gefunden. Versuch es mit einem App-Namen.</div>
            ) : null}
          </div>
        ) : (
          <>
            <section aria-label="Apps" style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '0 4px' }}>
                <span style={LABEL}>Deine Apps</span>
                {shell?.catalogUrl ? (
                  <a href={shell.catalogUrl} style={{ fontSize: 12.5, fontWeight: 500, color: BRAND_TEXT, textDecoration: 'none' }}>
                    Katalog öffnen
                  </a>
                ) : null}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(7rem, 1fr))', gap: 4 }}>
                {apps.map(tile)}
              </div>
            </section>

            {orgs.length > 1 ? (
              <section aria-label="Workspaces" style={{ display: 'grid', gap: 8, borderTop: `1px solid ${tint(12)}`, paddingTop: 12 }}>
                <span style={{ ...LABEL, padding: '0 4px' }}>Deine Workspaces</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {orgs.map((o) => {
                    const isCurrent = o.id === shell?.org?.id
                    return (
                      <span
                        key={o.id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 12px 3px 4px',
                          borderRadius: 99,
                          fontSize: 12.5,
                          border: `1px solid ${isCurrent ? BRAND : 'rgba(44,30,20,0.14)'}`,
                          background: isCurrent ? tint(15) : 'rgba(44,30,20,0.03)',
                          color: isCurrent ? BRAND_TEXT : INK,
                        }}
                      >
                        <span aria-hidden style={{ width: 20, height: 20, borderRadius: 99, display: 'grid', placeItems: 'center', background: '#fff', border: '1px solid rgba(44,30,20,0.14)', fontFamily: MONO, fontSize: 9, color: MUTED }}>
                          {o.name.slice(0, 2).toUpperCase()}
                        </span>
                        {o.name}
                      </span>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {isPlatformAdmin ? (
              <section aria-label="Plattform" style={{ display: 'grid', gap: 6, borderTop: `1px solid ${tint(12)}`, paddingTop: 12 }}>
                <span style={{ ...LABEL, padding: '0 4px' }}>
                  Plattform · Workspace <span style={{ textTransform: 'none', letterSpacing: 0 }}>nur Super-Admins</span>
                </span>
                <a
                  href={baseSearchUrl(baseUrl, '')}
                  data-testid="brand-switcher-platform"
                  style={{ padding: '0 4px', fontSize: 13, color: BRAND_TEXT, textDecoration: 'none' }}
                >
                  Unternehmen in Base wechseln →
                </a>
              </section>
            ) : null}
          </>
        )}
      </div>

      {/* Logout clears both the local OIDC cookie and the upstream SSO session
          (via <provider>/api/sso/signout), so it stays reachable here. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '4px 16px',
          padding: '8px 16px',
          borderTop: `1px solid ${tint(12)}`,
          fontSize: 11.5,
          color: MUTED,
        }}
      >
        <span>↑↓ auswählen</span>
        <span>↵ öffnen</span>
        <span>{shortcut} öffnet und schließt</span>
        <a
          href="/api/oidc/signout"
          data-testid="brand-switcher-logout"
          style={{ marginLeft: 'auto', color: '#B0413A', fontWeight: 500, fontSize: 13, textDecoration: 'none' }}
        >
          Abmelden
        </a>
      </div>
    </div>
  ) : null

  const capsule = mounted && shell?.impersonation ? <ImpersonationCapsule info={shell.impersonation} /> : null

  if (mounted && open && pos) {
    return (
      <div data-brand-switcher style={{ position: 'relative' }}>
        {trigger}
        {createPortal(popover, document.body)}
        {capsule}
      </div>
    )
  }

  return (
    <div data-brand-switcher style={{ position: 'relative' }}>
      {trigger}
      {popover}
      {capsule}
    </div>
  )
}
