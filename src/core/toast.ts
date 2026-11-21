import rina from 'virtual:tamperina-rina'
import { icons } from '../icons'
import { t } from './i18n'

export type ToastVariant = 'applied' | 'undo' | 'redo' | 'error' | 'warning' | 'info'

/** Match toast states to the sticker art currently shipped in public/rina/. */
const toastSticker: Record<ToastVariant, string> = {
  applied: 'applied',
  undo: 'note',
  redo: 'thumb',
  error: 'err',
  warning: 'limited',
  info: 'note',
}

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number
  /** Optional one-click handoff (e.g. copy new codes). Dismisses after firing. */
  action?: ToastAction
}

type ToastImpl = (options: ToastOptions) => void

let impl: ToastImpl = () => {}

/** Public toast function — safe to call before the shell is mounted. */
export function toast(options: ToastOptions): void {
  impl(options)
}

export function attachToaster(shadow: ShadowRoot): void {
  let container = shadow.querySelector<HTMLElement>('.toasts')
  if (!container) {
    container = document.createElement('div')
    container.className = 'toasts'
    container.setAttribute('aria-live', 'polite')
    container.setAttribute('aria-relevant', 'additions')
    shadow.appendChild(container)
  }

  // Dismiss callbacks keyed by node so an evicted toast's timer is cancelled
  // instead of later firing against a detached element.
  const dismissers = new WeakMap<HTMLElement, () => void>()

  impl = ({ title, description, variant = 'applied', duration = 5000, action }) => {
    const actionHandler = action?.onClick
    const el = document.createElement('div')
    el.className = `toast toast-${variant}`

    const icon = document.createElement('img')
    icon.className = 'toast-icon'
    icon.src = rina[toastSticker[variant]] ?? rina.applied ?? rina.logo ?? ''
    icon.alt = ''
    icon.setAttribute('aria-hidden', 'true')
    icon.draggable = false

    const content = document.createElement('div')
    content.className = 'toast-content'
    const heading = document.createElement('strong')
    heading.textContent = title
    content.appendChild(heading)
    if (description) {
      const sub = document.createElement('small')
      sub.textContent = description
      content.appendChild(sub)
    }

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'toast-close'
    // Declarative attributes let applyTranslations(shadow) refresh toasts that
    // are still on screen when the locale switch happens.
    close.dataset.i18nTitle = 'core.toast.close'
    close.dataset.i18nAria = 'core.toast.close'
    close.title = t('core.toast.close')
    close.setAttribute('aria-label', t('core.toast.close'))
    close.innerHTML = icons.close

    let actionBtn: HTMLButtonElement | null = null
    if (action) {
      actionBtn = document.createElement('button')
      actionBtn.type = 'button'
      actionBtn.className = 'toast-action'
      actionBtn.textContent = action.label
    }

    el.append(icon, content)
    if (actionBtn) el.append(actionBtn)
    el.append(close)
    container.appendChild(el)

    const items = Array.from(container.children)
    if (items.length > 3) {
      const oldest = items[0] as HTMLElement
      dismissers.get(oldest)?.()
      oldest.remove()
    }

    let dismissed = false
    let timer = 0
    const dismiss = () => {
      if (dismissed) return
      dismissed = true
      window.clearTimeout(timer)
      el.classList.add('leaving')
      window.setTimeout(() => el.remove(), 180)
    }
    dismissers.set(el, dismiss)
    timer = window.setTimeout(dismiss, duration)
    close.addEventListener('click', dismiss)
    if (actionBtn && actionHandler) {
      actionBtn.addEventListener('click', () => {
        try {
          actionHandler()
        } finally {
          dismiss()
        }
      })
    }
  }
}
