import { GM_getValue, GM_setValue, unsafeWindow } from '$'
import { toast } from './toast'

/**
 * Undo/Redo for actions we can reverse with a real API call.
 *
 * M1 scope: attendance on /attendance/scan and grading on /evaluation.
 * Grading writes are inferred from their request body and replayed with the
 * previously saved values, so no server-specific endpoint needs to be hardcoded.
 */

type HttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface HttpCommand {
  method: HttpMethod
  url: string
  body?: Record<string, unknown>
  headers?: Record<string, string>
}

interface LiveRecord {
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

export interface HistoryAction {
  id: string
  title: string
  detail: string
  at: number
  undo: () => Promise<HistoryAction>
  redo: () => Promise<HistoryAction>
}

export interface UndoRedoController {
  readonly supported: boolean
  readonly enabled: boolean
  readonly busy: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly history: readonly HistoryAction[]
  setEnabled(enabled: boolean): void
  undo(): Promise<void>
  redo(): Promise<void>
  subscribe(listener: () => void): () => void
}

const SUPPORTED_PATHS = new Set(['/attendance/scan', '/evaluation'])
const ENABLED_KEY = 'tamperina.feature.undoRedo.enabled.v1'
const CONTROLLER_KEY = '__tamperinaUndoRedoControllerV1'

const page = (unsafeWindow ?? window) as unknown as Window & Record<string, unknown>

let controller: UndoRedoController | undefined

function normalisePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

function isSupportedPage(): boolean {
  return SUPPORTED_PATHS.has(normalisePath(location.pathname))
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
  const contentType = String(headers?.['content-type'] ?? '').toLowerCase()
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
    result[lower] = String(item)
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
  const obj = asObject(value)
  if (!obj) return false
  return obj.deleted === true || obj.success === true || obj.ok === true
}

function studentCode(record: LiveRecord | null | undefined): string {
  if (!record) return ''
  return String(record.studentCode ?? record.username ?? '').trim()
}

function toLessonId(value: unknown): string | number | null | undefined {
  if (typeof value === 'string' || typeof value === 'number' || value == null) return value
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
  const profile = asObject(student.student_profile) ?? {}
  const username = student.username ?? rawObj.username ?? profile.student_code ?? fallback?.username ?? fallback?.studentCode
  const lessonId = toLessonId(rawObj.lesson_id) ?? fallback?.lessonId
  const source = toSource(rawObj.source) ?? fallback?.source

  return {
    id: String(id),
    name: typeof student.name === 'string' ? student.name : fallback?.name,
    username: username == null ? undefined : String(username),
    studentCode: profile.student_code == null ? undefined : String(profile.student_code),
    lessonId: lessonId == null ? null : lessonId,
    source,
  }
}

function labelFor(record: LiveRecord): string {
  const code = studentCode(record)
  const name = record.name?.trim()
  if (name && code) return `${name} (${code})`
  return name || code || 'الطالب'
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
  return info.split('·')[0]?.trim()
    || row.getAttribute('data-student-code')
    || row.getAttribute('data-student-id')
    || row.querySelector('.student-code')?.textContent?.trim()
    || ''
}

function gradeRowKey(row: HTMLElement): string | null {
  const code = gradeCodeFromRow(row)
  return code ? `${normalisePath(location.pathname)}|${code}` : null
}

function gradeRowLabel(row: HTMLElement): string {
  const name = row.querySelector('.evaluation-student__info strong')?.textContent?.trim() || ''
  const code = gradeCodeFromRow(row)
  return name && code ? `${name} (${code})` : name || code || 'الطالب'
}

function gradeRowFromTarget(target: EventTarget | null): HTMLElement | null {
  const element = target as Element | null
  return (element?.closest?.('.evaluation-table tbody tr') as HTMLElement | null) ?? null
}

function snapshotGradeRow(row: HTMLElement): GradeSnapshot | null {
  const key = gradeRowKey(row)
  if (!key) return null

  const form = row.querySelector<HTMLFormElement>('form')
  const fields: GradeField[] = []
  for (const element of Array.from(form?.elements ?? [])) {
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

  const score = form?.querySelector<HTMLInputElement>('[name="exam_score"], [name="score"]')?.value
  const grade = form?.querySelector<HTMLSelectElement>('[name="grade"], [name="evaluation"], [name="estimation"]')?.value

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
  const past: HistoryAction[] = []
  const future: HistoryAction[] = []
  const listeners = new Set<() => void>()
  const records = new Map<string, LiveRecord>()
  const gradeBaselines = new Map<string, GradeSnapshot>()

  let lastTouchedGradeRow: HTMLElement | null = null
  let enabled = loadEnabled()
  let busy = false
  let sequence = 0
  let currentLessonId: string | null = null
  let nativeFetch: typeof fetch | null = null

  if (page.fetch && !nativeFetch) nativeFetch = page.fetch.bind(page)

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  let sessionPath = normalisePath(location.pathname)

  function resetForNavigation(): void {
    const path = normalisePath(location.pathname)
    if (path === sessionPath) return
    sessionPath = path
    past.length = 0
    future.length = 0
    records.clear()
    gradeBaselines.clear()
    lastTouchedGradeRow = null
    notify()
  }

  const nextId = (): string => `undo-${Date.now()}-${++sequence}`

  function buildPostBody(record: LiveRecord): Record<string, unknown> {
    const student = studentCode(record)
    const lessonId = toPositiveLessonId(record.lessonId ?? currentLessonId)
    if (!student) throw new Error('تعذّر تحديد الطالب لاستعادة الحضور')
    if (!lessonId) throw new Error('تعذّر تحديد الحصة لاستعادة الحضور')
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
    if (!id) throw new Error('لم يُرجع الخادم معرّف سجل الحضور بعد الإعادة')
    return normaliseLiveRecord(response, { ...fallback, id }) ?? { ...fallback, id }
  }

  async function send(command: HttpCommand): Promise<unknown> {
    const fetchFn = nativeFetch ?? page.fetch?.bind(page)
    if (!fetchFn) throw new Error('تعذّر إرسال الطلب')

    const response = await fetchFn(command.url, {
      method: command.method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(command.body ? { 'Content-Type': 'application/json' } : {}),
        ...command.headers,
      },
      body: command.body ? encodeBody(command.body, command.headers) : undefined,
    })

    if (!response.ok) throw new Error(`فشل الطلب (${response.status})`)

    const text = await response.text()
    return parseJson(text)
  }

  function cacheRecord(record: LiveRecord | null): void {
    if (!record) return
    records.set(record.id, record)
  }

  function forgetRecord(id: string): void {
    records.delete(id)
  }

  function makeAddedAction(record: LiveRecord, headers?: Record<string, string>): HistoryAction {
    const label = labelFor(record)
    const code = studentCode(record)

    return {
      id: nextId(),
      title: `تسجيل حضور ${label}`,
      detail: code ? `كود الطالب ${code}` : 'عملية حضور',
      at: Date.now(),
      undo: async () => {
        const response = await send(deleteCommand(record.id, headers))
        if (!isDeleteSuccess(response)) throw new Error('لم يؤكد الخادم حذف سجل الحضور')
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

  function makeRemovedAction(record: LiveRecord, headers?: Record<string, string>): HistoryAction {
    const label = labelFor(record)
    const code = studentCode(record)

    return {
      id: nextId(),
      title: `حذف حضور ${label}`,
      detail: code ? `كود الطالب ${code}` : 'عملية حضور',
      at: Date.now(),
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
        if (!isDeleteSuccess(response)) throw new Error('لم يؤكد الخادم حذف سجل الحضور')
        forgetRecord(record.id)
        return makeRemovedAction(record, headers)
      },
    }
  }

  function syncGradeBaseline(): void {
    if (normalisePath(location.pathname) !== '/evaluation') return
    for (const row of Array.from(document.querySelectorAll<HTMLElement>('.evaluation-table tbody tr'))) {
      const snapshot = snapshotGradeRow(row)
      if (snapshot && !gradeBaselines.has(snapshot.key)) gradeBaselines.set(snapshot.key, snapshot)
    }
  }

  function findGradeRowByKey(key: string): HTMLElement | null {
    return Array.from(document.querySelectorAll<HTMLElement>('.evaluation-table tbody tr'))
      .find((row) => gradeRowKey(row) === key) ?? null
  }

  function findGradeRowFromBody(body: Record<string, unknown>): HTMLElement | null {
    const candidates = ['student_user_id', 'student_id', 'student', 'user_id', 'code', 'student_code']
      .map((key) => body[key])
      .filter((value) => value != null && value !== '')
      .map((value) => String(value))
    if (!candidates.length) return lastTouchedGradeRow

    return Array.from(document.querySelectorAll<HTMLElement>('.evaluation-table tbody tr'))
      .find((row) => {
        const key = gradeRowKey(row) ?? ''
        return candidates.some((value) => key.endsWith(`|${value}`))
      }) ?? lastTouchedGradeRow
  }

  function applySnapshotToRow(snapshot: GradeSnapshot): void {
    const row = findGradeRowByKey(snapshot.key)
    if (!row) return
    const controls = Array.from(row.querySelector('form')?.elements ?? []) as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
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

  function makeGradeAction(command: HttpCommand, before: GradeSnapshot, after: GradeSnapshot): HistoryAction {
    const gradePart = before.grade && after.grade && before.grade !== after.grade
      ? ` · ${before.grade} ← ${after.grade}`
      : ''

    const replay = async (target: GradeSnapshot): Promise<void> => {
      const body = command.body ? patchGradeBody(command.body, target) : undefined
      const response = await send({ ...command, body })
      if (!isGradeSuccess(response)) throw new Error('لم يؤكد الخادم حفظ التقييم')
      gradeBaselines.set(target.key, target)
      applySnapshotToRow(target)
    }

    return {
      id: nextId(),
      title: `تعديل تقييم ${after.label}`,
      detail: `من ${before.score ?? '—'} إلى ${after.score ?? '—'}${gradePart}`,
      at: Date.now(),
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
    syncGradeBaseline()
    const bodyObj = asObject(body) ?? {}
    const row = findGradeRowFromBody(bodyObj)
    if (!row) return

    const after = snapshotGradeRow(row)
    if (!after) return
    const before = gradeBaselines.get(after.key)
    if (!before || sameGradeSnapshot(before, after)) return
    if (!isGradeSuccess(json)) return

    const command: HttpCommand = {
      method: method as HttpMethod,
      url: url.href,
      body: bodyObj,
      headers,
    }
    pushAction(makeGradeAction(command, before, after))
    gradeBaselines.set(after.key, after)
  }

  function installGradeListeners(): void {
    if (normalisePath(location.pathname) !== '/evaluation') return
    const remember = (event: Event): void => {
      const row = gradeRowFromTarget(event.target)
      if (!row) return
      lastTouchedGradeRow = row
      const snapshot = snapshotGradeRow(row)
      if (snapshot) gradeBaselines.set(snapshot.key, snapshot)
    }
    document.addEventListener('focusin', remember)
    document.addEventListener('change', remember)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', syncGradeBaseline, { once: true })
    } else {
      syncGradeBaseline()
    }
  }

  function pushAction(action: HistoryAction): void {
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
    if (before.recordIds.has(record.id)) return

    cacheRecord(record)
    pushAction(makeAddedAction(record, before.headers))
  }

  function handleAttendanceRemove(url: URL, before: BeforeSnapshot, json: unknown): void {
    if (!isDeleteSuccess(json)) return
    const record = before.record
    if (!record) return
    forgetRecord(record.id)
    pushAction(makeRemovedAction(record, before.headers))
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
        if (lessonId) currentLessonId = lessonId
        cacheLiveResponse(json)
      }
      return
    }

    if (!enabled) return

    if (normalisePath(location.pathname) === '/evaluation' && method !== 'GET') {
      const gradeBody = asObject(body) ?? {}
      if (isGradeRequest(url, gradeBody)) {
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

  if (!(page as Record<string, unknown>).__tamperinaUndoRedoHooks) {
    ;(page as Record<string, unknown>).__tamperinaUndoRedoHooks = true
    installFetchHook()
    installXhrHook()
    installGradeListeners()
  }

  function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function undo(): Promise<void> {
    resetForNavigation()
    if (!isSupportedPage() || !enabled || busy) return
    const action = past[past.length - 1]
    if (!action) {
      toast({ title: 'لا يوجد ما يمكن التراجع عنه', variant: 'warning' })
      return
    }

    busy = true
    notify()
    try {
      const inverse = await action.undo()
      past.pop()
      future.push(inverse)
      toast({
        title: 'تم التراجع',
        description: `أُلغي: ${action.title}`,
        variant: 'undo',
      })
    } catch (error) {
      toast({
        title: 'تعذّر التراجع',
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
    if (!isSupportedPage() || !enabled || busy) return
    const action = future[future.length - 1]
    if (!action) {
      toast({ title: 'لا يوجد ما يمكن إعادته', variant: 'warning' })
      return
    }

    busy = true
    notify()
    try {
      const forward = await action.redo()
      future.pop()
      past.push(forward)
      toast({
        title: 'تمت الإعادة',
        description: `أُعيد: ${action.title}`,
        variant: 'redo',
      })
    } catch (error) {
      toast({
        title: 'تعذّرت الإعادة',
        description: describeError(error),
        variant: 'error',
      })
    } finally {
      busy = false
      notify()
    }
  }

  return {
    get supported() { return isSupportedPage() },
    get enabled() { return enabled },
    get busy() { return busy },
    get canUndo() { return past.length > 0 },
    get canRedo() { return future.length > 0 },
    get history() { return past.slice().reverse() },
    setEnabled(value: boolean) {
      if (enabled === value) return
      enabled = value
      saveEnabled(value)
      toast({
        title: value ? 'التراجع مفعّل' : 'التراجع متوقف',
        description: value ? 'Ctrl+Z للتراجع و Ctrl+Y للإعادة' : 'لن تُسجَّل عمليات جديدة',
        variant: value ? 'applied' : 'warning',
      })
      notify()
    },
    undo,
    redo,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Installs the network observers once and returns the shared controller. */
export function initUndoRedo(): UndoRedoController {
  if (!controller) {
    const existing = page[CONTROLLER_KEY] as UndoRedoController | undefined
    controller = existing ?? createController()
    if (!existing) page[CONTROLLER_KEY] = controller
  }
  return controller
}

export function getUndoRedoController(): UndoRedoController {
  return initUndoRedo()
}
