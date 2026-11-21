import { beforeEach, describe, expect, it } from 'vitest'
import { GM_setValue, __resetTampermonkey } from './stubs/tampermonkey'
import {
  loadShell,
  saveShell,
  SIZE_DEFAULT,
  SIZE_MAX,
  SIZE_MIN,
  type ShellState,
} from '../src/core/storage'

const KEY = 'tamperina.shell.v1'

function store(value: unknown): void {
  GM_setValue(KEY, JSON.stringify(value))
}

function defaults(): ShellState {
  return loadShell()
}

describe('loadShell', () => {
  beforeEach(() => __resetTampermonkey())

  it('returns safe defaults with all three new toggles off', () => {
    const state = defaults()
    expect(state.locale).toBe('ar')
    expect(state.examAttendanceStage).toBe(false)
    expect(state.holdWhatsappUntilApproved).toBe(false)
    expect(state.remoteBulk).toBe(false)
    expect(state.x).toBe(92)
    expect(state.y).toBe(88)
    expect(state.size).toBe(SIZE_DEFAULT)
  })

  it('falls back to defaults for missing, malformed, or non-object storage', () => {
    expect(defaults().locale).toBe('ar')
    GM_setValue(KEY, 'not json')
    expect(defaults().size).toBe(SIZE_DEFAULT)
    store(null)
    expect(defaults().locale).toBe('ar')
    store([])
    expect(defaults().activeTab).toBe('toggles')
  })

  it('clamps injected values instead of trusting persisted data', () => {
    store({
      x: 400,
      y: -20,
      size: 9999,
      frame: 9,
      activeTab: 'admin',
      locale: 'de',
      mirrored: 'true',
      paused: 1,
      locked: true,
      clickThrough: true,
    })
    const state = loadShell()
    expect(state.x).toBe(100)
    expect(state.y).toBe(0)
    expect(state.size).toBe(SIZE_MAX)
    expect(state.frame).toBe(1)
    expect(state.activeTab).toBe('toggles')
    expect(state.locale).toBe('ar')
    expect(state.mirrored).toBe(false)
    expect(state.paused).toBe(false)
    expect(state.locked).toBe(true)
    expect(state.clickThrough).toBe(true)
  })

  it('clamps minimal sizes up to the allowed minimum', () => {
    store({ size: 1 })
    expect(loadShell().size).toBe(SIZE_MIN)
  })

  it('migrates the legacy exam cleanup toggle to the editable stage', () => {
    store({ examAttendanceCleanup: true })
    expect(loadShell().examAttendanceStage).toBe(true)
  })

  it('lets the new key win over the legacy key', () => {
    store({ examAttendanceCleanup: true, examAttendanceStage: false })
    expect(loadShell().examAttendanceStage).toBe(false)
    store({ examAttendanceCleanup: false, examAttendanceStage: true })
    expect(loadShell().examAttendanceStage).toBe(true)
  })

  it('persists all three toggles through saveShell', () => {
    saveShell({ ...defaults(), examAttendanceStage: true, holdWhatsappUntilApproved: true, remoteBulk: true })
    expect(loadShell().examAttendanceStage).toBe(true)
    expect(loadShell().holdWhatsappUntilApproved).toBe(true)
    expect(loadShell().remoteBulk).toBe(true)
  })

  it('only accepts a literal true for remote bulk', () => {
    store({ remoteBulk: 'true' })
    expect(loadShell().remoteBulk).toBe(false)
    store({ remoteBulk: true })
    expect(loadShell().remoteBulk).toBe(true)
  })
})
