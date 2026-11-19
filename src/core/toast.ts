import rina from 'virtual:tamperina-rina'
import { icons } from '../icons'

export type ToastVariant = 'applied' | 'undo' | 'redo' | 'error' | 'warning' | 'info'

export interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number
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

  impl = ({ title, description, variant = 'applied', duration = 5000 }) => {
    const el = document.createElement('div')
    el.className = `toast toast-${variant}`

    const icon = document.createElement('img')
    icon.className = 'toast-icon'
    icon.src = rina[variant] ?? rina.applied ?? rina.logo ?? ''
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
    close.title = 'إغلاق'
    close.setAttribute('aria-label', 'إغلاق')
    close.innerHTML = icons.close

    el.append(icon, content, close)
    container.appendChild(el)

    const items = Array.from(container.children)
    if (items.length > 3) items[0].remove()

    let dismissed = false
    let timer = 0
    const dismiss = () => {
      if (dismissed) return
      dismissed = true
      window.clearTimeout(timer)
      el.classList.add('leaving')
      window.setTimeout(() => el.remove(), 180)
    }
    timer = window.setTimeout(dismiss, duration)
    close.addEventListener('click', dismiss)
  }
}
