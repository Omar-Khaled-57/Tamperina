import { describe, expect, it } from 'vitest'
import { parseBridgeState } from '../src/core/remoteProtocol'

describe('parseBridgeState', () => {
  it('returns an empty state for untrusted garbage', () => {
    expect(parseBridgeState(undefined)).toEqual({ tabs: {}, requests: {} })
    expect(parseBridgeState('nope')).toEqual({ tabs: {}, requests: {} })
    expect(parseBridgeState({ tabs: [], requests: {} })).toEqual({ tabs: {}, requests: {} })
  })

  it('keeps valid targets and drops malformed ones', () => {
    const state = parseBridgeState({
      tabs: {
        good: { id: 'good', kinds: ['exam-attendance'], path: '/comprehensive-exams/16', seenAt: 1 },
        wrongId: { id: 'other', kinds: ['attendance'], path: '/', seenAt: 1 },
        badKind: { id: 'badKind', kinds: ['drop-tables'], path: '/', seenAt: 1 },
        badPath: { id: 'badPath', kinds: [], path: 5, seenAt: 1 },
      },
      requests: {},
    })
    expect(Object.keys(state.tabs)).toEqual(['good'])
    expect(state.tabs.good.kinds).toEqual(['exam-attendance'])
  })

  it('keeps valid requests, clamps their text, and rejects bad phases', () => {
    const state = parseBridgeState({
      tabs: {},
      requests: {
        req: {
          id: 'req',
          from: 'a',
          to: 'b',
          kind: 'exam-attendance',
          phase: 'run',
          text: 'x'.repeat(100_005),
          createdAt: 1,
          updatedAt: 2,
          status: 'pending',
          message: 'm'.repeat(1005),
          preview: { ready: 2, invalid: '1', needsDecision: 0 },
        },
        badPhase: {
          id: 'badPhase', from: 'a', to: 'b', kind: 'attendance', phase: 'nuke',
          text: '1234', createdAt: 1, updatedAt: 2, status: 'pending',
        },
      },
    })
    expect(Object.keys(state.requests)).toEqual(['req'])
    expect(state.requests.req.text).toHaveLength(100_000)
    expect(state.requests.req.message).toHaveLength(1000)
    expect(state.requests.req.preview).toEqual({ ready: 2, invalid: 1, needsDecision: 0 })
  })
})
