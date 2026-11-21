import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetTampermonkey } from './stubs/tampermonkey'
import { initRemoteBulk, type RemoteBulkBridge } from '../src/core/remoteBulk'

describe('initRemoteBulk', () => {
  let bridges: RemoteBulkBridge[] = []

  beforeEach(() => {
    __resetTampermonkey()
    bridges = []
  })

  afterEach(() => {
    for (const bridge of bridges) bridge.dispose()
  })

  it('discovers tabs advertised through JSON-serialized GM storage', () => {
    const source = initRemoteBulk(() => ['attendance'])
    const target = initRemoteBulk(() => ['evaluation'])
    bridges.push(source, target)

    const sourceTargets = source.targets()
    expect(sourceTargets).toHaveLength(1)
    expect(sourceTargets[0].id).toBe(target.selfId)
    expect(sourceTargets[0].kinds).toEqual(['evaluation'])

    const targetTargets = target.targets()
    expect(targetTargets).toHaveLength(1)
    expect(targetTargets[0].id).toBe(source.selfId)
    expect(targetTargets[0].kinds).toEqual(['attendance'])
  })

  it('round-trips a request and stores the target response', async () => {
    const source = initRemoteBulk(() => ['attendance'])
    const target = initRemoteBulk(() => ['attendance'])
    bridges.push(source, target)

    target.onRequest((request) => ({
      ...request,
      status: 'done' as const,
      preview: { ready: 2, invalid: 0, needsDecision: 0 },
    }))

    const pending = source.send({
      to: target.selfId,
      kind: 'attendance',
      phase: 'prepare',
      text: '1234',
    })
    // The test stub's change listener has no `remote` flag, so drive the
    // target's pending scan explicitly, just like its heartbeat timer does.
    target.refresh()
    const result = await pending

    expect(result.status).toBe('done')
    expect(result.preview).toEqual({ ready: 2, invalid: 0, needsDecision: 0 })
    expect(source.request(result.id)?.status).toBe('done')
  })
})
