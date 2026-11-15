/**
 * Light and dark colours of the shell components, from rflgd-base's app
 * palette (Tailwind 3 neutral and the `--brass-*` scale).
 *
 * Inline styles read `var(--rflgd-shell-<token>, <light value>)`, so the light
 * look needs no stylesheet (SSR, or an app without dark mode). Dark mode is a
 * `.dark` class on an ancestor, the platform's Tailwind `darkMode: 'class'`
 * convention: `ShellThemeStyle` sets the dark values on it. The brass tokens
 * follow the tenant palette through `--brass-*`.
 */
const LIGHT = {
  ink: '#2C1E14',
  'ink-tile': '#2C1E14',
  muted: '#7A6A58',
  faint: '#7A6A58',
  'brand-text': 'rgb(var(--brass-700, 125 85 26))',
  surface: '#FFFFFF',
  frame: 'color-mix(in srgb, var(--rflgd-brand-primary, #B09A6A) 16%, transparent)',
  line: 'color-mix(in srgb, var(--rflgd-brand-primary, #B09A6A) 12%, transparent)',
  'panel-shadow':
    '0 1px 0 color-mix(in srgb, var(--rflgd-brand-primary, #B09A6A) 8%, transparent), 0 24px 48px -20px rgba(58,40,12,0.35)',
  hairline: 'rgba(44,30,20,0.14)',
  hover: 'rgba(44,30,20,0.05)',
  current: 'color-mix(in srgb, var(--rflgd-brand-primary, #B09A6A) 15%, transparent)',
  chip: 'rgba(44,30,20,0.03)',
  'chip-ink': '#2C1E14',
  'chip-current-ink': 'rgb(var(--brass-700, 125 85 26))',
  avatar: '#fff',
  'avatar-ink': '#7A6A58',
  'plate-ink': 'rgb(var(--brass-700, 125 85 26))',
  plate: 'linear-gradient(180deg, #fffdf6 0%, #f7edd6 52%, #f0e2c2 100%)',
  'plate-shadow':
    'inset 0 1px 0 rgba(255,255,255,0.95), 0 0 0 1px rgba(125,85,26,0.13), 0 5px 12px -5px rgba(58,40,12,0.32)',
  danger: '#B0413A',
  badge: '#7D551A',
  'badge-ink': '#fff',
} as const

export type ShellToken = keyof typeof LIGHT

/** Base's `dark:` values: neutral-50 #fafafa, -100 #f5f5f5, -200 #e5e5e5, -400 #a3a3a3, -500 #737373, -700 #404040, -800 #262626, -900 #171717. */
const DARK: Record<ShellToken, string> = {
  ink: '#fafafa',
  'ink-tile': '#f5f5f5',
  muted: '#a3a3a3',
  faint: '#737373',
  'brand-text': 'rgb(var(--brass-300, 223 186 110))',
  surface: '#171717',
  frame: '#262626',
  line: '#262626',
  'panel-shadow': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  hairline: '#404040',
  hover: 'rgba(255,255,255,0.05)',
  current: 'rgb(var(--brass-900, 58 40 12) / 0.4)',
  chip: '#262626',
  'chip-ink': '#e5e5e5',
  'chip-current-ink': 'rgb(var(--brass-200, 234 210 154))',
  avatar: '#171717',
  'avatar-ink': '#737373',
  'plate-ink': 'rgb(var(--brass-200, 234 210 154))',
  plate: 'linear-gradient(180deg, #34291a 0%, #241d13 55%, #1a150e 100%)',
  'plate-shadow':
    'inset 0 1px 0 rgba(236,207,148,0.22), inset 0 -1px 0 rgba(0,0,0,0.5), 0 0 0 1px rgba(236,207,148,0.1), 0 2px 3px rgba(0,0,0,0.5), 0 10px 20px -8px rgba(0,0,0,0.75)',
  danger: '#f87171',
  badge: 'rgb(var(--brass-400, 214 166 76))',
  'badge-ink': '#171717',
}

/** The value for an inline style: the dark token when a `.dark` ancestor sets it, else the light value. */
export const shellColor = (token: ShellToken): string => `var(--rflgd-shell-${token}, ${LIGHT[token]})`

export const SHELL_THEME_CSS =
  `:where(.dark){${Object.entries(DARK)
    .map(([token, value]) => `--rflgd-shell-${token}:${value};`)
    .join('')}}` +
  // Base's `.dark .rflgd-glyph`: the emboss turns into a shadow seam.
  ':where(.dark) [data-rflgd-plate]>svg{filter:drop-shadow(0 1px 0 rgba(0,0,0,0.6))}'

/** Rendered by every coloured shell component; React hoists it into `<head>` once. */
export function ShellThemeStyle() {
  return (
    <style href="rflgd-shell-theme" precedence="rflgd-shell">
      {SHELL_THEME_CSS}
    </style>
  )
}
