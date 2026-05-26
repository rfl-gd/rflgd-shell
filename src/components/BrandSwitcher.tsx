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
  <svg width={size} height={(size * 30) / 32} viewBox="0 0 32 30" fill="none" aria-hidden className="shrink-0">
    <path d="M32,0 H23 A3,3 0 0,0 20,3 A3,3 0 0,0 23,6 H32 Z" fill="#B09A6A" />
    <path d="M32,11 H12 A2,2 0 0,0 10,13 A2,2 0 0,0 12,15 H32 Z" fill="#B09A6A" opacity="0.45" />
    <path d="M32,23 H1.5 A1.5,1.5 0 0,0 0,24.5 A1.5,1.5 0 0,0 1.5,26 H32 Z" fill="#B09A6A" opacity="0.25" />
  </svg>
)

export function BrandSwitcher() {
  const config = loadAppConfig()
  const [shell, setShell] = useState<ShellInfo | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancel = false
    fetch('/api/shell-info', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancel && setShell(d))
      .catch(() => {})
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

  return (
    <div className="relative" data-brand-switcher>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded px-2 py-1 transition hover:bg-[var(--brand-accent-soft)]"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Reflagged Apps wechseln"
      >
        <StackIcon size={22} />
        <span className="flex items-baseline gap-1.5">
          <span className="font-display text-lg font-bold leading-none text-[var(--brand-fg)]">
            {config.appLabel}
          </span>
          <span className="text-xs leading-none text-[var(--brand-muted)]">rfl.gd</span>
        </span>
        {orgName ? (
          <span className="ml-2 rounded-full border border-[var(--brand-border)] bg-[var(--brand-surface)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--brand-muted)]">
            {orgName}
          </span>
        ) : null}
        <span aria-hidden className={`text-[10px] text-[var(--brand-muted)] transition ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-2 w-80 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] p-2 shadow-lg"
        >
          <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-widest text-[var(--brand-muted)]">
            Workspace
          </p>
          {shell?.org ? (
            <div className="flex items-center gap-3 rounded-md px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--brand-accent-soft)] font-display text-sm font-semibold text-[var(--brand-accent)]">
                {shell.org.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--brand-fg)]">
                  {shell.org.name}
                </div>
                <div className="text-[11px] text-[var(--brand-muted)]">
                  {ready.length} Service{ready.length === 1 ? '' : 's'} aktiv
                </div>
              </div>
            </div>
          ) : (
            <div className="px-3 py-2 text-sm text-[var(--brand-muted)]">
              {shell === null ? 'wird geladen…' : 'kein Workspace verfügbar'}
            </div>
          )}

          <hr className="my-1 border-[var(--brand-border)]" />

          <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-widest text-[var(--brand-muted)]">
            Apps
          </p>
          {ready.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[var(--brand-muted)]">
              Noch keine aktiven Services.
            </p>
          ) : (
            <ul className="space-y-1">
              {ready.map((b) => {
                const active = b.service === config.appKey
                return (
                  <li key={b.id}>
                    <a
                      href={b.url ?? '#'}
                      className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition hover:bg-[var(--brand-accent-soft)] ${
                        active ? 'bg-[var(--brand-accent-soft)]' : ''
                      }`}
                    >
                      <span className={active ? 'font-medium text-[var(--brand-accent)]' : 'text-[var(--brand-fg)]'}>
                        {b.label}
                      </span>
                      {active ? (
                        <span className="text-[9px] uppercase tracking-widest text-[var(--brand-accent)]">
                          aktuell
                        </span>
                      ) : null}
                    </a>
                  </li>
                )
              })}
            </ul>
          )}

          {provisioning.length > 0 ? (
            <>
              <p className="mt-3 px-3 pb-1 text-[10px] uppercase tracking-widest text-[var(--brand-muted)]">
                In Vorbereitung
              </p>
              <ul className="space-y-1">
                {provisioning.map((b) => (
                  <li key={b.id} className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-[var(--brand-muted)]">
                    <span>{b.label}</span>
                    <span className="text-[10px]">{STATUS_LABELS[b.status]}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <hr className="my-1 border-[var(--brand-border)]" />

          <a
            href={catalogUrl}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--brand-fg)] transition hover:bg-[var(--brand-accent-soft)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--brand-border)] text-[var(--brand-accent)]">＋</span>
            <span className="flex-1">
              <span className="block text-sm">Service buchen</span>
              <span className="block text-[11px] text-[var(--brand-muted)]">Plattform-Katalog</span>
            </span>
          </a>
        </div>
      ) : null}
    </div>
  )
}
