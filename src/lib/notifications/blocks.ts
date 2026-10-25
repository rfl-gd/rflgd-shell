/**
 * Content blocks for platform mails (`notify({ blocks })`).
 *
 * A module describes WHAT a mail says — a status, facts, a conversation, a
 * table — and the base decides HOW it looks: colours, fonts, logo and layout
 * come from the tenant's branding. There is no HTML and no style property;
 * text is always literal (`**x**` stays `**x**`), emphasis and links go into
 * spans.
 *
 * Validated by the base (rflgd-base `src/lib/notifications/blocks/schema.ts`);
 * an invalid block answers 400 with the path of the offending field.
 *
 * Limits: 200 top-level blocks, 100 kB as JSON, `section`/`row` nested at most
 * three levels. Links: https, `tel:` or `mailto:`. Images: https on a domain of
 * the booking or the tenant (anything else would be a tracking pixel).
 */

/** A run of text with optional emphasis or a link. */
export type Span = {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  /** https://…, tel:+49…, mailto:… */
  href?: string
}

/** Plain text, or spans for emphasis and links. Line breaks are kept. */
export type RichText = string | Span[]

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
export type Align = 'left' | 'center' | 'right'

export type HeadingBlock = { type: 'heading'; text: RichText; level?: 1 | 2 | 3 }
export type TextBlock = {
  type: 'text'
  text: RichText
  size?: 'sm' | 'md' | 'lg'
  muted?: boolean
  align?: Align
}
export type ButtonBlock = {
  type: 'button'
  label: string
  url: string
  variant?: 'primary' | 'secondary'
  align?: Align
}
export type ImageBlock = {
  type: 'image'
  /** https on a domain of the booking or the tenant. PNG/JPEG/GIF render everywhere. */
  src: string
  alt: string
  /** CSS pixels, 16–600; scales down on narrow screens. */
  width?: number
  href?: string
  align?: Align
}
export type DividerBlock = { type: 'divider' }
export type SpacerBlock = { type: 'spacer'; size?: 'sm' | 'md' | 'lg' }
/** Status banner: "Rückruf nötig", "Freigabe abgelehnt", … */
export type CalloutBlock = { type: 'callout'; tone: Tone; title?: string; text?: RichText }
/** Label/value pairs, e.g. caller, number, duration. */
export type FactsBlock = { type: 'facts'; items: { label: string; value: RichText }[] }
export type ListBlock = { type: 'list'; items: RichText[]; ordered?: boolean }
export type TableBlock = {
  type: 'table'
  columns: { label: string; align?: Align }[]
  rows: RichText[][]
}
export type QuoteBlock = { type: 'quote'; text: RichText; cite?: string }
export type ConversationBlock = {
  type: 'conversation'
  messages: {
    speaker: string
    text: RichText
    /** `end` marks the module's own side (agent, bot, colleague). */
    side?: 'start' | 'end'
    time?: string
  }[]
}
export type CodeBlock = { type: 'code'; code: string; language?: string }
/** Groups blocks under an optional title, plain, on a muted ground or outlined. */
export type SectionBlock = {
  type: 'section'
  title?: string
  tone?: 'plain' | 'muted' | 'outlined'
  blocks: Block[]
}
/** 2–4 columns side by side; `width` in percent. */
export type RowBlock = { type: 'row'; columns: { width?: number; blocks: Block[] }[] }

export type Block =
  | HeadingBlock
  | TextBlock
  | ButtonBlock
  | ImageBlock
  | DividerBlock
  | SpacerBlock
  | CalloutBlock
  | FactsBlock
  | ListBlock
  | TableBlock
  | QuoteBlock
  | ConversationBlock
  | CodeBlock
  | SectionBlock
  | RowBlock
