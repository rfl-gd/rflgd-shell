'use client'

import {
  AudioLines,
  Bot,
  Box,
  Brain,
  Contact,
  Factory,
  ListMusic,
  MailPlus,
  MessageSquareText,
  PenTool,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'

/**
 * The icon a service shows in the app switcher.
 *
 * Which icon a service gets is rflgd-base's decision — it sends the lucide
 * name in `/api/shell/me` (`serviceIconName()`), so switcher, launchpad and
 * catalog show the same mark. This file only holds the components to render
 * those names with.
 *
 * Listed one by one rather than looked up in lucide's `icons` object, and that
 * is the whole reason this file exists: an index lookup defeats tree shaking,
 * and all ~1500 icons would land in the bundle of every app using this
 * package. Ten repositories depend on it.
 *
 * The cost is a list that can fall behind the platform's. It degrades to
 * exactly today's behaviour — a service whose name is not here shows its
 * initial, as every service did before. Nothing breaks, it just looks
 * unfinished, and adding the icon here is a one-line fix.
 */
const ICONS: Record<string, LucideIcon> = {
  AudioLines,
  Bot,
  Box,
  Brain,
  Contact,
  Factory,
  ListMusic,
  MailPlus,
  MessageSquareText,
  PenTool,
  ShieldCheck,
  Users,
}

export function ServiceIcon({
  name,
  label,
  size = 18,
}: {
  /** Lucide name from the platform, e.g. 'Brain'. */
  name?: string | null
  /** Fallback when the name is missing or not bundled here. */
  label: string
  size?: number
}) {
  const Icon = name ? ICONS[name] : undefined
  if (!Icon) return <>{label.slice(0, 1).toUpperCase()}</>
  return <Icon size={size} strokeWidth={1.75} aria-hidden />
}
