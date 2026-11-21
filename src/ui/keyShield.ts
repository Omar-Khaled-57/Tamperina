/**
 * Keep typing inside Tamperina's shadow UI working on the host platform.
 *
 * The platform runs a document-level barcode scanner that cancels printable
 * keys when it thinks no form field is focused. Key events from a shadow root
 * are retargeted to our host <div> before that handler sees them, so stopping
 * propagation inside the shadow is too late: only key repeats get through.
 * Exposing the deep focused field at capture time leaves propagation and the
 * browser's default text insertion intact while the scanner stands down.
 */

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Shortcuts that must still reach the document-level handlers from the modal. */
export function isGlobalShortcutKey(event: Event): boolean {
  if (!('key' in event)) return false
  const keyEvent = event as KeyboardEvent
  if (keyEvent.key === 'Escape') return true
  if (keyEvent.altKey && keyEvent.shiftKey && keyEvent.code === 'KeyT') return true
  if (keyEvent.ctrlKey && keyEvent.altKey && keyEvent.code === 'KeyF') return true
  if ((keyEvent.ctrlKey || keyEvent.metaKey) && !keyEvent.altKey) {
    return keyEvent.code === 'KeyZ' || keyEvent.code === 'KeyY'
  }
  return false
}

/** Install the capture shield once, before the platform installs its handlers. */
export function installKeyShield(hostId: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement')
  if (descriptor?.get) {
    const activeGetter = descriptor.get
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get() {
        const active = activeGetter.call(this) as HTMLElement | null
        if (active?.id !== hostId || !active.shadowRoot) return active
        const deep = active.shadowRoot.activeElement as HTMLElement | null
        return deep && isEditableTarget(deep) ? deep : active
      },
    })
  }

  for (const type of ['keydown', 'keypress', 'beforeinput', 'input'] as const) {
    window.addEventListener(type, (event) => {
      if (isGlobalShortcutKey(event)) return
      const path = event.composedPath()
      const host = path.find((node) => (node as Element)?.id === hostId) as HTMLElement | undefined
      const shadow = host?.shadowRoot
      if (!shadow) return
      const real = path[0]
      const field = isEditableTarget(real) ? real : shadow.activeElement
      if (!isEditableTarget(field)) return
      try {
        Object.defineProperty(event, 'target', { configurable: true, value: field })
        Object.defineProperty(event, 'srcElement', { configurable: true, value: field })
      } catch {
        // Some engines lock the event's target; the activeElement override
        // above still keeps the scanner from swallowing the keystroke.
      }
    }, true)
  }
}
