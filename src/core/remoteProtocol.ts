import type {
  RemoteBulkKind,
  RemoteBulkPhase,
  RemoteRequest,
  RemoteRequestStatus,
  RemoteTarget,
} from './remoteBulk'

export interface BridgeState {
  tabs: Record<string, RemoteTarget>
  requests: Record<string, RemoteRequest>
}

const MAX_TEXT = 100_000
const MAX_MESSAGE = 1_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isKind(value: unknown): value is RemoteBulkKind {
  return value === 'attendance' || value === 'evaluation'
    || value === 'exam-attendance' || value === 'exam-evaluation'
}

function isPhase(value: unknown): value is RemoteBulkPhase {
  return value === 'prepare' || value === 'arm' || value === 'run' || value === 'stop'
}

function isStatus(value: unknown): value is RemoteRequestStatus {
  return value === 'pending' || value === 'done' || value === 'error'
}

/** Validate all cross-tab state before it can drive a local bulk. */
export function parseBridgeState(raw: unknown): BridgeState {
  const empty: BridgeState = { tabs: {}, requests: {} }
  if (!isRecord(raw) || !isRecord(raw.tabs) || !isRecord(raw.requests)) return empty

  const tabs: Record<string, RemoteTarget> = {}
  for (const [id, value] of Object.entries(raw.tabs)) {
    if (!isRecord(value) || typeof value.id !== 'string' || value.id !== id) continue
    if (!Array.isArray(value.kinds) || !value.kinds.every(isKind)) continue
    if (typeof value.path !== 'string' || typeof value.seenAt !== 'number') continue
    tabs[id] = {
      id,
      kinds: [...value.kinds],
      path: value.path.slice(0, MAX_TEXT),
      seenAt: value.seenAt,
    }
  }

  const requests: Record<string, RemoteRequest> = {}
  for (const [id, value] of Object.entries(raw.requests)) {
    if (!isRecord(value) || typeof value.id !== 'string' || value.id !== id) continue
    if (typeof value.from !== 'string' || typeof value.to !== 'string') continue
    if (!isKind(value.kind) || !isPhase(value.phase) || typeof value.text !== 'string') continue
    if (typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') continue
    if (!isStatus(value.status)) continue
    requests[id] = {
      id,
      from: value.from,
      to: value.to,
      kind: value.kind,
      phase: value.phase,
      text: value.text.slice(0, MAX_TEXT),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      status: value.status,
      ...(typeof value.message === 'string' ? { message: value.message.slice(0, MAX_MESSAGE) } : {}),
      ...(isRecord(value.preview)
        ? {
          preview: {
            ready: Number(value.preview.ready) || 0,
            invalid: Number(value.preview.invalid) || 0,
            needsDecision: Number(value.preview.needsDecision) || 0,
          },
        }
        : {}),
    }
  }
  return { tabs, requests }
}
