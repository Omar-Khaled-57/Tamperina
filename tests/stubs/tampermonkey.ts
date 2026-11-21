/** Minimal in-memory GM API for unit tests; aliased as `$` by vitest.config.ts. */
type ValueListener = (key: string, oldValue: unknown, newValue: unknown) => void

const store = new Map<string, unknown>()
const listeners = new Map<number, { key: string, listener: ValueListener }>()
let nextListenerId = 0

export function __resetTampermonkey(): void {
  store.clear()
  listeners.clear()
  nextListenerId = 0
}

export function GM_getValue<T>(key: string, fallback?: T): T {
  return store.has(key) ? store.get(key) as T : fallback as T
}

export function GM_setValue(key: string, value: unknown): void {
  const oldValue = store.get(key)
  store.set(key, value)
  for (const entry of listeners.values()) {
    if (entry.key === key) entry.listener(key, oldValue, value)
  }
}

export function GM_addValueChangeListener(key: string, listener: ValueListener): number {
  const id = ++nextListenerId
  listeners.set(id, { key, listener })
  return id
}

export function GM_removeValueChangeListener(id: number): void {
  listeners.delete(id)
}

export function GM_registerMenuCommand(): string {
  return ''
}

export function GM_unregisterMenuCommand(): void {}

export const unsafeWindow: Window & typeof globalThis = globalThis as Window & typeof globalThis
