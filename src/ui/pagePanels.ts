import { isComprehensiveExamsPath } from '../core/examGuards'
import { getLocale } from '../core/i18n'

/**
 * Small in-page notices injected into the host platform (outside the shadow
 * DOM). Kept separate from the shell so placement rules can be tested without
 * mounting the whole UI.
 */

const HOLD_PANEL_ID = 'tamperina-whatsapp-hold'

export function ensurePagePanel(id: string): HTMLElement | null {
  const existing = document.getElementById(id)
  if (existing) return existing
  const panel = document.createElement('div')
  panel.id = id
  panel.hidden = true
  panel.dataset.locale = getLocale()
  panel.innerHTML = '<span><strong></strong><small></small></span><button type="button"></button>'
  ;(document.body || document.documentElement).appendChild(panel)
  return panel
}

export function ensureHoldPanel(): HTMLElement | null {
  return ensurePagePanel(HOLD_PANEL_ID)
}

export function setPagePanelText(panel: HTMLElement, title: string, detail: string, action: string): void {
  panel.dataset.locale = getLocale()
  const strong = panel.querySelector('strong')
  const small = panel.querySelector('small')
  const button = panel.querySelector('button')
  if (strong) strong.textContent = title
  if (small) small.textContent = detail
  if (button) button.textContent = action
}

/** Anchor the hold notice inside the exam work area; it scrolls with the page. */
export function placeHoldNotice(panel: HTMLElement, pathname: string): void {
  if (!isComprehensiveExamsPath(pathname)) return
  const anchor = document.querySelector<HTMLElement>('.work-panel[data-work-panel="attendance"] section.station')
    ?? document.querySelector<HTMLElement>('section.station')
    ?? document.querySelector<HTMLElement>('form#examScan')
  if (!anchor?.parentElement || anchor.previousElementSibling === panel) return
  anchor.parentElement.insertBefore(panel, anchor)
}
