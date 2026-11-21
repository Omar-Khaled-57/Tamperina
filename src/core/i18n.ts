import { actionsMessages } from './i18n/actions'
import { bulkMessages } from './i18n/bulk'
import { shellMessages } from './i18n/shell'
import { uiTextMessages } from './i18n/uiText'

/**
 * Locale state and string lookup for Tamperina's own UI.
 *
 * Domain data that must match the Arabic host platform (grade keys, handwriting
 * status words, CSS selectors) is deliberately not translated here.
 */
export type Locale = 'ar' | 'en'

export const DEFAULT_LOCALE: Locale = 'ar'

export interface Message {
  ar: string
  en: string
}

const catalog = { ...shellMessages, ...uiTextMessages, ...bulkMessages, ...actionsMessages }

export type MessageKey = keyof typeof catalog

export type MessageVars = Record<string, string | number>

let currentLocale: Locale = DEFAULT_LOCALE
const localeListeners = new Set<() => void>()

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(locale: Locale): void {
  const next: Locale = locale === 'en' ? 'en' : 'ar'
  if (next === currentLocale) return
  currentLocale = next
  for (const listener of localeListeners) listener()
}

export function subscribeLocale(listener: () => void): () => void {
  localeListeners.add(listener)
  return () => { localeListeners.delete(listener) }
}

/** Locale-appropriate separator for values joined into a visible list. */
export function listSeparator(): string {
  return currentLocale === 'en' ? ', ' : '، '
}

function interpolate(text: string, vars?: MessageVars): string {
  if (!vars) return text
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  ))
}

/** Translate a catalog key into the active locale, with optional interpolation. */
export function t(key: MessageKey, vars?: MessageVars): string {
  const message: Message | undefined = catalog[key]
  const text = message ? message[currentLocale] : key
  return interpolate(text, vars)
}

/**
 * Apply translations to declarative markup: `data-i18n` sets textContent and
 * the other attributes map to their native counterparts. Used for static
 * shell/find-bar markup so a locale switch does not require rebuilding nodes.
 */
export function applyTranslations(root: ParentNode): void {
  const selectors = ['[data-i18n]', '[data-i18n-title]', '[data-i18n-aria]', '[data-i18n-placeholder]']
  root.querySelectorAll<HTMLElement>(selectors.join(', ')).forEach((el) => {
    if (el.dataset.i18n) el.textContent = t(el.dataset.i18n as MessageKey)
    if (el.dataset.i18nTitle) el.title = t(el.dataset.i18nTitle as MessageKey)
    if (el.dataset.i18nAria) el.setAttribute('aria-label', t(el.dataset.i18nAria as MessageKey))
    if (el.dataset.i18nPlaceholder) {
      (el as HTMLInputElement).placeholder = t(el.dataset.i18nPlaceholder as MessageKey)
    }
  })
}
