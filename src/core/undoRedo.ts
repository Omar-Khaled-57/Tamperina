import { GM_getValue, GM_setValue, unsafeWindow } from '$'
import { getLocale, listSeparator, t } from './i18n'
import { toast } from './toast'

/**
 * Undo/Redo for actions we can reverse with a real API call.
 *
 * M1 scope: attendance on /attendance/scan and grading on /evaluation.
 * Grading writes are inferred from their request body and replayed with the
 * previously saved values, so no server-specific endpoint needs to be hardcoded.
 */

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface HttpCommand {
  method: HttpMethod
  url: string
  body?: Record<string, unknown>
  headers?: Record<string, string>
}

export interface LiveRecord {
  id: string
  name?: string
  username?: string
  studentCode?: string
  lessonId?: number | string | null
  source?: string
}

interface BeforeSnapshot {
  recordIds: Set<string>
  record?: LiveRecord | null
  headers?: Record<string, string>
}

interface GradeField {
  name: string
  type: string
  value: string
  checked?: boolean
}

interface GradeSnapshot {
  key: string
  code: string
  label: string
  fields: GradeField[]
  score?: string
  grade?: string
}

export interface SerializedActionBase {
  id: string
  title: string
  detail: string
  at: number
  warning?: string
}

export type SerializedAction = SerializedActionBase & (
  | { kind: 'attendance-add', record: LiveRecord, headers?: Record<string, string> }
  | { kind: 'attendance-remove', record: LiveRecord, headers?: Record<string, string> }
  | { kind: 'grade', command: HttpCommand, before: GradeSnapshot, after: GradeSnapshot }
  | { kind: 'batch', title: string, detail: string, actions: SerializedAction[] }
)

export interface HistoryAction {
  id: string
  title: string
  detail: string
  at: number
  undo: () => Promise<HistoryAction>
  redo: () => Promise<HistoryAction>
  /** Set when a batch finished but some of its items could not be reversed. */
  warning?: string
  /** Serializable form used to restore history after a reload or navigation. */
  readonly serialized: SerializedAction
}

export interface UndoRedoDebugObservation {
  at: number
  method: string
  path: string
  keys: string[]
  grade: boolean
  reason?: string
}

export interface UndoRedoDebug {
  version: string
  path: string
  supported: boolean
  enabled: boolean
  batching: boolean
  batchCount: number
  canUndo: boolean
  canRedo: boolean
  historyCount: number
  gradeBaselineCount: number
  hasTouchedGradeRow: boolean
  observed: UndoRedoDebugObservation[]
}

export interface AttendanceEvent {
  type: 'add' | 'remove' | 'duplicate'
  record: LiveRecord
}

export interface UndoRedoController {
  readonly version: string
  readonly supported: boolean
  readonly enabled: boolean
  readonly busy: boolean
  readonly batching: boolean
  readonly batchCount: number
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly history: readonly HistoryAction[]
  readonly knownRecordCodes: readonly string[]
  /** Codes already recorded for one specific lesson (records without a lesson are included). */
  knownRecordCodesForLesson(lessonId: string): string[]
  /** Cached attendance records for export (id, student code, name, lesson). */
  readonly attendanceRecords: readonly LiveRecord[]
  readonly lessonId: string | null
  setEnabled(enabled: boolean): void
  undo(): Promise<void>
  redo(): Promise<void>
  beginBatch(title: string): void
  commitBatch(options?: { title?: string, detail?: string }): HistoryAction | null
  /** Record an attendance add explicitly; deduplicated against the network observer. */
  ensureAttendanceRecorded(record: LiveRecord, headers?: Record<string, string>): void
  /** Load the attendance records currently stored for a lesson. */
  refreshAttendanceLesson(lessonId: string): Promise<LiveRecord[]>
  /** Delete one attendance record and record the removal for undo/redo. */
  deleteAttendanceRecord(record: LiveRecord, headers?: Record<string, string>): Promise<void>
  /** Capture the saved grade values before Tamperina changes a row's grade. */
  captureGradeBaseline(row: HTMLElement): void
  subscribe(listener: () => void): () => void
  onAttendance(listener: (event: AttendanceEvent) => void): () => void
  debug(): UndoRedoDebug
}

const SUPPORTED_PATHS = new Set(['/attendance/scan', '/evaluation'])
const EXAM_PAGE_RE = /^\/comprehensive-exams\/\d+$/
const EXAM_CHECKIN_RE = /^\/comprehensive-exams\/\d+\/check-in$/
const GRADE_ROWS_SELECTOR = '.evaluation-table tbody tr, [data-grade-row]'
const GRADE_PAGE_RE = /^\/(?:evaluation|comprehensive-exams\/\d+)$/
const ENABLED_KEY = 'tamperina.feature.undoRedo.enabled.v1'
const CONTROLLER_VERSION = 'v3'
const CONTROLLER_KEY = `__tamperinaUndoRedoController_${CONTROLLER_VERSION}`
const HOOKS_KEY = `__tamperinaUndoRedoHooks_${CONTROLLER_VERSION}`
const SESSION_KEY = 'tamperina.undoRedo.session.v1'

interface PersistedState {
  past: SerializedAction[]
  future: SerializedAction[]
  records: LiveRecord[]
  gradeBaselines: GradeSnapshot[]
  recordedAttendanceIds: string[]
  currentLessonId: string | null
}

function sessionStore(): Storage | null {
  try {
    return (unsafeWindow ?? window).sessionStorage ?? null
  } catch {
    return null
  }
}

const ACTION_KINDS = new Set(['attendance-add', 'attendance-remove', 'grade', 'batch'])
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isValidLiveRecord(value: unknown): value is LiveRecord {
  return isPlainObject(value) && typeof value.id === 'string'
}

function isValidGradeSnapshot(value: unknown): value is GradeSnapshot {
  if (!isPlainObject(value)) return false
  if (typeof value.key !== 'string' || typeof value.code !== 'string') return false
  if (!Array.isArray(value.fields)) return false
  return value.fields.every((field) => {
    if (!isPlainObject(field)) return false
    return typeof field.name === 'string' && typeof field.type === 'string'
      && typeof field.value === 'string'
      && (field.checked === undefined || typeof field.checked === 'boolean')
  })
}

function isValidHttpCommand(value: unknown): value is HttpCommand {
  if (!isPlainObject(value)) return false
  if (typeof value.url !== 'string' || typeof value.method !== 'string') return false
  if (!HTTP_METHODS.has(value.method)) return false
  if (value.body != null && !isPlainObject(value.body)) return false
  if (value.headers != null && !isPlainObject(value.headers)) return false
  return true
}

/**
 * sessionStorage is page-writable and survives script upgrades, so a restored
 * history can contain malformed actions. Validate the full shape recursively
 * before reviving; `reviveAction()` only checks the outer shape, and a bad
 * nested `fields`/`body` would otherwise throw later at replay time.
 */
function isValidSerializedAction(value: unknown): value is SerializedAction {
  if (!isPlainObject(value)) return false
  if (typeof value.id !== 'string' || typeof value.at !== 'number') return false
  const kind = value.kind
  if (typeof kind !== 'string' || !ACTION_KINDS.has(kind)) return false
  if (kind === 'batch') {
    return Array.isArray(value.actions) && value.actions.every(isValidSerializedAction)
  }
  if (kind === 'attendance-add' || kind === 'attendance-remove') {
    return isValidLiveRecord(value.record)
  }
  // grade
  return isValidHttpCommand(value.command)
    && isValidGradeSnapshot(value.before)
    && isValidGradeSnapshot(value.after)
}

function loadPersistedState(): PersistedState | null {
  try {
    const raw = sessionStore()?.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    if (!Array.isArray(parsed.past) || !Array.isArray(parsed.future)) return null
    return {
      past: parsed.past,
      future: parsed.future,
      records: Array.isArray(parsed.records) ? parsed.records : [],
      gradeBaselines: Array.isArray(parsed.gradeBaselines) ? parsed.gradeBaselines : [],
      recordedAttendanceIds: Array.isArray(parsed.recordedAttendanceIds) ? parsed.recordedAttendanceIds : [],
      currentLessonId: parsed.currentLessonId ?? null,
    }
  } catch {
    return null
  }
}

const LEGACY_CONTROLLER_KEYS = [
  '__tamperinaUndoRedoControllerV1',
  '__tamperinaUndoRedoController_v2',
]

const page = (unsafeWindow ?? window) as unknown as Window & Record<string, unknown>

let controller: UndoRedoController | undefined

function normalisePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

function isExamPage(): boolean {
  return EXAM_PAGE_RE.test(normalisePath(location.pathname))
}

function isGradePage(): boolean {
  return normalisePath(location.pathname) === '/evaluation' || isExamPage()
}

function isSupportedPage(): boolean {
  const path = normalisePath(location.pathname)
  return SUPPORTED_PATHS.has(path) || isExamPage()
}

function loadEnabled(): boolean {
  try {
    const value = GM_getValue<boolean | undefined>(ENABLED_KEY)
    return value !== false
  } catch {
    return true
  }
}

function saveEnabled(enabled: boolean): void {
  try {
    GM_setValue(ENABLED_KEY, enabled)
  } catch {
    // Feature still works for this page load when storage is unavailable.
  }
}

function absoluteUrl(pathname: string): string {
  return new URL(pathname, location.origin).href
}

function parseJson(text: string | null | undefined): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseBody(body: unknown): unknown {
  if (body == null) return undefined
  if (typeof body === 'string') return parseJson(body) ?? body
  if (typeof (body as URLSearchParams).forEach === 'function') {
    const entries: Record<string, string> = {}
    ;(body as URLSearchParams).forEach((value, key) => { entries[key] = value })
    return entries
  }
  if (typeof (body as FormData).entries === 'function') {
    return Object.fromEntries(Array.from((body as FormData).entries()))
  }
  return undefined
}

function encodeBody(body: Record<string, unknown>, headers?: Record<string, string>): string {
  const contentTypeKey = Object.keys(headers ?? {}).find((key) => key.toLowerCase() === 'content-type')
  const contentType = String(contentTypeKey ? headers?.[contentTypeKey] : '').toLowerCase()
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(body)) {
      if (value == null) continue
      params.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
    }
    return params.toString()
  }
  return JSON.stringify(body)
}

/** Keep only CSRF/axios markers so synthetic writes are accepted, never credentials. */
function replayHeaders(value: unknown): Record<string, string> {
  if (!value) return {}
  const entries: Array<[string, unknown]> = []
  const iterable = value as { forEach?: (fn: (item: unknown, key: string) => void) => void }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (Array.isArray(item) && item.length >= 2) entries.push([String(item[0]), item[1]])
    }
  } else if (typeof iterable.forEach === 'function') {
    iterable.forEach((item, key) => {
      const pair = item as { name?: unknown, value?: unknown }
      entries.push([String(key), Array.isArray(item) ? item[1] : pair.value ?? item])
    })
  } else if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) entries.push([key, item])
  }

  // Only replay CSRF/axios markers. Never copy cookies or bearer tokens into history.
  const allowed = new Set(['x-csrf-token', 'x-xsrf-token', 'x-requested-with', 'content-type'])
  const result: Record<string, string> = {}
  for (const [key, item] of entries) {
    const lower = key.toLowerCase()
    if (!allowed.has(lower) || item == null) continue
    // Preserve the request's original content-type for non-JSON bodies; send()
    // provides application/json only when this header is absent.
    result[lower === 'content-type' ? 'Content-Type' : lower] = String(item)
  }
  return result
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Finds the attendance record inside common API envelope shapes. */
function asRecord(value: unknown, depth = 0): Record<string, unknown> | null {
  const obj = asObject(value)
  if (!obj || depth > 4) return null
  if (obj.id != null || obj.record_id != null) return obj

  const nested = [obj.record, obj.attendance, obj.data]
  for (const candidate of nested) {
    const found = asRecord(candidate, depth + 1)
    if (found) return found
  }
  return null
}

function idFrom(value: unknown): string | null {
  const record = asRecord(value)
  const id = record?.id ?? record?.record_id
  return id == null ? null : String(id)
}

function isDeleteSuccess(value: unknown): boolean {
  // Many Laravel endpoints answer DELETE with 200/204 and no JSON body. The
  // caller already checks the HTTP status, so only explicit false is failure.
  const obj = asObject(value)
  if (!obj) return true
  return obj.deleted !== false && obj.success !== false && obj.ok !== false
}

function studentCode(record: LiveRecord | null | undefined): string {
  if (!record) return ''
  return String(record.studentCode ?? record.username ?? '').trim()
}

function toLessonId(value: unknown): string | number | null | undefined {
  // `null`/empty from the API means "no lesson", not an authoritative value:
  // returning undefined lets callers fall back to the known lesson id instead
  // of tagging records with a null lesson that matches every lesson filter.
  if (value == null || value === '') return undefined
  if (typeof value === 'string' || typeof value === 'number') return value
  return undefined
}

function toPositiveLessonId(value: unknown): number | null {
  const raw = toLessonId(value)
  if (raw == null || raw === '') return null
  const number = Number(raw)
  return Number.isFinite(number) && number > 0 ? number : null
}

function toSource(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normaliseLiveRecord(raw: unknown, fallback?: Partial<LiveRecord>): LiveRecord | null {
  const rawObj = asRecord(raw)
  if (!rawObj) return null

  const id = rawObj.id ?? rawObj.record_id ?? fallback?.id
  if (id == null || id === '') return null

  const student = asObject(rawObj.student) ?? {}
  const profile = asObject(student.student_profile) ?? asObject(rawObj.student_profile) ?? {}
  // The live list and the search endpoint use different shapes; accept both.
  const flatCode = profile.student_code ?? rawObj.student_code ?? rawObj.code
  const rawName = student.name ?? rawObj.name ?? fallback?.name
  const username = student.username ?? rawObj.username ?? flatCode ?? fallback?.username ?? fallback?.studentCode
  const lessonId = toLessonId(rawObj.lesson_id) ?? fallback?.lessonId
  const source = toSource(rawObj.source) ?? fallback?.source

  return {
    id: String(id),
    name: typeof rawName === 'string' ? rawName : fallback?.name,
    username: username == null ? undefined : String(username),
    studentCode: flatCode == null ? undefined : String(flatCode),
    lessonId: lessonId == null ? null : lessonId,
    source,
  }
}

/** Build an undoable record snapshot from a POST /attendance response. */
export function recordFromAttendanceResponse(raw: unknown, fallback: Partial<LiveRecord>): LiveRecord | null {
  return normaliseLiveRecord(raw, fallback)
}

function labelFor(record: LiveRecord): string {
  const code = studentCode(record)
  const name = record.name?.trim()
  if (name && code) return `${name} (${code})`
  return name || code || t('core.student.fallback')
}

function snapshotFromDom(id: string): LiveRecord | null {
  const row = Array.from(document.querySelectorAll<HTMLElement>('[data-record-id]'))
    .find((element) => element.dataset.recordId === id)
  if (!row) return null

  const bits = (row.getAttribute('data-search') ?? '').trim().split(/\s+/).filter(Boolean)
  const code = [...bits].reverse().find((bit) => /^\d+$/.test(bit))
  if (!code) return null
  const name = bits.filter((bit) => bit !== code).join(' ').trim() || row.textContent?.trim() || undefined

  return {
    id,
    name,
    username: code,
    studentCode: code,
    lessonId: null,
  }
}

function gradeCodeFromRow(row: HTMLElement): string {
  const info = row.querySelector('.evaluation-student__info small')?.textContent?.trim() ?? ''
  const examCode = row.matches('[data-grade-row]')
    ? (row.querySelector<HTMLElement>('td > small')?.textContent?.trim()
      ?? [...(row.getAttribute('data-search') ?? '').trim().split(/\s+/)].reverse().find((bit) => /^\d+$/.test(bit)))
    : ''
  return info.split('·')[0]?.trim()
    || row.getAttribute('data-student-code')
    || row.getAttribute('data-student-id')
    || row.querySelector('.student-code')?.textContent?.trim()
    || examCode
    || ''
}

function gradeRowKey(row: HTMLElement): string | null {
  const code = gradeCodeFromRow(row)
  return code ? `${normalisePath(location.pathname)}|${code}` : null
}

function gradeRowLabel(row: HTMLElement): string {
  const name = row.querySelector('.evaluation-student__info strong')?.textContent?.trim()
    || (row.matches('[data-grade-row]') ? row.querySelector<HTMLElement>('td > strong')?.textContent?.trim() ?? '' : '')
  const code = gradeCodeFromRow(row)
  return name && code ? `${name} (${code})` : name || code || t('core.student.fallback')
}

function gradeRowFromTarget(target: EventTarget | null): HTMLElement | null {
  const element = target as Element | null
  return (element?.closest?.(GRADE_ROWS_SELECTOR) as HTMLElement | null) ?? null
}

function snapshotGradeRow(row: HTMLElement): GradeSnapshot | null {
  const key = gradeRowKey(row)
  if (!key) return null

  // Some evaluation tables put the score/grade controls straight in the row
  // instead of wrapping them in a <form>. Snapshot the row itself then.
  const scope: ParentNode = row.querySelector<HTMLFormElement>('form.grade-form[data-url]') ?? row.querySelector<HTMLFormElement>('form') ?? row
  const fields: GradeField[] = []
  for (const element of Array.from(scope.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))) {
    const control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    const name = control.name
    if (!name || /(?:^|_)(?:token|csrf|_token)|csrf/i.test(name)) continue
    const type = control.tagName === 'INPUT' ? (control as HTMLInputElement).type : control.tagName.toLowerCase()
    if (type === 'button' || type === 'submit' || type === 'reset') continue
    const checked = type === 'checkbox' || type === 'radio'
      ? (control as HTMLInputElement).checked
      : undefined
    fields.push({
      name,
      type,
      value: control.value ?? '',
      ...(checked === undefined ? {} : { checked }),
    })
  }

  const score = scope.querySelector<HTMLInputElement>('[name="exam_score"], [name="score"]')?.value
  const grade = scope.querySelector<HTMLSelectElement>('[name="grade"], [name="evaluation"], [name="estimation"]')?.value

  return {
    key,
    code: gradeCodeFromRow(row),
    label: gradeRowLabel(row),
    fields,
    ...(score == null ? {} : { score }),
    ...(grade == null ? {} : { grade }),
  }
}

function sameGradeSnapshot(a: GradeSnapshot, b: GradeSnapshot): boolean {
  if (a.key !== b.key) return false
  const left = new Map(a.fields.map((field) => [field.name, field]))
  const right = new Map(b.fields.map((field) => [field.name, field]))
  if (left.size !== right.size) return false
  for (const [name, field] of left) {
    const other = right.get(name)
    if (!other || field.value !== other.value || field.checked !== other.checked) return false
  }
  return true
}

function patchGradeBody(body: Record<string, unknown>, snapshot: GradeSnapshot): Record<string, unknown> {
  const result = { ...body }
  const byName = new Map(snapshot.fields.map((field) => [field.name, field]))

  for (const [name, field] of byName) {
    if (!(name in result)) continue
    if (field.type === 'checkbox') result[name] = Boolean(field.checked)
    else if (field.type === 'radio') {
      if (field.checked) result[name] = field.value
    } else {
      result[name] = field.value
    }
  }

  const score = snapshot.score ?? byName.get('exam_score')?.value ?? byName.get('score')?.value
  if (score != null) {
    for (const key of ['exam_score', 'score']) if (key in result) result[key] = score
  }
  const grade = snapshot.grade ?? byName.get('grade')?.value ?? byName.get('evaluation')?.value ?? byName.get('estimation')?.value
  if (grade != null) {
    for (const key of ['grade', 'evaluation', 'estimation']) if (key in result) result[key] = grade
  }
  return result
}

const GRADE_BODY_KEYS = new Set([
  'exam_score', 'score', 'grade', 'evaluation', 'estimation', 'degree', 'mark', 'result',
])

function isGradeRequest(url: URL, body: Record<string, unknown>): boolean {
  const keys = Object.keys(body).map((key) => key.toLowerCase())
  if (keys.some((key) => GRADE_BODY_KEYS.has(key))) return true
  return /(?:evaluation|grade|exam)/i.test(url.pathname) && keys.length > 0
}

function isGradeSuccess(value: unknown): boolean {
  if (!value) return true
  const obj = asObject(value)
  if (!obj) return true
  return obj.success !== false && obj.ok !== false && obj.deleted !== false
}

function describeRequest(input: Parameters<typeof fetch>[0], init?: RequestInit): { url: URL, method: string } {
  const requestLike = input as { url?: unknown, method?: unknown }
  const rawUrl = typeof input === 'string'
    ? input
    : typeof requestLike?.url === 'string'
      ? requestLike.url
      : String(input)
  const method = init?.method ?? (typeof requestLike?.method === 'string' ? requestLike.method : 'GET')
  return { url: new URL(rawUrl, location.href), method: String(method).toUpperCase() }
}

async function readRequestBody(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<unknown> {
  if (init?.body != null) return parseBody(init.body)
  if (typeof input !== 'string' && !(input instanceof URL) && typeof (input as Request).clone === 'function') {
    const text = await (input as Request).clone().text()
    return parseBody(text)
  }
  return undefined
}

function createController(): UndoRedoController {
  const persisted = loadPersistedState()
  const listeners = new Set<() => void>()
  const attendanceListeners = new Set<(event: AttendanceEvent) => void>()
  const records = new Map<string, LiveRecord>(
    (persisted?.records ?? []).filter((record) => !!record?.id).map((record) => [record.id, record]),
  )
  const recordedAttendanceIds = new Set<string>(persisted?.recordedAttendanceIds ?? [])
  const gradeBaselines = new Map<string, GradeSnapshot>(
    (persisted?.gradeBaselines ?? []).filter((snapshot) => !!snapshot?.key).map((snapshot) => [snapshot.key, snapshot]),
  )
  const reviveSafely = (serialized: SerializedAction): HistoryAction | null => {
    try { return reviveAction(serialized) } catch { return null }
  }
  const reviveAll = (items: SerializedAction[]): HistoryAction[] => items
    .filter(isValidSerializedAction)
    .map(reviveSafely)
    .filter((action): action is HistoryAction => action !== null)
  const past: HistoryAction[] = reviveAll(persisted?.past ?? [])
  const future: HistoryAction[] = reviveAll(persisted?.future ?? [])
  const observed: UndoRedoDebugObservation[] = []

  let lastTouchedGradeRow: HTMLElement | null = null
  let enabled = loadEnabled()
  let busy = false
  let sequence = 0
  let currentLessonId: string | null = persisted?.currentLessonId ?? null
  let nativeFetch: typeof fetch | null = null
  let batch: { title: string, actions: HistoryAction[] } | null = null

  if (page.fetch && !nativeFetch) nativeFetch = page.fetch.bind(page)

  const notify = (): void => {
    persist()
    for (const listener of listeners) listener()
  }

  const emitAttendance = (event: AttendanceEvent): void => {
    for (const listener of attendanceListeners) listener(event)
  }

  const recordObservation = (
    method: string,
    url: URL,
    body: Record<string, unknown>,
    grade: boolean,
    reason?: string,
  ): void => {
    observed.unshift({
      at: Date.now(),
      method,
      path: `${url.pathname}${url.search}`,
      keys: Object.keys(body),
      grade,
      ...(reason ? { reason } : {}),
    })
    if (observed.length > 20) observed.length = 20
  }

  let sessionPath = normalisePath(location.pathname)
  let gradeListenersInstalled = false

  function resetForNavigation(): void {
    const path = normalisePath(location.pathname)
    if (path === sessionPath) return
    sessionPath = path

    // History now lives for the whole browser session, not just the current
    // page. Only page-scoped grade state is reset on navigation.
    if (!GRADE_PAGE_RE.test(path)) {
      gradeBaselines.clear()
      lastTouchedGradeRow = null
    } else {
      // The script may have started off /evaluation, in which case the grade
      // listeners were never installed. Install them on entry so the pre-edit
      // baseline is captured; otherwise the first save would snapshot the
      // already-changed value and no undo action could be recorded.
      installGradeListeners()
      syncGradeBaseline()
    }
    notify()
  }

  const nextId = (): string => `undo-${Date.now()}-${++sequence}`

  function persist(): void {
    try {
      const state: PersistedState = {
        past: past.map((action) => action.serialized),
        future: future.map((action) => action.serialized),
        records: Array.from(records.values()),
        gradeBaselines: Array.from(gradeBaselines.values()),
        recordedAttendanceIds: Array.from(recordedAttendanceIds),
        currentLessonId,
      }
      sessionStore()?.setItem(SESSION_KEY, JSON.stringify(state))
    } catch {
      // Session storage can be unavailable or full; history still lives in memory.
    }
  }

  function reviveAction(serialized: SerializedAction): HistoryAction {
    switch (serialized.kind) {
      case 'attendance-add':
        return makeAddedAction(serialized.record, serialized.headers, serialized)
      case 'attendance-remove':
        return makeRemovedAction(serialized.record, serialized.headers, serialized)
      case 'grade':
        return makeGradeAction(serialized.command, serialized.before, serialized.after, serialized)
      case 'batch':
        return makeBatchAction(serialized.title, serialized.detail,
          serialized.actions.map(reviveAction), serialized.warning, serialized)
    }
  }

  function buildPostBody(record: LiveRecord): Record<string, unknown> {
    const student = studentCode(record)
    const lessonId = toPositiveLessonId(record.lessonId ?? currentLessonId)
    if (!student) throw new Error(t('core.undo.error.studentMissing'))
    if (!lessonId) throw new Error(t('core.undo.error.lessonMissing'))
    return {
      student,
      lesson_id: lessonId,
      source: record.source ?? 'manual',
    }
  }

  function deleteCommand(id: string, headers?: Record<string, string>): HttpCommand {
    return {
      method: 'DELETE',
      url: absoluteUrl(`/attendance/${encodeURIComponent(id)}`),
      headers,
    }
  }

  function addCommand(record: LiveRecord, headers?: Record<string, string>): HttpCommand {
    return {
      method: 'POST',
      url: absoluteUrl('/attendance'),
      body: buildPostBody(record),
      headers,
    }
  }

  function restoredRecordFrom(response: unknown, fallback: LiveRecord): LiveRecord {
    const id = idFrom(response)
    if (!id) throw new Error(t('core.undo.error.noRestoredId'))
    return normaliseLiveRecord(response, { ...fallback, id }) ?? { ...fallback, id }
  }

  async function send(command: HttpCommand): Promise<unknown> {
    const fetchFn = nativeFetch ?? page.fetch?.bind(page)
    if (!fetchFn) throw new Error(t('core.undo.error.sendFailed'))

    // Headers are case-insensitive: fetch() joins differently-cased duplicates
    // into one value, so only add the JSON default when the command has none.
    const hasContentType = Object.keys(command.headers ?? {}).some((key) => key.toLowerCase() === 'content-type')
    const headers: Record<string, string> = { Accept: 'application/json', ...command.headers }
    if (command.body && !hasContentType) headers['Content-Type'] = 'application/json'

    const response = await fetchFn(command.url, {
      method: command.method,
      credentials: 'same-origin',
      headers,
      body: command.body ? encodeBody(command.body, command.headers) : undefined,
    })

    if (!response.ok) throw new Error(t('core.undo.error.requestFailed', { p0: response.status }))

    const text = await response.text()
    return parseJson(text)
  }

  function cacheRecord(record: LiveRecord | null): void {
    if (!record) return
    records.set(record.id, record)
    persist()
  }

  function forgetRecord(id: string): void {
    records.delete(id)
    persist()
  }

  function makeAddedAction(
    record: LiveRecord,
    headers?: Record<string, string>,
    restored?: SerializedAction,
  ): HistoryAction {
    const label = labelFor(record)
    const code = studentCode(record)
    const data: SerializedAction = {
      id: restored?.id ?? nextId(),
      title: restored?.title ?? t('core.undo.title.attendanceAdded', { p0: label }),
      detail: restored?.detail ?? (code ? t('core.undo.detail.studentCode', { p0: code }) : t('core.undo.detail.attendance')),
      at: restored?.at ?? Date.now(),
      ...(restored?.warning ? { warning: restored.warning } : {}),
      kind: 'attendance-add',
      record,
      headers,
    }

    return {
      id: data.id,
      title: data.title,
      detail: data.detail,
      at: data.at,
      ...(data.warning ? { warning: data.warning } : {}),
      serialized: data,
      undo: async () => {
        const response = await send(deleteCommand(record.id, headers))
        if (!isDeleteSuccess(response)) throw new Error(t('core.undo.error.deleteNotConfirmed'))
        forgetRecord(record.id)
        // Undo deleted the record; redo must re-create it, so keep an
        // "added" action in the future stack rather than flipping its type.
        return makeAddedAction(record, headers)
      },
      redo: async () => {
        const response = await send(addCommand(record, headers))
        const restored = restoredRecordFrom(response, record)
        cacheRecord(restored)
        return makeAddedAction(restored, headers)
      },
    }
  }

  function makeRemovedAction(
    record: LiveRecord,
    headers?: Record<string, string>,
    restored?: SerializedAction,
  ): HistoryAction {
    const label = labelFor(record)
    const code = studentCode(record)
    const data: SerializedAction = {
      id: restored?.id ?? nextId(),
      title: restored?.title ?? t('core.undo.title.attendanceRemoved', { p0: label }),
      detail: restored?.detail ?? (code ? t('core.undo.detail.studentCode', { p0: code }) : t('core.undo.detail.attendance')),
      at: restored?.at ?? Date.now(),
      ...(restored?.warning ? { warning: restored.warning } : {}),
      kind: 'attendance-remove',
      record,
      headers,
    }

    return {
      id: data.id,
      title: data.title,
      detail: data.detail,
      at: data.at,
      ...(data.warning ? { warning: data.warning } : {}),
      serialized: data,
      undo: async () => {
        const response = await send(addCommand(record, headers))
        const restored = restoredRecordFrom(response, record)
        cacheRecord(restored)
        // Undo re-created the record with a new id; redo must delete that
        // exact id, so keep a "removed" action in the future stack.
        return makeRemovedAction(restored, headers)
      },
      redo: async () => {
        const response = await send(deleteCommand(record.id, headers))
        if (!isDeleteSuccess(response)) throw new Error(t('core.undo.error.deleteNotConfirmed'))
        forgetRecord(record.id)
        return makeRemovedAction(record, headers)
      },
    }
  }

  /** Called by our grading tools before they write, so "before" is the saved value. */
  function captureGradeBaseline(row: HTMLElement): void {
    if (!isGradePage()) return
    const snapshot = snapshotGradeRow(row)
    if (!snapshot) return
    lastTouchedGradeRow = row
    gradeBaselines.set(snapshot.key, snapshot)
    persist()
  }

  function syncGradeBaseline(): void {
    if (!isGradePage()) return
    for (const row of Array.from(document.querySelectorAll<HTMLElement>(GRADE_ROWS_SELECTOR))) {
      const snapshot = snapshotGradeRow(row)
      if (snapshot && !gradeBaselines.has(snapshot.key)) {
        gradeBaselines.set(snapshot.key, snapshot)
        persist()
      }
    }
  }

  function findGradeRowByKey(key: string): HTMLElement | null {
    return Array.from(document.querySelectorAll<HTMLElement>(GRADE_ROWS_SELECTOR))
      .find((row) => gradeRowKey(row) === key) ?? null
  }

  /** True when a request body carries a field that belongs to this grade row. */
  function bodyHasGradeField(body: Record<string, unknown>, row: HTMLElement | null): boolean {
    if (!row) return false
    const snapshot = snapshotGradeRow(row)
    if (!snapshot) return false
    const names = new Set(snapshot.fields.map((field) => field.name))
    return Object.keys(body).some((key) => names.has(key))
  }

  function collectGradeIds(value: unknown, out: string[], depth = 0): void {
    if (depth > 3 || !value || typeof value !== 'object' || out.length > 40) return
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/^(student|user|code|id)/i.test(key)
        && (typeof item === 'string' || typeof item === 'number')
        && String(item).trim()) {
        out.push(String(item).trim())
      } else if (item && typeof item === 'object') {
        collectGradeIds(item, out, depth + 1)
      }
    }
  }

  function findGradeRowFromBody(body: Record<string, unknown>): HTMLElement | null {
    const candidates: string[] = []
    collectGradeIds(body, candidates)
    const fallback = lastTouchedGradeRow
      ?? document.querySelector<HTMLElement>('.tamperina-selected')
    if (!candidates.length) return fallback

    const rows = Array.from(document.querySelectorAll<HTMLElement>(GRADE_ROWS_SELECTOR))
    const byKey = rows.find((row) => {
      const key = gradeRowKey(row) ?? ''
      return candidates.some((value) => key.endsWith(`|${value}`))
    })
    if (byKey) return byKey

    // Hidden row inputs often carry the student id even when the visible
    // code is different, so match those too before falling back to focus.
    return rows.find((row) => {
      const snapshot = snapshotGradeRow(row)
      return !!snapshot?.fields.some((field) => candidates.includes(field.value))
    }) ?? fallback
  }

  function applySnapshotToRow(snapshot: GradeSnapshot): void {
    const row = findGradeRowByKey(snapshot.key)
    if (!row) return
    const scope: ParentNode = row.querySelector<HTMLFormElement>('form') ?? row
    const controls = Array.from(scope.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))
    for (const field of snapshot.fields) {
      const control = controls.find((item) => item.name === field.name)
      if (!control) continue
      if (field.type === 'checkbox' || field.type === 'radio') {
        (control as HTMLInputElement).checked = Boolean(field.checked)
      } else {
        control.value = field.value
      }
    }
  }

  function makeGradeAction(
    command: HttpCommand,
    before: GradeSnapshot,
    after: GradeSnapshot,
    restored?: SerializedAction,
  ): HistoryAction {
    const gradeArrow = getLocale() === 'en' ? '→' : '←'
    const gradePart = before.grade && after.grade && before.grade !== after.grade
      ? ` · ${before.grade} ${gradeArrow} ${after.grade}`
      : ''
    const data: SerializedAction = {
      id: restored?.id ?? nextId(),
      title: restored?.title ?? t('core.undo.title.gradeChanged', { p0: after.label }),
      detail: restored?.detail ?? t('core.undo.detail.gradeChanged', {
        p0: before.score ?? '—',
        p1: after.score ?? '—',
        p2: gradePart,
      }),
      at: restored?.at ?? Date.now(),
      ...(restored?.warning ? { warning: restored.warning } : {}),
      kind: 'grade',
      command,
      before,
      after,
    }

    const replay = async (target: GradeSnapshot): Promise<void> => {
      const body = command.body ? patchGradeBody(command.body, target) : undefined
      const response = await send({ ...command, body })
      if (!isGradeSuccess(response)) throw new Error(t('core.undo.error.gradeNotConfirmed'))
      gradeBaselines.set(target.key, target)
      persist()
      applySnapshotToRow(target)
    }

    return {
      id: data.id,
      title: data.title,
      detail: data.detail,
      at: data.at,
      ...(data.warning ? { warning: data.warning } : {}),
      serialized: data,
      undo: async () => {
        await replay(before)
        return makeGradeAction(command, before, after)
      },
      redo: async () => {
        await replay(after)
        return makeGradeAction(command, before, after)
      },
    }
  }

  function handleGradeChange(
    method: string,
    url: URL,
    body: unknown,
    headers: Record<string, string> | undefined,
    json: unknown,
  ): void {
    const note = (reason: string): void => {
      if (observed[0]) observed[0].reason = reason
    }

    syncGradeBaseline()
    const bodyObj = asObject(body) ?? {}
    const row = findGradeRowFromBody(bodyObj)
    if (!row) {
      note('no-matching-row')
      return
    }

    const after = snapshotGradeRow(row)
    if (!after) {
      note('no-form-snapshot')
      return
    }
    const before = gradeBaselines.get(after.key)
    if (!before) {
      note('no-saved-baseline')
      return
    }
    if (sameGradeSnapshot(before, after)) {
      note('unchanged-from-saved')
      return
    }
    if (!isGradeSuccess(json)) {
      note('save-not-confirmed')
      return
    }

    const command: HttpCommand = {
      method: method as HttpMethod,
      url: url.href,
      body: bodyObj,
      headers,
    }
    pushAction(makeGradeAction(command, before, after))
    gradeBaselines.set(after.key, after)
    persist()
    note('recorded')
  }

  function installGradeListeners(): void {
    if (gradeListenersInstalled) return
    if (!isGradePage()) return
    gradeListenersInstalled = true

    // Capture the value BEFORE the user edits it. A `change` event already
    // carries the new value, so it must never overwrite the saved baseline.
    const rememberBaseline = (event: Event): void => {
      const row = gradeRowFromTarget(event.target)
      if (!row) return
      lastTouchedGradeRow = row
      const snapshot = snapshotGradeRow(row)
      if (snapshot) {
        gradeBaselines.set(snapshot.key, snapshot)
        persist()
      }
    }
    const rememberRowOnly = (event: Event): void => {
      const row = gradeRowFromTarget(event.target)
      if (row) lastTouchedGradeRow = row
    }

    document.addEventListener('focusin', rememberBaseline)
    document.addEventListener('pointerdown', rememberBaseline)
    document.addEventListener('change', rememberRowOnly)

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', syncGradeBaseline, { once: true })
    } else {
      syncGradeBaseline()
    }
  }

  function makeBatchAction(
    title: string,
    detail: string,
    actions: HistoryAction[],
    warning?: string,
    restored?: SerializedAction,
  ): HistoryAction {
    const resolvedTitle = restored?.title ?? title
    const resolvedDetail = restored?.detail ?? detail
    const data: SerializedAction = {
      id: restored?.id ?? nextId(),
      title: resolvedTitle,
      detail: resolvedDetail,
      at: restored?.at ?? Date.now(),
      ...(warning ? { warning } : {}),
      kind: 'batch',
      actions: actions.map((action) => action.serialized),
    }

    const run = async (direction: 'undo' | 'redo'): Promise<HistoryAction> => {
      const next: HistoryAction[] = new Array(actions.length)
      const failures: string[] = []
      const indices = actions.map((_, index) => index)
      if (direction === 'undo') indices.reverse()

      for (const i of indices) {
        try {
          next[i] = await actions[i][direction]()
        } catch (error) {
          // Keep the original action so a later attempt can still target it;
          // one missing record must not abort the rest of the batch.
          next[i] = actions[i]
          failures.push(error instanceof Error ? error.message : String(error))
        }
      }

      const nextWarning = failures.length
        ? t('core.undo.warning.batchPartial', {
          p0: actions.length - failures.length,
          p1: actions.length,
          p2: failures.slice(0, 3).join(listSeparator()),
        })
        : undefined
      return makeBatchAction(resolvedTitle, resolvedDetail, next, nextWarning)
    }

    return {
      id: data.id,
      title: data.title,
      detail: data.detail,
      at: data.at,
      ...(data.warning ? { warning: data.warning } : {}),
      serialized: data,
      undo: () => run('undo'),
      redo: () => run('redo'),
    }
  }

  function pushAction(action: HistoryAction): void {
    if (batch) {
      batch.actions.push(action)
      notify()
      return
    }
    past.push(action)
    future.length = 0
    notify()
  }

  function cacheLiveResponse(json: unknown): void {
    const container = asObject(json)
    const data = asObject(container?.data)
    const list = container?.records ?? data?.records
    if (!Array.isArray(list)) return

    // Merge instead of clearing: a just-added record can briefly be absent
    // from the live poll, and clearing it would lose its snapshot.
    for (const item of list) {
      const record = normaliseLiveRecord(item, { lessonId: currentLessonId })
      if (record) records.set(record.id, record)
    }
  }

  function captureBefore(method: string, url: URL, headers?: Record<string, string>): BeforeSnapshot {
    const snapshot: BeforeSnapshot = { recordIds: new Set(records.keys()), headers }
    if (method === 'DELETE' && url.pathname.startsWith('/attendance/')) {
      const id = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')
      snapshot.record = records.get(id) ?? snapshotFromDom(id)
    }
    return snapshot
  }

  function handleAttendanceAdd(body: unknown, json: unknown, before: BeforeSnapshot): void {
    const raw = asRecord(json)
    if (!raw) return

    const bodyObj = asObject(body) ?? {}
    const requestCode = bodyObj.student == null ? undefined : String(bodyObj.student)
    const fallback: Partial<LiveRecord> = {
      lessonId: toLessonId(bodyObj.lesson_id) ?? currentLessonId,
      source: toSource(bodyObj.source),
      username: requestCode,
      studentCode: requestCode,
    }
    const record = normaliseLiveRecord(json, fallback)
    if (!record) return

    // Duplicate submissions return an existing record; nothing changed.
    if (before.recordIds.has(record.id)) {
      emitAttendance({ type: 'duplicate', record })
      return
    }

    cacheRecord(record)
    recordedAttendanceIds.add(record.id)
    pushAction(makeAddedAction(record, before.headers))
    emitAttendance({ type: 'add', record })
  }

  function handleAttendanceRemove(url: URL, before: BeforeSnapshot, json: unknown): void {
    if (!isDeleteSuccess(json)) return
    const record = before.record
    if (!record) return
    forgetRecord(record.id)
    pushAction(makeRemovedAction(record, before.headers))
    emitAttendance({ type: 'remove', record })
  }

  /**
   * Exam check-in is observed only to confirm the platform's own scan form.
   * There is no confirmed delete route for an exam participation, so this
   * deliberately does not create an undoable attendance action; doing so would
   * replay DELETE /attendance/{id} against the wrong resource.
   */
  function handleExamCheckIn(body: unknown, json: unknown): void {
    const bodyObj = asObject(body) ?? {}
    const requestCode = bodyObj.student == null ? '' : String(bodyObj.student).trim()
    if (!requestCode) return

    const raw = asObject(json)
    const responseRecord = asRecord(raw?.record)
    const attendance = asObject(raw?.attendance)
    const stateRecords = Array.isArray(attendance?.records) ? attendance.records : []
    const stateRecord = stateRecords.find((item) => {
      const candidate = asObject(item)
      return candidate && String(candidate.student_code ?? '').trim() === requestCode
    })
    const source = responseRecord ?? asRecord(stateRecord)
    const student = asObject(source?.student)
    const profile = asObject(student?.student_profile)
    const sourceValue = toSource(bodyObj.source)

    const record: LiveRecord = {
      id: `exam:${String(source?.id ?? source?.record_id ?? requestCode)}`,
      ...(typeof source?.student_name === 'string' ? { name: source.student_name } : {}),
      ...(typeof student?.name === 'string' ? { name: student.name } : {}),
      username: requestCode,
      studentCode: String(source?.student_code ?? profile?.student_code ?? requestCode),
      lessonId: null,
      ...(sourceValue ? { source: sourceValue } : {}),
    }
    emitAttendance({ type: raw?.duplicate === true ? 'duplicate' : 'add', record })
  }

  function observeResponse(
    method: string,
    url: URL,
    body: unknown,
    json: unknown,
    before: BeforeSnapshot,
  ): void {
    resetForNavigation()
    if (!isSupportedPage()) return

    if (method === 'GET') {
      if (url.pathname === '/attendance/live') {
        const lessonId = url.searchParams.get('lesson_id')
        if (lessonId) {
          currentLessonId = lessonId
          persist()
        }
        cacheLiveResponse(json)
      }
      return
    }

    if (!enabled) return

    if (method === 'POST' && EXAM_CHECKIN_RE.test(url.pathname)) {
      handleExamCheckIn(body, json)
      recordObservation(method, url, asObject(body) ?? {}, false, 'exam-checkin')
      return
    }

    if (isGradePage() && method !== 'GET') {
      const gradeBody = asObject(body) ?? {}
      const touchedRow = lastTouchedGradeRow
        ?? document.querySelector<HTMLElement>('.tamperina-selected')
      // An unrelated POST (logging, notifications, …) can fire after a grade
      // row was touched. Only fall back to "grade save" when the body actually
      // carries a field from that row; otherwise we would record — and later
      // replay — a bogus action whose command points at the wrong endpoint.
      const isGrade = isGradeRequest(url, gradeBody)
        || bodyHasGradeField(gradeBody, touchedRow)
      recordObservation(method, url, gradeBody, isGrade, isGrade ? undefined : 'no-grade-fields')
      if (isGrade) {
        handleGradeChange(method, url, gradeBody, before.headers, json)
        return
      }
    }

    if (method === 'POST' && url.pathname === '/attendance') {
      handleAttendanceAdd(body, json, before)
      return
    }

    if (method === 'DELETE' && /^\/attendance\/[^/]+$/.test(url.pathname)) {
      handleAttendanceRemove(url, before, json)
    }
  }

  function installFetchHook(): void {
    const original = page.fetch
    if (typeof original !== 'function') return
    nativeFetch = original.bind(page)

    page.fetch = function patchedFetch(
      this: unknown,
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ): Promise<Response> {
      const { url, method } = describeRequest(input, init)
      const requestHeaders = typeof input === 'string'
        ? undefined
        : (input as Request).headers
      const headers = replayHeaders(init?.headers ?? requestHeaders)
      const before = captureBefore(method, url, headers)
      const bodyPromise = readRequestBody(input, init)

      return original.call(page, input, init).then(async (response) => {
        if (response.ok) {
          const json = await response.clone().json().catch(() => null)
          observeResponse(method, url, await bodyPromise, json, before)
        }
        return response
      })
    } as typeof fetch
  }

  function installXhrHook(): void {
    const Xhr = page.XMLHttpRequest as typeof XMLHttpRequest | undefined
    if (!Xhr) return

    const originalOpen = Xhr.prototype.open
    const originalSend = Xhr.prototype.send
    const originalSetRequestHeader = Xhr.prototype.setRequestHeader
    const meta = new WeakMap<XMLHttpRequest, {
      method: string
      url: URL
      body: unknown
      before: BeforeSnapshot
      headers: Record<string, string>
      handler?: () => void
    }>()

    Xhr.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      const previous = meta.get(this)
      if (previous?.handler) this.removeEventListener('loadend', previous.handler)
      meta.set(this, {
        method: method.toUpperCase(),
        url: new URL(String(url), location.href),
        body: undefined,
        before: { recordIds: new Set() },
        headers: {},
      })
      return (originalOpen as (...args: unknown[]) => void).apply(this, [method, url, ...rest])
    } as typeof Xhr.prototype.open

    Xhr.prototype.setRequestHeader = function (this: XMLHttpRequest, header: string, value: string) {
      const info = meta.get(this)
      if (info) info.headers[header.toLowerCase()] = String(value)
      return (originalSetRequestHeader as (...args: unknown[]) => void).apply(this, [header, value])
    } as typeof Xhr.prototype.setRequestHeader

    Xhr.prototype.send = function (
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const info = meta.get(this)
      if (info) {
        info.body = parseBody(body)
        info.before = captureBefore(info.method, info.url, replayHeaders(info.headers))
        if (info.handler) this.removeEventListener('loadend', info.handler)
        info.handler = () => {
          if (info.handler) this.removeEventListener('loadend', info.handler)
          if (this.status < 200 || this.status >= 300) return
          let json: unknown = null
          try {
            if (this.responseType === '' || this.responseType === 'text') {
              json = parseJson(this.responseText)
            } else if (this.responseType === 'json') {
              json = this.response
            }
          } catch {
            json = null
          }
          observeResponse(info.method, info.url, info.body, json, info.before)
        }
        this.addEventListener('loadend', info.handler)
      }
      return (originalSend as (...args: unknown[]) => void).apply(this, [body])
    } as typeof Xhr.prototype.send
  }

  if (!(page as Record<string, unknown>)[HOOKS_KEY]) {
    ;(page as Record<string, unknown>)[HOOKS_KEY] = true
    installFetchHook()
    installXhrHook()
    installGradeListeners()
  }

  function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function undo(): Promise<void> {
    resetForNavigation()
    if (!enabled || busy) return
    const action = past[past.length - 1]
    if (!action) {
      toast({ title: t('core.undo.toast.noUndo'), variant: 'warning' })
      return
    }

    busy = true
    notify()
    try {
      const inverse = await action.undo()
      past.pop()
      future.push(inverse)
      toast({
        title: t('core.undo.toast.undone'),
        description: t('core.undo.toast.undoneDesc', { p0: action.title }),
        variant: 'undo',
      })
      if (inverse.warning) {
        toast({ title: t('core.undo.toast.partialUndo'), description: inverse.warning, variant: 'warning', duration: 8000 })
      }
    } catch (error) {
      toast({
        title: t('core.undo.toast.undoFailed'),
        description: describeError(error),
        variant: 'error',
      })
    } finally {
      busy = false
      notify()
    }
  }

  async function redo(): Promise<void> {
    resetForNavigation()
    if (!enabled || busy) return
    const action = future[future.length - 1]
    if (!action) {
      toast({ title: t('core.undo.toast.noRedo'), variant: 'warning' })
      return
    }

    busy = true
    notify()
    try {
      const forward = await action.redo()
      future.pop()
      past.push(forward)
      toast({
        title: t('core.undo.toast.redone'),
        description: t('core.undo.toast.redoneDesc', { p0: action.title }),
        variant: 'redo',
      })
      if (forward.warning) {
        toast({ title: t('core.undo.toast.partialRedo'), description: forward.warning, variant: 'warning', duration: 8000 })
      }
    } catch (error) {
      toast({
        title: t('core.undo.toast.redoFailed'),
        description: describeError(error),
        variant: 'error',
      })
    } finally {
      busy = false
      notify()
    }
  }

  /**
   * Bulk flows already wait for the observer's add event, but recording must not
   * depend on that event also reaching history. Deduplicate by record id so an
   * observed add is never pushed twice.
   */
  function ensureAttendanceRecorded(record: LiveRecord, headers?: Record<string, string>): void {
    if (!enabled || !isSupportedPage() || !record?.id) return
    if (recordedAttendanceIds.has(record.id)) return
    recordedAttendanceIds.add(record.id)
    cacheRecord(record)
    pushAction(makeAddedAction(record, headers))
  }

  /** Fetch the authoritative live list for a lesson and refresh our cache. */
  async function refreshAttendanceLesson(lessonId: string): Promise<LiveRecord[]> {
    const clean = String(lessonId || '').trim()
    if (!clean) return []
    const json = await send({ method: 'GET', url: absoluteUrl(`/attendance/live?lesson_id=${encodeURIComponent(clean)}`) })
    const container = asObject(json)
    const data = asObject(container?.data)
    const list = container?.records ?? data?.records
    const found: LiveRecord[] = []
    if (Array.isArray(list)) {
      for (const item of list) {
        const record = normaliseLiveRecord(item, { lessonId: clean })
        if (!record) continue
        const recordLesson = record.lessonId == null ? clean : String(record.lessonId)
        if (recordLesson !== clean) continue
        records.set(record.id, record)
        found.push(record)
      }
    }
    currentLessonId = clean
    persist()
    notify()
    return found
  }

  function withCsrf(headers?: Record<string, string>): Record<string, string> | undefined {
    const token = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content?.trim()
    if (!token) return headers
    return { ...(headers ?? {}), 'X-CSRF-TOKEN': token }
  }

  /**
   * Delete via the native fetch so the observer cannot also record the removal,
   * then record exactly one undoable action (or one entry in an open batch).
   */
  async function deleteAttendanceRecord(record: LiveRecord, headers?: Record<string, string>): Promise<void> {
    if (!record?.id) throw new Error(t('core.undo.error.recordIdMissing'))
    const requestHeaders = withCsrf(headers)
    const response = await send(deleteCommand(record.id, requestHeaders))
    if (!isDeleteSuccess(response)) throw new Error(t('core.undo.error.deleteNotConfirmed'))
    forgetRecord(record.id)
    recordedAttendanceIds.delete(record.id)
    pushAction(makeRemovedAction(record, requestHeaders))
    emitAttendance({ type: 'remove', record })
  }

  return {
    version: CONTROLLER_VERSION,
    get supported() { return isSupportedPage() },
    get enabled() { return enabled },
    get busy() { return busy },
    get batching() { return batch !== null },
    get batchCount() { return batch?.actions.length ?? 0 },
    get canUndo() { return past.length > 0 },
    get canRedo() { return future.length > 0 },
    get history() { return past.slice().reverse() },
    get knownRecordCodes() {
      const codes = new Set<string>()
      for (const record of records.values()) {
        const code = studentCode(record)
        if (code) codes.add(code.toUpperCase())
      }
      return Array.from(codes)
    },
    get attendanceRecords() { return Array.from(records.values()) },
    knownRecordCodesForLesson(lessonId: string) {
      const clean = String(lessonId || '').trim()
      const codes = new Set<string>()
      for (const record of records.values()) {
        const recordLesson = record.lessonId == null ? null : String(record.lessonId)
        if (clean && recordLesson != null && recordLesson !== clean) continue
        const code = studentCode(record)
        if (code) codes.add(code.toUpperCase())
      }
      return Array.from(codes)
    },
    get lessonId() { return currentLessonId },
    setEnabled(value: boolean) {
      if (enabled === value) return
      enabled = value
      saveEnabled(value)
      toast({
        title: value ? t('core.undo.toast.enabled') : t('core.undo.toast.disabled'),
        description: value ? t('core.undo.toast.enabledDesc') : t('core.undo.toast.disabledDesc'),
        variant: value ? 'applied' : 'warning',
      })
      notify()
    },
    undo,
    redo,
    captureGradeBaseline,
    beginBatch(title: string) {
      if (batch) return
      batch = { title, actions: [] }
      notify()
    },
    commitBatch(options?: { title?: string, detail?: string }): HistoryAction | null {
      if (!batch) return null
      const actions = batch.actions.slice()
      const title = options?.title ?? batch.title
      batch = null
      if (!actions.length) {
        notify()
        return null
      }
      const detail = options?.detail ?? t('core.undo.detail.batchCount', { p0: actions.length })
      const grouped = makeBatchAction(title, detail, actions)
      past.push(grouped)
      future.length = 0
      notify()
      return grouped
    },
    ensureAttendanceRecorded,
    refreshAttendanceLesson,
    deleteAttendanceRecord,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onAttendance(listener: (event: AttendanceEvent) => void) {
      attendanceListeners.add(listener)
      return () => attendanceListeners.delete(listener)
    },
    debug(): UndoRedoDebug {
      return {
        version: CONTROLLER_VERSION,
        path: normalisePath(location.pathname),
        supported: isSupportedPage(),
        enabled,
        batching: batch !== null,
        batchCount: batch?.actions.length ?? 0,
        canUndo: past.length > 0,
        canRedo: future.length > 0,
        historyCount: past.length,
        gradeBaselineCount: gradeBaselines.size,
        hasTouchedGradeRow: Boolean(lastTouchedGradeRow),
        observed: observed.map((item) => ({ ...item, keys: [...item.keys] })),
      }
    },
  }
}

/** Installs the network observers once and returns the shared controller. */
export function initUndoRedo(): UndoRedoController {
  if (!controller) {
    // An older script version may still be enabled in the same tab. Stop it
    // from recording before this version installs its own observers.
    for (const key of LEGACY_CONTROLLER_KEYS) {
      const legacy = page[key] as UndoRedoController | undefined
      if (legacy && legacy !== controller) {
        try { legacy.setEnabled(false) } catch { /* older shape, ignore */ }
      }
    }

    const existing = page[CONTROLLER_KEY] as UndoRedoController | undefined
    controller = existing?.version === CONTROLLER_VERSION ? existing : createController()
    page[CONTROLLER_KEY] = controller
  }
  return controller
}

export function getUndoRedoController(): UndoRedoController {
  return initUndoRedo()
}
