import { icons } from '../icons'
import { evaluationRows, normalizeDigits, rowCode, rowLabel, selectRow, subscribeRows } from './evaluation'

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
      <input class="find-bar__input" type="search" placeholder="ابحث في الطلاب..." aria-label="البحث في التقييم" autocomplete="off" spellcheck="false">
      <span class="find-bar__count" aria-live="polite">0/0</span>
      <button type="button" class="find-bar__btn" data-find-prev aria-label="السابق" title="السابق (Shift+Enter)">${icons.chevronUp}</button>
      <button type="button" class="find-bar__btn" data-find-next aria-label="التالي" title="التالي (Enter)">${icons.chevronDown}</button>
      <button type="button" class="find-bar__btn" data-find-case aria-label="تطابق حالة الحروف" title="تطابق حالة الحروف" aria-pressed="false">Aa</button>
      <button type="button" class="find-bar__btn" data-find-close aria-label="إغلاق" title="إغلاق (Esc)">${icons.close}</button>
    </div>
  `
  shadow.appendChild(bar)

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
  if (!registry) {
    const style = document.createElement('style')
    style.textContent = '::highlight(tamperina-find) { background: rgba(242,206,170,.65); color: #17100b; }'
    document.head.appendChild(style)
  }

  function clearHighlights(): void {
    document.querySelectorAll('.tamperina-find-hit, .tamperina-find-current').forEach((el) => {
      el.classList.remove('tamperina-find-hit', 'tamperina-find-current')
    })
    try { registry?.delete('tamperina-find') } catch { /* custom highlight unsupported */ }
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
    const ranges: Range[] = []
    for (const row of matches) {
      row.classList.add('tamperina-find-hit')
      for (const node of textNodesIn(row)) {
        const text = normalizeDigits(node.textContent ?? '')
        if (!text) continue
        const haystack = caseSensitive ? text : text.toLowerCase()
        const target = caseSensitive ? needle : needle.toLowerCase()
        let from = 0
        let index: number
        while ((index = haystack.indexOf(target, from)) >= 0) {
          highlightNode(ranges, node, index, index + target.length)
          from = index + target.length
        }
      }
    }
    if (registry && ranges.length) {
      try {
        const HighlightCtor = (window as unknown as { Highlight?: new (...items: Range[]) => unknown }).Highlight
        if (HighlightCtor) registry.set('tamperina-find', new HighlightCtor(...ranges))
      } catch { /* custom highlight unsupported */ }
    }
    if (current >= 0 && matches[current]) {
      matches[current].classList.add('tamperina-find-current')
      matches[current].scrollIntoView({ block: 'center', behavior: 'smooth' })
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
      bar.remove()
    },
  }
}
