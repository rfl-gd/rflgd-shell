import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AI_DISCLOSURE_FALLBACK, AiDisclosure } from './AiDisclosure'

const render = (props: Parameters<typeof AiDisclosure>[0]) => renderToStaticMarkup(createElement(AiDisclosure, props))

describe('AiDisclosure', () => {
  it('shows the fallback before any shell info has arrived', () => {
    expect(AI_DISCLOSURE_FALLBACK).toBe('KI-System der Reflagged GmbH')
    expect(render({ id: 'hint' })).toBe(`<p id="hint">${AI_DISCLOSURE_FALLBACK}</p>`)
  })

  it('shows a text handed in by the module', () => {
    expect(render({ id: 'hint', text: 'Sie interagieren mit KI' })).toContain('>Sie interagieren mit KI</p>')
  })

  it('keeps the fallback while the handed-in text is still loading', () => {
    expect(render({ id: 'hint', text: null })).toContain(`>${AI_DISCLOSURE_FALLBACK}</p>`)
  })

  it('passes className and style through for the module styling', () => {
    const html = render({ id: 'hint', className: 'text-xs', style: { color: 'gray' } })
    expect(html).toContain('class="text-xs"')
    expect(html).toContain('style="color:gray"')
  })
})
