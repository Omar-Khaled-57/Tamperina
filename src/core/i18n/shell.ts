import type { Message } from '../i18n'

/**
 * Shared, cross-area messages live here. The duplicate keys that used to be in
 * this fragment were removed in favour of the canonical `ui.common.*` /
 * `ui.toggle.english.*` / `core.toast.close` keys actually used by the UI.
 */
export const shellMessages = {} as const satisfies Record<string, Message>
