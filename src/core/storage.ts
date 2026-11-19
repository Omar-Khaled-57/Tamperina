import { GM_getValue, GM_setValue } from '$'

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
}

const STORAGE_KEY = 'tamperina.shell.v1'

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
}

function clampSize(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : SIZE_DEFAULT
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n / SIZE_STEP) * SIZE_STEP))
}

export function loadShell(): ShellState {
  try {
    const raw = GM_getValue<string | undefined>(STORAGE_KEY)
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw) as Partial<ShellState>
    return {
      ...defaults,
      ...parsed,
      size: clampSize(parsed.size),
      frame: parsed.frame === 2 || parsed.frame === 3 ? parsed.frame : 1,
    }
  } catch {
    return { ...defaults }
  }
}

export function saveShell(state: ShellState): void {
  try {
    GM_setValue(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage may be unavailable; the shell still works for this page load.
  }
}
