import { GM_getValue, GM_setValue } from '$'
import type { Locale } from './i18n'

export const SIZE_MIN = 64
export const SIZE_MAX = 240
export const SIZE_STEP = 12
export const SIZE_DEFAULT = 120

/** The three frozen poses shown when the idle animation is paused. */
export type Frame = 1 | 2 | 3

export interface ShellState {
  /** Position as a percentage of the viewport, so it survives resizes. */
  x: number
  y: number
  /** Mascot size in pixels (snapped to SIZE_STEP). */
  size: number
  mirrored: boolean
  paused: boolean
  /** Which pose is held while paused: +10°, −10°, or upright (0°). */
  frame: Frame
  locked: boolean
  clickThrough: boolean
  activeTab: 'toggles' | 'bulk'
  /** Tamperina UI language; the host platform stays Arabic. */
  locale: Locale
  /** Reveal the editable exam-attendance stage on any /comprehensive-exams/<id> page. */
  examAttendanceStage: boolean
  /** Pause the WhatsApp worker until the user presses Tamperina's release button. */
  holdWhatsappUntilApproved: boolean
  /** Route bulk actions through another tab instead of the current page. */
  remoteBulk: boolean
}

export const SHELL_KEY = 'tamperina.shell.v1'

const defaults: ShellState = {
  x: 92,
  y: 88,
  size: SIZE_DEFAULT,
  mirrored: false,
  paused: false,
  frame: 1,
  locked: false,
  clickThrough: false,
  activeTab: 'toggles',
  locale: 'ar',
  examAttendanceStage: false,
  holdWhatsappUntilApproved: false,
  remoteBulk: false,
}

function clampSize(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : SIZE_DEFAULT
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n / SIZE_STEP) * SIZE_STEP))
}

/** Position percentages must be finite numbers in [0, 100]. */
function clampPercent(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : fallback
}

/** Only literal `true` enables a persisted boolean; anything else is false. */
function bool(value: unknown): boolean {
  return value === true
}

export function loadShell(): ShellState {
  try {
    const raw = GM_getValue<string | undefined>(SHELL_KEY)
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw) as Partial<ShellState> | null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...defaults }
    // The old delete-scaffold key is migrated so an enabled toggle keeps its
    // meaning as the new editable staging panel.
    const legacy = parsed as Partial<ShellState> & { examAttendanceCleanup?: unknown }
    // Build from the parsed object explicitly: spreading unvalidated storage
    // values would let a corrupted/foreign record inject arbitrary CSS values
    // through the inline `left`/`top` styles in the shell renderer.
    return {
      x: clampPercent(parsed.x, defaults.x),
      y: clampPercent(parsed.y, defaults.y),
      size: clampSize(parsed.size),
      mirrored: bool(parsed.mirrored),
      paused: bool(parsed.paused),
      frame: parsed.frame === 2 || parsed.frame === 3 ? parsed.frame : 1,
      locked: bool(parsed.locked),
      clickThrough: bool(parsed.clickThrough),
      activeTab: parsed.activeTab === 'bulk' ? 'bulk' : 'toggles',
      locale: parsed.locale === 'en' ? 'en' : 'ar',
      examAttendanceStage: bool(parsed.examAttendanceStage ?? legacy.examAttendanceCleanup),
      holdWhatsappUntilApproved: bool(parsed.holdWhatsappUntilApproved),
      remoteBulk: bool(parsed.remoteBulk),
    }
  } catch {
    return { ...defaults }
  }
}

export function saveShell(state: ShellState): void {
  try {
    GM_setValue(SHELL_KEY, JSON.stringify(state))
  } catch {
    // Storage may be unavailable; the shell still works for this page load.
  }
}
