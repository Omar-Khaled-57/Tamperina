import { icons } from '../icons'
import { evaluationRows, normalizeDigits, rowCode, rowLabel, selectRow, subscribeRows } from './evaluation'
import { applyTranslations } from './i18n'

export interface FindBar {
  toggle(open?: boolean): void
  isOpen(): boolean
  destroy(): void
}

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void
  delete(name: string): void
}

function getHighlightRegistry(): HighlightRegistryLike | null {
  const css = CSS as unknown as { highlights?: HighlightRegistryLike }
  return css?.highlights ?? null
}

function normalizeText(value: string): string {
  return normalizeDigits(value).replace(/\s+/g, ' ').trim()
}

function textNodesIn(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node = walker.nextNode()
  while (node) {
    if ((node.textContent ?? '').length) nodes.push(node as Text)
    node = walker.nextNode()
  }
  return nodes
}

export function mountFindBar(shadow: ShadowRoot): FindBar {
  const bar = document.createElement('div')
  bar.className = 'find-bar'
  bar.hidden = true
  bar.innerHTML = `
    <div class="find-bar__row">
      <span class="find-bar__icon">${icons.search}</span>
      <input class="find-bar__input" type="search" data-i18n-placeholder="core.find.placeholder" data-i18n-aria="core.find.inputAria" autocomplete="off" spellcheck="false">
      <span class="find-bar__count" aria-live="polite">0/0</span>
      <button type="button" class="find-bar__btn" data-find-prev data-i18n-aria="core.find.prevAria" data-i18n-title="core.find.prevTitle">${icons.chevronUp}</button>
      <button type="button" class="find-bar__btn" data-find-next data-i18n-aria="core.find.nextAria" data-i18n-title="core.find.nextTitle">${icons.chevronDown}</button>
      <button type="button" class="find-bar__btn" data-find-case data-i18n-aria="core.find.matchCase" data-i18n-title="core.find.matchCase" aria-pressed="false">Aa</button>
      <button type="button" class="find-bar__btn" data-find-close data-i18n-aria="core.find.closeAria" data-i18n-title="core.find.closeTitle">${icons.close}</button>
    </div>
  `
  shadow.appendChild(bar)
  applyTranslations(bar)

  const input = bar.querySelector<HTMLInputElement>('.find-bar__input')!
  const count = bar.querySelector<HTMLElement>('.find-bar__count')!
  const caseBtn = bar.querySelector<HTMLButtonElement>('[data-find-case]')!
  const prevBtn = bar.querySelector<HTMLButtonElement>('[data-find-prev]')!
  const nextBtn = bar.querySelector<HTMLButtonElement>('[data-find-next]')!
  const closeBtn = bar.querySelector<HTMLButtonElement>('[data-find-close]')!

  let caseSensitive = false
  let matches: HTMLElement[] = []
  let current = -1
  let lastExactSelection = ''

  const registry = getHighlightRegistry()
  // Highlight styling must live in document.head: both ::highlight() and the
  // fallback classes target host-page nodes outside the shadow root. Inject it
  // unconditionally (idempotently) so the Custom Highlights path is themed too.
  const HIGHLIGHT_STYLE_ID = 'tamperina-find-highlight-style'
  let highlightStyle = document.getElementById(HIGHLIGHT_STYLE_ID) as HTMLStyleElement | null
  if (!highlightStyle) {
    highlightStyle = document.createElement('style')
    highlightStyle.id = HIGHLIGHT_STYLE_ID
    highlightStyle.textContent = [
      '::highlight(tamperina-find) { background: rgba(242,206,170,.35); }',
      '::highlight(tamperina-find-current) { background: rgba(242,206,170,.65); color: #17100b; }',
      '.tamperina-find-hit { background: rgba(242,206,170,.35) !important; }',
      '.tamperina-find-current { background: rgba(242,206,170,.65) !important; color: #17100b !important; }',
    ].join('\n')
    document.head.appendChild(highlightStyle)
  }

  function clearHighlights(): void {
    document.querySelectorAll('.tamperina-find-hit, .tamperina-find-current').forEach((el) => {
      el.classList.remove('tamperina-find-hit', 'tamperina-find-current')
    })
    try {
      registry?.delete('tamperina-find')
      registry?.delete('tamperina-find-current')
    } catch { /* custom highlight unsupported */ }
  }

  function highlightNode(ranges: Range[], node: Text, start: number, end: number): void {
    if (end <= start) return
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    ranges.push(range)
  }

  function applyHighlights(): void {
    clearHighlights()
    const query = input.value.trim()
    if (!query) return
    // Preserve whitespace here so highlight indices map directly onto the text node.
    const needle = normalizeDigits(query).trim()
    const rangesByRow = new Map<HTMLElement, Range[]>()
    for (const row of matches) {
      row.classList.add('tamperina-find-hit')
      const rowRanges: Range[] = []
      for (const node of textNodesIn(row)) {
        const text = normalizeDigits(node.textContent ?? '')
        if (!text) continue
        const haystack = caseSensitive ? text : text.toLowerCase()
        const target = caseSensitive ? needle : needle.toLowerCase()
        let from = 0
        let index: number
        while ((index = haystack.indexOf(target, from)) >= 0) {
          highlightNode(rowRanges, node, index, index + target.length)
          from = index + target.length
        }
      }
      if (rowRanges.length) rangesByRow.set(row, rowRanges)
    }

    // Two named highlights so the active occurrence is visually distinct from
    // the other matches (one shared name would paint them all identically).
    const currentRow = current >= 0 ? matches[current] : undefined
    const currentRanges = currentRow ? rangesByRow.get(currentRow) ?? [] : []
    const otherRanges: Range[] = []
    for (const [row, ranges] of rangesByRow) {
      if (row !== currentRow) otherRanges.push(...ranges)
    }
    if (registry) {
      try {
        const HighlightCtor = (window as unknown as { Highlight?: new (...items: Range[]) => unknown }).Highlight
        if (HighlightCtor) {
          if (otherRanges.length) registry.set('tamperina-find', new HighlightCtor(...otherRanges))
          else registry.delete('tamperina-find')
          if (currentRanges.length) {
            registry.set('tamperina-find-current', new HighlightCtor(...currentRanges))
          } else {
            registry.delete('tamperina-find-current')
          }
        }
      } catch { /* custom highlight unsupported */ }
    }
    if (currentRow) {
      currentRow.classList.add('tamperina-find-current')
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      currentRow.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
    }
  }

  function updateCount(): void {
    count.textContent = matches.length ? `${current >= 0 ? current + 1 : 0}/${matches.length}` : '0/0'
    prevBtn.disabled = nextBtn.disabled = matches.length < 2
  }

  function maybeAutoSelect(query: string): void {
    const digits = normalizeDigits(query)
    if (!/^\d{4}$/.test(digits)) {
      lastExactSelection = ''
      return
    }
    if (lastExactSelection === digits) return
    const row = evaluationRows().find((candidate) => rowCode(candidate) === digits)
    if (row) {
      lastExactSelection = digits
      selectRow(row)
    }
  }

  function exactMatch(): { row: HTMLElement, digits: string } | null {
    const digits = normalizeDigits(input.value.trim())
    if (!/^\d{4}$/.test(digits)) return null
    const row = evaluationRows().find((candidate) => rowCode(candidate) === digits)
    return row ? { row, digits } : null
  }

  /** Leave the find bar so the next keystrokes grade the selected student. */
  function handOffToStudent(match: { row: HTMLElement, digits: string }): void {
    lastExactSelection = match.digits
    selectRow(match.row)
    setOpen(false)
    // setOpen blurs the input; make sure focus lands on the page rather than
    // any leftover control so the student hotkeys see a non-editable target.
    document.body.focus?.()
  }

  function search(): void {
    const query = input.value.trim()
    maybeAutoSelect(query)
    if (!query) {
      matches = []
      current = -1
      clearHighlights()
      updateCount()
      return
    }
    const needle = normalizeText(query)
    const compare = (value: string) => caseSensitive ? value : value.toLowerCase()
    const target = compare(needle)
    const rows = evaluationRows()
    matches = rows.filter((row) => compare(normalizeText(rowLabel(row) + ' ' + (row.textContent ?? ''))).includes(target))
    current = matches.length ? 0 : -1
    applyHighlights()
    updateCount()
  }

  function move(direction: number): void {
    if (!matches.length) return
    current = (current + direction + matches.length) % matches.length
    matches[current].classList.add('tamperina-find-current')
    applyHighlights()
    updateCount()
    input.focus()
  }

  let hideTimer: number | undefined

  function setOpen(next: boolean): void {
    if (next) {
      if (hideTimer) {
        window.clearTimeout(hideTimer)
        hideTimer = undefined
      }
      bar.hidden = false
      requestAnimationFrame(() => {
        bar.classList.add('is-open')
        input.focus()
        input.select()
        search()
      })
    } else {
      if (bar.hidden && !bar.classList.contains('is-open')) return
      bar.classList.remove('is-open')
      clearHighlights()
      input.blur()
      if (hideTimer) window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => {
        bar.hidden = true
        hideTimer = undefined
      }, 220)
    }
  }

  input.addEventListener('input', () => {
    lastExactSelection = ''
    search()
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      // 1214 + Enter + 10 grades that student instead of extending the query.
      // Shift+Enter keeps the old "move between matches" behaviour.
      const match = exactMatch()
      if (!event.shiftKey && match) handOffToStudent(match)
      else move(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
  })
  prevBtn.addEventListener('click', () => move(-1))
  nextBtn.addEventListener('click', () => move(1))
  caseBtn.addEventListener('click', () => {
    caseSensitive = !caseSensitive
    caseBtn.setAttribute('aria-pressed', String(caseSensitive))
    search()
    input.focus()
  })
  closeBtn.addEventListener('click', () => setOpen(false))

  const unsubscribe = subscribeRows(() => {
    if (bar.classList.contains('is-open')) search()
  })

  return {
    toggle(open) {
      const shouldOpen = typeof open === 'boolean' ? open : !bar.classList.contains('is-open')
      setOpen(shouldOpen)
    },
    isOpen() {
      return bar.classList.contains('is-open')
    },
    destroy() {
      if (hideTimer) window.clearTimeout(hideTimer)
      unsubscribe()
      clearHighlights()
      highlightStyle?.remove()
      bar.remove()
    },
  }
}
