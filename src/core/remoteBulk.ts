import { GM_addValueChangeListener, GM_getValue, GM_removeValueChangeListener, GM_setValue } from '$'
import { parseBridgeState, type BridgeState } from './remoteProtocol'

/**
 * Cross-tab Tamperina bulk bridge.
 *
 * The tab that opens the Remote panel only orchestrates. A target tab registers
 * itself through GM values and executes the same local preview/arm/run pipeline
 * that its own panels use. Undo/redo therefore stays in the target tab, where
 * the write actually happens.
 */

export type RemoteBulkKind = 'attendance' | 'evaluation' | 'exam-attendance' | 'exam-evaluation'
export type RemoteBulkPhase = 'prepare' | 'arm' | 'run' | 'stop'
export type RemoteRequestStatus = 'pending' | 'done' | 'error'

export interface RemoteTarget {
  id: string
  kinds: RemoteBulkKind[]
  path: string
  seenAt: number
}

export interface RemotePreview {
  ready: number
  invalid: number
  needsDecision: number
}

export interface RemoteRequest {
  id: string
  from: string
  to: string
  kind: RemoteBulkKind
  phase: RemoteBulkPhase
  text: string
  createdAt: number
  updatedAt: number
  status: RemoteRequestStatus
  message?: string
  preview?: RemotePreview
}

export interface RemoteBulkBridge {
  readonly selfId: string
  targets(): RemoteTarget[]
  request(id: string): RemoteRequest | null
  send(request: Omit<RemoteRequest, 'id' | 'from' | 'createdAt' | 'updatedAt' | 'status'>): Promise<RemoteRequest>
  onRequest(handler: (request: RemoteRequest) => Promise<RemoteRequest> | RemoteRequest): () => void
  onChanged(handler: () => void): () => void
  respond(id: string, patch: Partial<Pick<RemoteRequest, 'status' | 'message' | 'preview'>>): void
  refresh(): void
  dispose(): void
}

const BRIDGE_KEY = 'tamperina.remoteBulk.v1'
const TAB_TTL_MS = 15_000
const HEARTBEAT_MS = 5_000
export const REQUEST_TIMEOUT_MS = 60_000
export const REQUEST_TIMEOUT_MESSAGE = 'Timed out waiting for the target tab'

function loadState(): BridgeState {
  try {
    const raw = GM_getValue<unknown>(BRIDGE_KEY)
    // GM storage keeps the JSON string written by saveState(); decode it before
    // validation so the bridge can actually see advertised tabs and requests.
    return parseBridgeState(typeof raw === 'string' ? JSON.parse(raw) as unknown : raw)
  } catch {
    return { tabs: {}, requests: {} }
  }
}

function saveState(state: BridgeState): void {
  try {
    GM_setValue(BRIDGE_KEY, JSON.stringify(state))
  } catch {
    // GM storage may be unavailable; the bridge simply stays idle.
  }
}

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

type RemoteRequestHandler = (request: RemoteRequest) => Promise<RemoteRequest> | RemoteRequest

export function initRemoteBulk(getKinds: () => RemoteBulkKind[]): RemoteBulkBridge {
  const selfId = makeId()
  // Exactly one tab-local handler may execute a bulk. Re-registering replaces it
  // so a stray second listener can never duplicate a write.
  let requestHandler: RemoteRequestHandler | null = null
  const changeHandlers = new Set<() => void>()
  let disposed = false
  const processing = new Set<string>()

  const processPending = (): void => {
    if (disposed || !requestHandler) return
    const state = loadState()
    for (const request of Object.values(state.requests)) {
      if (request.to !== selfId || request.status !== 'pending' || processing.has(request.id)) continue
      processing.add(request.id)
      void Promise.resolve()
        .then(() => (requestHandler ? requestHandler(request) : request))
        .catch((error: unknown) => ({
          ...request,
          status: 'error' as const,
          message: error instanceof Error ? error.message : String(error),
        }))
        .then((result) => {
          if (result.status !== 'pending') {
            const current = loadState()
            if (current.requests[result.id]) {
              current.requests[result.id] = { ...result, updatedAt: Date.now() }
              saveState(current)
            }
          }
        })
        .finally(() => {
          processing.delete(request.id)
        })
    }
  }

  const heartbeat = (): void => {
    if (disposed) return
    const now = Date.now()
    const state = loadState()
    for (const [id, tab] of Object.entries(state.tabs)) {
      if (now - tab.seenAt > TAB_TTL_MS) delete state.tabs[id]
    }
    for (const [id, request] of Object.entries(state.requests)) {
      // A pending request may outlive the heartbeat window while a target runs
      // a bulk. Only finished requests are safe to garbage-collect.
      if (request.status !== 'pending' && now - request.updatedAt > TAB_TTL_MS) delete state.requests[id]
    }
    state.tabs[selfId] = {
      id: selfId,
      kinds: getKinds(),
      path: `${location.pathname}${location.search}`,
      seenAt: now,
    }
    saveState(state)
    for (const handler of changeHandlers) handler()
    processPending()
  }

  heartbeat()
  const timer = window.setInterval(heartbeat, HEARTBEAT_MS)

  let listenerToken: string | number | null = null
  try {
    listenerToken = GM_addValueChangeListener(BRIDGE_KEY, (_key, _oldValue, _newValue, remote) => {
      if (!remote) return
      for (const handler of changeHandlers) handler()
      processPending()
    })
  } catch {
    listenerToken = null
  }

  const bridge: RemoteBulkBridge = {
    selfId,
    targets() {
      const now = Date.now()
      return Object.values(loadState().tabs)
        .filter((tab) => tab.id !== selfId && now - tab.seenAt <= TAB_TTL_MS)
        .sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id))
    },
    request(id) {
      return loadState().requests[id] ?? null
    },
    async send(input) {
      const state = loadState()
      const id = makeId()
      const now = Date.now()
      const request: RemoteRequest = {
        ...input,
        id,
        from: selfId,
        createdAt: now,
        updatedAt: now,
        status: 'pending',
      }
      state.requests[id] = request
      saveState(state)
      for (const handler of changeHandlers) handler()

      const deadline = Date.now() + REQUEST_TIMEOUT_MS
      while (Date.now() < deadline) {
        await wait(150)
        const current = loadState().requests[id]
        if (!current || current.status !== 'pending') return current ?? request
      }
      bridge.respond(id, { status: 'error', message: REQUEST_TIMEOUT_MESSAGE })
      return loadState().requests[id] ?? request
    },
    onRequest(handler) {
      requestHandler = handler
      processPending()
      return () => {
        if (requestHandler === handler) requestHandler = null
      }
    },
    onChanged(handler) {
      changeHandlers.add(handler)
      return () => changeHandlers.delete(handler)
    },
    respond(id, patch) {
      const state = loadState()
      const current = state.requests[id]
      if (!current) return
      state.requests[id] = { ...current, ...patch, updatedAt: Date.now() }
      saveState(state)
      for (const handler of changeHandlers) handler()
    },
    refresh: heartbeat,
    dispose() {
      disposed = true
      window.clearInterval(timer)
      if (listenerToken != null) {
        try {
          if (typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(listenerToken)
        } catch { /* ignore */ }
      }
      const state = loadState()
      delete state.tabs[selfId]
      saveState(state)
    },
  }
  return bridge
}
