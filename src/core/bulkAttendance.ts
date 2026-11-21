import { unsafeWindow } from '$'
import { t } from './i18n'
import { getUndoRedoController, recordFromAttendanceResponse } from './undoRedo'

const CODE_RE = /^[A-Z0-9_-]{3,80}$/

/** Calls the page's fetch so the shared undo/redo observer sees our writes. */
function pageFetch(): typeof fetch {
  const scope = (unsafeWindow ?? window) as Window
  const fetchFn = (scope.fetch ?? window.fetch) as typeof fetch
  return fetchFn.bind(scope)
}

export type PaymentMode = 'center' | 'school'
export type PaymentStatus = 'paid' | 'partial' | 'discounted' | 'forgotten'

export interface PaymentOverride {
  studentCode: string   // uppercase, matches the entry code
  status: PaymentStatus
  amountPaid?: number   // required for partial / discounted
  note?: string
}

export interface StudentCandidate {
  id: string
  name: string
  code: string
}

export interface ParsedEntryPayment {
  status: PaymentStatus
  amountPaid?: number
}

export interface ParsedCode {
  kind: 'code'
  key: string
  raw: string
  code: string
  payment?: ParsedEntryPayment
}

export interface ParsedName {
  kind: 'name'
  key: string
  raw: string
  query: string
  payment?: ParsedEntryPayment
}

export interface ParseEntriesResult {
  codes: ParsedCode[]
  names: ParsedName[]
  duplicates: string[]
  invalid: string[]
  totalTokens: number
}

export type ResolveStatus = 'ready' | 'resolved' | 'ambiguous' | 'not-found' | 'too-many' | 'dropped' | 'walk-in' | 'loading' | 'error'

export interface NameRow {
  kind: 'name'
  key: string
  raw: string
  query: string
  status: ResolveStatus
  code?: string
  studentName?: string
  candidates: StudentCandidate[]
  message?: string
  payment?: ParsedEntryPayment
}

export interface ScanFormInfo {
  form: HTMLFormElement
  input: HTMLInputElement
  lessonId: string | null
  studentsUrl: string | null
  inputSelector: string
}

export type BulkRowStatus = 'created' | 'duplicate' | 'skipped-known' | 'timeout' | 'error' | 'stopped'

/** Raw evidence for one student, kept so a failed run can be diagnosed exactly. */
export interface BulkRowDebug {
  request?: { path: string, payload: Record<string, unknown> }
  response?: { status: number, statusText: string, contentType: string, body: string }
  observer?: string
  note?: string
}

export interface BulkRowResult {
  code: string
  label?: string
  status: BulkRowStatus
  message?: string
  recordId?: string
  at: number
  debug?: BulkRowDebug
}

/** Per-row values for the platform's own exam check-in form. */
export interface ExamCheckinOptions {
  paymentStatus?: 'paid' | 'exempt' | 'deferred'
  amountPaid?: string
  paymentNote?: string
  source?: 'manual' | 'scanner' | 'camera' | 'image'
}

export interface BulkRunContext {
  lessonId: string
  paymentMode: PaymentMode
  entries: number
  csrfPresent: boolean
  startedAt: number
  finishedAt: number
  href: string
}

export interface BulkRunSummary {
  rows: BulkRowResult[]
  created: number
  duplicates: number
  skipped: number
  failed: number
  stopped: boolean
  context: BulkRunContext
}

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
}

/** Normalize a user-entered student code to the form the platform expects. */
export function normalizeStudentCode(value: string): string {
  return normalizeDigits(value).trim().toUpperCase()
}

function normalizeName(value: string): string {
  return normalizeDigits(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function describeInput(input: HTMLInputElement): string {
  const id = input.id ? `#${input.id}` : ''
  const name = input.name ? `[name="${input.name}"]` : ''
  const type = input.type ? `[type="${input.type}"]` : ''
  return `input${id}${name}${type}` || 'input'
}

export function detectScanForm(preferExam = false): ScanFormInfo | null {
  const examForm = document.getElementById('examScan') as HTMLFormElement | null
  const form = (preferExam
    ? examForm
    : document.getElementById('scanForm')
      ?? document.querySelector('form[action*="attendance"]')
      ?? examForm) as HTMLFormElement | null
  if (!form) return null

  const lessonId = form.id === 'examScan'
    ? null
    : form.dataset.voiceLessonId
      ?? form.dataset.lessonId
      ?? new URL(location.href).searchParams.get('lesson_id')
      ?? null
  const studentsUrl = form.dataset.voiceStudentsUrl
    ?? form.dataset.studentsUrl
    ?? examForm?.querySelector<HTMLInputElement>('#examStudent')?.dataset.studentsUrl
    ?? null

  const selectors = form.id === 'examScan'
    ? ['input#examStudent', 'input[name="student"]']
    : [
    'input[name="student"]',
    'input[name="code"]',
    'input[name="student_code"]',
    'input[name="studentCode"]',
    'input[name="scan"]',
    'input[name="barcode"]',
    'input[name="qr"]',
    'input[name="q"]',
    'input[name="username"]',
    'input#student',
    'input#student_code',
    'input#code',
    'input#scan',
    'input#barcode',
    'input[type="search"]',
    'input[type="text"]',
    'input:not([type])',
    'input[type="number"]',
  ]

  for (const selector of selectors) {
    const input = form.querySelector<HTMLInputElement>(selector)
    if (!input || input.disabled) continue
    const type = (input.type || 'text').toLowerCase()
    if (['hidden', 'submit', 'button', 'reset', 'checkbox', 'radio', 'file'].includes(type)) continue
    return { form, input, lessonId, studentsUrl, inputSelector: describeInput(input) }
  }

  return null
}

export function currentLessonIdFromPage(): string | null {
  const undoRedo = getUndoRedoController()
  if (undoRedo.lessonId) return String(undoRedo.lessonId)
  const detected = detectScanForm()
  if (detected?.lessonId) return String(detected.lessonId)
  return new URL(location.href).searchParams.get('lesson_id')
}

function isArabicOrNameLike(value: string): boolean {
  return /[\u0600-\u06FF]/.test(value) || /\s/.test(value.trim())
}

function normalizeStatusToken(value: string): PaymentStatus | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (v === 'كامل' || v === 'paid' || v === 'full' || v === 'مدفوع') return 'paid'
  if (v === 'جزئي' || v === 'partial') return 'partial'
  if (v === 'مخفض' || v === 'مخفض/مجاني' || v === 'مجاني' || v === 'discounted' || v === 'free') return 'discounted'
  if (v === 'نسي' || v === 'نسي الفلوس' || v === 'مؤجل' || v === 'دفع مؤجل'
    || v === 'متأخر' || v === 'forgot' || v === 'forgotten' || v === 'deferred') return 'forgotten'
  return null
}

function parseAmountToken(value: string): number | undefined {
  const cleaned = value.trim().replace(/[^\d.,-]/g, '').replace(',', '.')
  if (!cleaned) return undefined
  const num = Number(cleaned)
  return Number.isFinite(num) && num >= 0 ? num : undefined
}

/**
 * Accepts both `identifier, amount, status` and `identifier, status, amount`.
 * A bare second number means partial payment; a bare status leaves the amount
 * unset so the platform default is used where applicable.
 */
function parseInlinePayment(segments: string[]): { identifier: string, payment?: ParsedEntryPayment } | null {
  if (segments.length < 2) return null
  const lastIndex = segments.length - 1
  const lastStatus = normalizeStatusToken(segments[lastIndex])
  const beforeLastStatus = lastIndex >= 1 ? normalizeStatusToken(segments[lastIndex - 1]) : null
  const lastAmount = parseAmountToken(segments[lastIndex])
  const beforeLastAmount = lastIndex >= 1 ? parseAmountToken(segments[lastIndex - 1]) : undefined

  if (lastStatus) {
    if (segments.length === 2) {
      return { identifier: segments[0], payment: { status: lastStatus } }
    }
    const identifier = segments.slice(0, lastIndex - 1).join(',').trim()
    if (!identifier) return null
    return {
      identifier,
      payment: beforeLastAmount == null
        ? { status: lastStatus }
        : { status: lastStatus, amountPaid: beforeLastAmount },
    }
  }

  if (beforeLastStatus && lastAmount != null) {
    const identifier = segments.slice(0, lastIndex - 1).join(',').trim()
    if (!identifier) return null
    return { identifier, payment: { status: beforeLastStatus, amountPaid: lastAmount } }
  }

  // identifier, amount (no explicit status) -> treat as partial with amount
  if (segments.length === 2 && lastAmount != null && segments[0].trim()) {
    return { identifier: segments[0], payment: { status: 'partial', amountPaid: lastAmount } }
  }
  return null
}

export function parseBulkEntries(text: string): ParseEntriesResult {
  const normalizedText = normalizeDigits(text)
  const lines = normalizedText.split(/\r?\n/)
  const seenCodes = new Set<string>()
  const codes: ParsedCode[] = []
  const names: ParsedName[] = []
  const duplicates: string[] = []
  const invalid: string[] = []
  let totalTokens = 0
  let seq = 0

  const pushCode = (raw: string, token: string, payment?: ParsedEntryPayment): void => {
    totalTokens++
    const code = token.toUpperCase()
    if (!CODE_RE.test(code)) {
      invalid.push(raw.trim() || token)
      return
    }
    if (seenCodes.has(code)) {
      duplicates.push(code)
      return
    }
    seenCodes.add(code)
    codes.push({ kind: 'code', key: `c-${++seq}-${code}`, raw: raw.trim() || code, code, payment })
  }

  const pushName = (raw: string, queryOverride?: string, payment?: ParsedEntryPayment): void => {
    const query = (queryOverride ?? raw).trim().replace(/\s+/g, ' ')
    if (!query) return
    totalTokens++
    names.push({ kind: 'name', key: `n-${++seq}-${query}`, raw: raw.trim() || query, query, payment })
  }

  const pushEntry = (identifier: string, displayRaw: string, payment?: ParsedEntryPayment): void => {
    const upper = identifier.trim().toUpperCase()
    if (CODE_RE.test(upper) && !/[\u0600-\u06FF]/.test(identifier)) {
      pushCode(displayRaw, upper, payment)
      return
    }
    // space-separated codes without payment info
    if (!payment && !/[\u0600-\u06FF]/.test(identifier)) {
      const spaceParts = identifier.trim().split(/\s+/).map((p) => p.trim()).filter(Boolean)
      if (spaceParts.length > 1 && spaceParts.every((p) => CODE_RE.test(p.toUpperCase()))) {
        for (const sp of spaceParts) pushCode(sp, sp.toUpperCase())
        return
      }
    }
    if (/^[A-Z0-9_-]+$/i.test(identifier.trim()) && !isArabicOrNameLike(identifier.trim()) && identifier.trim().length < 3) {
      totalTokens++
      invalid.push(identifier.trim())
      return
    }
    pushName(displayRaw, identifier.trim(), payment)
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Split by comma/Arabic comma/semicolon for structured parsing
    const segments = trimmed.split(/[,\u060C;\u061B]+/).map((p) => p.trim()).filter(Boolean)
    if (!segments.length) continue

    // Try structured format: identifier[, amount][, status]
    const structured = parseInlinePayment(segments)
    if (structured) {
      pushEntry(structured.identifier, trimmed, structured.payment)
      continue
    }

    const hasArabic = /[\u0600-\u06FF]/.test(trimmed)
    if (hasArabic) {
      // Whole Arabic line is a name (no structured payment detected)
      pushName(trimmed)
      continue
    }

    // Non-Arabic, no structured payment: treat each segment as a code/name token
    for (const part of segments) {
      pushEntry(part, part)
    }
  }

  return { codes, names, duplicates, invalid, totalTokens }
}

export async function searchStudents(
  query: string,
  lessonId: string,
): Promise<StudentCandidate[] | { tooMany: true } | { error: string }> {
  const scan = detectScanForm()
  if (!scan?.studentsUrl) return { error: t('data.search.noUrl') }

  try {
    const url = new URL(scan.studentsUrl, location.href)
    url.searchParams.set('lesson_id', lessonId)
    url.searchParams.set('q', query)
    url.searchParams.set('limit', '100')

    const response = await pageFetch()(url.href, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return { error: t('data.search.failed', { p0: response.status }) }

    const json = await response.json()
    if (!Array.isArray(json)) return { error: t('data.search.unexpected') }
    if (json.length >= 100) return { tooMany: true }

    return json.map((item) => {
      const obj = (item && typeof item === 'object') ? item as Record<string, unknown> : {}
      const profile = (obj.student_profile && typeof obj.student_profile === 'object')
        ? obj.student_profile as Record<string, unknown>
        : {}
      const code = String(profile.student_code ?? obj.username ?? '').trim()
      return {
        id: String(obj.id ?? ''),
        name: String(obj.name ?? '').trim(),
        code,
      }
    }).filter((c) => c.code || c.name)
  } catch (error) {
    return { error: error instanceof Error ? error.message : t('data.search.connectionFailed') }
  }
}

function candidateMatchesQuery(candidate: StudentCandidate, query: string): boolean {
  const nq = normalizeName(query)
  if (!nq) return false
  const name = normalizeName(candidate.name)
  const code = normalizeName(candidate.code)
  return name === nq || code === nq || name.includes(nq) || nq.includes(name)
}

export async function resolveNameEntry(row: NameRow, lessonId: string): Promise<NameRow> {
  const query = row.query.trim()
  if (!query) {
    return { ...row, status: 'not-found', candidates: [], message: t('data.name.empty') }
  }

  const result = await searchStudents(query, lessonId)
  if ('error' in result) {
    return { ...row, status: 'error', candidates: [], message: result.error }
  }
  if ('tooMany' in result) {
    return { ...row, status: 'too-many', candidates: [], message: t('data.name.tooMany') }
  }

  const candidates = result
  if (!candidates.length) {
    return { ...row, status: 'not-found', candidates: [], message: t('data.name.notFound') }
  }

  const exact = candidates.filter((c) => {
    const nq = normalizeName(query)
    return normalizeName(c.name) === nq || normalizeName(c.code) === nq
  })

  if (exact.length === 1) {
    const c = exact[0]
    return {
      ...row,
      status: 'resolved',
      code: c.code,
      studentName: c.name,
      candidates,
      message: t('data.name.identified', { p0: c.name, p1: c.code || t('data.noCode') }),
    }
  }

  if (candidates.length === 1) {
    const c = candidates[0]
    return {
      ...row,
      status: 'resolved',
      code: c.code,
      studentName: c.name,
      candidates,
      message: t('data.name.singleMatch', { p0: c.name, p1: c.code || t('data.noCode') }),
    }
  }

  if (candidates.length === 2) {
    const isFourDigit = (code: string): boolean => /^\d{4}$/.test(String(code || '').trim())
    const a = candidates[0]
    const b = candidates[1]
    const a4 = isFourDigit(a.code)
    const b4 = isFourDigit(b.code)
    if (a4 !== b4) {
      const chosen = a4 ? a : b
      return {
        ...row,
        status: 'resolved',
        code: chosen.code,
        studentName: chosen.name,
        candidates,
        message: t('data.name.autoSelected', { p0: chosen.name, p1: chosen.code || t('data.noCode') }),
      }
    }
  }

  return {
    ...row,
    status: 'ambiguous',
    candidates,
    message: candidates.length > 1 ? t('data.name.multipleMatches') : t('data.name.uncertainMatch'),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface CodeWait {
  promise: Promise<import('./undoRedo').AttendanceEvent | 'timeout'>
  cancel(): void
}

function waitForCode(code: string, timeoutMs: number): CodeWait {
  const undoRedo = getUndoRedoController()
  let done = false
  let resolveWait: (value: import('./undoRedo').AttendanceEvent | 'timeout') => void = () => {}
  let off: () => void = () => {}

  const promise = new Promise<import('./undoRedo').AttendanceEvent | 'timeout'>((resolve) => {
    resolveWait = resolve
  })
  const cleanup = (): void => {
    if (done) return
    done = true
    window.clearTimeout(timer)
    off()
  }
  const timer = window.setTimeout(() => {
    cleanup()
    resolveWait('timeout')
  }, timeoutMs)

  off = undoRedo.onAttendance((event) => {
    if (done) return
    const recordCode = String(event.record.studentCode ?? event.record.username ?? '').toUpperCase()
    // Never let an event with no code satisfy every waiter — that would mark
    // unrelated rows as created and hide the real failure.
    if (!recordCode || recordCode !== code.toUpperCase()) return
    cleanup()
    resolveWait(event)
  })

  return { promise, cancel: cleanup }
}

function submitScanForm(form: HTMLFormElement, input: HTMLInputElement): void {
  input.focus()
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))

  if (typeof (form as HTMLFormElement & { requestSubmit?: () => void }).requestSubmit === 'function') {
    ;(form as HTMLFormElement & { requestSubmit: () => void }).requestSubmit()
    return
  }

  const submit = form.querySelector<HTMLElement>('button[type="submit"], input[type="submit"], button:not([type])')
  if (submit) {
    submit.click()
    return
  }

  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

/**
 * Apply a staged row to the platform's own exam form. The hidden `source` field
 * is pinned because the page's submit handler always overwrites it with
 * `manual`; keeping our value lets the platform fetch still send the chosen
 * source without creating a second write path.
 */
function applyExamCheckinOptions(
  form: HTMLFormElement,
  options?: ExamCheckinOptions,
): () => void {
  if (!options) return () => {}

  const setField = (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null, value: string | undefined): void => {
    if (!element || value === undefined) return
    element.value = value
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }
  setField(form.querySelector<HTMLSelectElement>('select[name="payment_status"]'), options.paymentStatus)
  setField(form.querySelector<HTMLInputElement>('input[name="amount_paid"]'), options.amountPaid)
  setField(form.querySelector<HTMLTextAreaElement>('textarea[name="payment_note"]'), options.paymentNote)

  const sourceInput = form.querySelector<HTMLInputElement>('input[name="source"]')
  const chosenSource = options.source
  if (!sourceInput || !chosenSource || chosenSource === 'manual') return () => {}

  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  if (!descriptor?.get || !descriptor.set) return () => {}
  const originalGet = descriptor.get
  const originalSet = descriptor.set
  const originalValue = originalGet.call(sourceInput)
  originalSet.call(sourceInput, chosenSource)
  Object.defineProperty(sourceInput, 'value', {
    configurable: true,
    get: () => originalGet.call(sourceInput),
    set: (next: string) => {
      if (String(next) === chosenSource) originalSet.call(sourceInput, chosenSource)
    },
  })
  return () => {
    delete (sourceInput as unknown as { value?: string }).value
    originalSet.call(sourceInput, originalValue)
  }
}

/** Returns the CSRF token from the page meta tag (same-origin, safe). */
function getCsrfToken(): string {
  return (document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '').trim()
}

/**
 * School-mode: POST directly to /attendance, using the platform's own default
 * when no payment override was provided. Payment fields are only sent when the
 * user explicitly chose a status, so a deferred-payment lesson is not silently
 * converted into full payments.
 *
 * The request goes through the page's patched fetch so the shared undo/redo
 * observer records it and the batch stays reversible.
 */
type SchoolSubmitResult =
  | { ok: true, data: Record<string, unknown>, debug: BulkRowDebug }
  | { ok: false, message: string, status?: number, debug: BulkRowDebug }

async function submitSchoolAttendance(
  code: string,
  lessonId: string,
  override: PaymentOverride | undefined,
): Promise<SchoolSubmitResult> {
  const csrf = getCsrfToken()
  if (!csrf) {
    return {
      ok: false,
      message: t('data.school.csrfMissing'),
      debug: { note: 'meta[name="csrf-token"] missing or empty' },
    }
  }

  const body: Record<string, unknown> = {
    student: code,
    lesson_id: Number(lessonId),
    source: 'manual',
  }
  if (override?.status) {
    body.payment_status = override.status
    if ((override.status === 'partial' || override.status === 'discounted') && override.amountPaid != null) {
      body.amount_paid = override.amountPaid
    }
    if (override.note) body.payment_note = override.note
  }

  const debug: BulkRowDebug = { request: { path: '/attendance', payload: body } }
  try {
    const response = await pageFetch()('/attendance', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-TOKEN': csrf,
      },
      body: JSON.stringify(body),
    })
    // Read raw text so a non-JSON error page (419/302/500) is still captured.
    const text = await response.text()
    debug.response = {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type') ?? '',
      body: text.slice(0, 2000),
    }

    let data: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>
      } else {
        debug.note = 'JSON response was not an object'
      }
    } catch {
      debug.note = 'Response body was not JSON'
    }

    if (!response.ok) {
      const errors = data.errors as Record<string, string[]> | undefined
      const fieldErrors = errors
        ? Object.entries(errors).map(([field, messages]) => `${field}: ${(messages ?? []).join(' / ')}`).join('; ')
        : ''
      const msg = String(
        fieldErrors || data.message || (typeof data.error === 'string' ? data.error : '')
        || `HTTP ${response.status} ${response.statusText}`.trim(),
      )
      return { ok: false, message: msg, status: response.status, debug }
    }
    return { ok: true, data, debug }
  } catch (err) {
    debug.note = `fetch threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`
    return {
      ok: false,
      message: err instanceof Error ? err.message : t('data.school.connectionFailed'),
      debug,
    }
  }
}

export async function runBulkAttendance(options: {
  entries: Array<{ code: string, label?: string, exam?: ExamCheckinOptions }>
  signal: { stop: boolean }
  onRow: (row: BulkRowResult) => void
  timeoutMs?: number
  paymentMode?: PaymentMode
  paymentOverrides?: PaymentOverride[]
  lessonId?: string
  /** Exam check-in uses the platform's own scan form; it is never a lesson bulk. */
  target?: 'standard' | 'exam'
}): Promise<BulkRunSummary> {
  const undoRedo = getUndoRedoController()
  const timeoutMs = options.timeoutMs ?? 10000
  const examTarget = options.target === 'exam'
  const paymentMode: PaymentMode = examTarget ? 'center' : (options.paymentMode ?? 'center')
  const overrideMap = new Map<string, PaymentOverride>(
    (options.paymentOverrides ?? []).map((o) => [o.studentCode.toUpperCase(), o]),
  )
  const rows: BulkRowResult[] = []
  const startedAt = Date.now()
  let created = 0
  let duplicates = 0
  let skipped = 0
  let failed = 0
  let stopped = false

  const makeContext = (): BulkRunContext => ({
    lessonId: options.lessonId ?? currentLessonIdFromPage() ?? '',
    paymentMode,
    entries: options.entries.length,
    csrfPresent: !!getCsrfToken(),
    startedAt,
    finishedAt: Date.now(),
    href: location.href,
  })

  const recordRow = (row: BulkRowResult): void => {
    rows.push(row)
    if (row.status === 'created') created++
    else if (row.status === 'duplicate') duplicates++
    else if (row.status === 'skipped-known') skipped++
    else failed++
    options.onRow(row)
  }

  // ---- مدرسة (school) mode: fast parallel direct POSTs ----------------------
  if (paymentMode === 'school') {
    const lessonId = options.lessonId ?? currentLessonIdFromPage() ?? ''
    if (!lessonId) {
      recordRow({
        code: '',
        status: 'error',
        message: t('data.school.lessonUnknown'),
        at: Date.now(),
        debug: { note: 'No lesson id from options, page form, or URL' },
      })
      return { rows, created, duplicates, skipped, failed, stopped: true, context: makeContext() }
    }

    // Only codes already recorded FOR THIS LESSON count as known. The cache is
    // shared across navigation, so using all records made year-3 codes that
    // also exist in year 1/2 look "already registered" and get skipped.
    const known = new Set(undoRedo.knownRecordCodesForLesson(lessonId).map((c) => c.toUpperCase()))
    const toRun: Array<{ code: string, label?: string }> = []
    const queued = new Set<string>()
    for (const entry of options.entries) {
      const code = entry.code.toUpperCase()
      if (options.signal.stop) {
        stopped = true
        break
      }
      if (known.has(code)) {
        recordRow({ code, label: entry.label, status: 'skipped-known', message: t('data.run.alreadyRegistered'), at: Date.now() })
        continue
      }
      if (queued.has(code)) {
        recordRow({ code, label: entry.label, status: 'duplicate', message: t('data.run.duplicateInList'), at: Date.now() })
        continue
      }
      queued.add(code)
      toRun.push({ code, label: entry.label })
    }

    const duplicateMessage = (message: string): boolean =>
      /مسجّ?ل|سبق|موجود|مكرر|duplicate|already/i.test(message)

    // A burst of 10 parallel POSTs can trip platform throttling; five workers
    // with a small pause keeps bulk runs reliable on large lessons.
    const concurrency = 5
    let index = 0

    const payLabelFor = (override: PaymentOverride | undefined): string => override ? {
      paid: t('data.payment.paid'),
      partial: t('data.payment.partial'),
      discounted: t('data.payment.discounted'),
      forgotten: t('data.payment.forgotten'),
    }[override.status] : t('data.payment.default')

    const processEntry = async (entry: { code: string, label?: string }): Promise<void> => {
      const code = entry.code.toUpperCase()
      const override = overrideMap.get(code)
      const wait = waitForCode(code, timeoutMs)
      const result = await submitSchoolAttendance(code, lessonId, override)

      if (!result.ok) {
        wait.cancel()
        const duplicate = duplicateMessage(result.message)
        recordRow({
          code,
          label: entry.label,
          status: duplicate ? 'duplicate' : 'error',
          message: result.message,
          at: Date.now(),
          debug: {
            ...result.debug,
            observer: 'not-watched',
            note: duplicate
              ? `${result.debug.note ?? ''} Classified as duplicate from server message.`.trim()
              : result.debug.note,
          },
        })
        return
      }

      // Prefer the observer event (it has the full snapshot), but fall back to
      // the POST response if the observer is late or missing.
      const event = await Promise.race([
        wait.promise,
        sleep(Math.min(timeoutMs, 1200)).then(() => 'timeout' as const),
      ])
      wait.cancel()
      const debug: BulkRowDebug = {
        ...result.debug,
        observer: event === 'timeout' ? 'timeout' : event.type,
      }

      if (event !== 'timeout' && event.type === 'add') {
        undoRedo.ensureAttendanceRecorded(event.record)
        recordRow({
          code,
          label: entry.label,
          status: 'created',
          message: t('data.run.registeredWithPayment', { p0: payLabelFor(override) }),
          recordId: event.record.id,
          at: Date.now(),
          debug,
        })
        return
      }
      if (event !== 'timeout' && event.type === 'duplicate') {
        recordRow({
          code,
          label: entry.label,
          status: 'duplicate',
          message: t('data.run.alreadyRegistered'),
          recordId: event.record.id,
          at: Date.now(),
          debug,
        })
        return
      }

      const record = recordFromAttendanceResponse(result.data, {
        lessonId,
        source: 'manual',
        username: code,
        studentCode: code,
      })
      if (record) {
        undoRedo.ensureAttendanceRecorded(record)
        recordRow({
          code,
          label: entry.label,
          status: 'created',
          message: t('data.run.registeredFromResponse', { p0: payLabelFor(override) }),
          recordId: record.id,
          at: Date.now(),
          debug: {
            ...debug,
            note: 'Observer confirmation missing; undo snapshot built from POST response.',
          },
        })
      } else {
        recordRow({
          code,
          label: entry.label,
          status: 'error',
          message: event === 'timeout'
            ? t('data.run.submittedNoUndo')
            : t('data.run.unexpectedServerResponse'),
          at: Date.now(),
          debug: {
            ...debug,
            note: `${debug.note ?? ''} Could not build an undoable record from the response.`.trim(),
          },
        })
      }
    }

    const worker = async (): Promise<void> => {
      while (true) {
        if (options.signal.stop) {
          stopped = true
          return
        }
        const i = index++
        if (i >= toRun.length) return
        const entry = toRun[i]
        try {
          await processEntry(entry)
        } catch (error) {
          // One unexpected exception must not take down the other workers.
          recordRow({
            code: entry.code.toUpperCase(),
            label: entry.label,
            status: 'error',
            message: t('data.run.submitException', { p0: error instanceof Error ? error.message : String(error) }),
            at: Date.now(),
            debug: {
              note: error instanceof Error ? error.stack ?? error.message : String(error),
            },
          })
          console.error('[Tamperina] bulk row failed', entry.code, error)
        }
        if (!options.signal.stop) await sleep(40)
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, toRun.length || 1) }, () => worker())
    const outcomes = await Promise.allSettled(workers)
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        console.error('[Tamperina] bulk worker crashed', outcome.reason)
        recordRow({
          code: '',
          status: 'error',
          message: t('data.run.workerCrashed', { p0: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) }),
          at: Date.now(),
          debug: { note: 'Worker-level rejection; remaining rows may not have been sent.' },
        })
      }
    }
    if (options.signal.stop && !stopped) stopped = true
    return { rows, created, duplicates, skipped, failed, stopped, context: makeContext() }
  }

  // ---- سنتر (center) mode: sequential scan-form loop (single input/form) ----
  const centerLessonId = options.lessonId ?? currentLessonIdFromPage() ?? ''
  const centerKnown = examTarget
    ? new Set<string>()
    : new Set(
      (centerLessonId
        ? undoRedo.knownRecordCodesForLesson(centerLessonId)
        : undoRedo.knownRecordCodes).map((c) => c.toUpperCase()),
    )
  let consecutiveTimeouts = 0
  for (const entry of options.entries) {
    const code = entry.code.toUpperCase()
    if (options.signal.stop) {
      stopped = true
      break
    }

    if (centerKnown.has(code)) {
      recordRow({ code, label: entry.label, status: 'skipped-known', message: t('data.run.alreadyRegistered'), at: Date.now() })
      continue
    }

    const scan = detectScanForm(examTarget)
    if (!scan) {
      recordRow({
        code,
        label: entry.label,
        status: 'error',
        message: t('data.center.formNotFound'),
        at: Date.now(),
        debug: { note: `detectScanForm() returned null; path=${location.pathname}` },
      })
      consecutiveTimeouts++
      if (consecutiveTimeouts >= 3) {
        stopped = true
        break
      }
      await sleep(40)
      continue
    }

    scan.input.value = code
    const wait = waitForCode(code, timeoutMs)
    const unpinExamOptions = examTarget ? applyExamCheckinOptions(scan.form, entry.exam) : () => {}
    let result: Awaited<typeof wait.promise>
    try {
      submitScanForm(scan.form, scan.input)
      result = await wait.promise
    } finally {
      unpinExamOptions()
    }

    const debug: BulkRowDebug = {
      request: { path: 'page scan form', payload: { code, lesson_id: centerLessonId } },
      observer: result === 'timeout' ? 'timeout' : result.type,
    }

    if (result === 'timeout') {
      recordRow({
        code,
        label: entry.label,
        status: 'timeout',
        message: t('data.center.noConfirmation'),
        at: Date.now(),
        debug: {
          ...debug,
          note: `No matching attendance event within ${timeoutMs}ms from ${scan.inputSelector}`,
        },
      })
      consecutiveTimeouts++
      // Keep going so one slow code cannot cut the batch short, but give up
      // if the form has clearly stopped responding altogether.
      if (consecutiveTimeouts >= 3) {
        stopped = true
        break
      }
      continue
    }
    consecutiveTimeouts = 0

    if (result.type === 'add') {
      // Exam check-ins have no confirmed delete route. The observer event is
      // enough to confirm the write; never create an undo action for it.
      if (!examTarget) undoRedo.ensureAttendanceRecorded(result.record)
      recordRow({ code, label: entry.label, status: 'created', message: t('data.run.registered'), recordId: result.record.id, at: Date.now(), debug })
    } else if (result.type === 'duplicate') {
      recordRow({ code, label: entry.label, status: 'duplicate', message: t('data.run.alreadyRegistered'), recordId: result.record.id, at: Date.now(), debug })
    } else {
      recordRow({ code, label: entry.label, status: 'error', message: t('data.center.unexpectedResponse'), at: Date.now(), debug })
    }

    // Minimal pacing to let the form/site settle between submissions.
    if (!options.signal.stop) await sleep(20)
  }

  if (options.signal.stop && !stopped) stopped = true

  return { rows, created, duplicates, skipped, failed, stopped, context: makeContext() }
}

/** Plain-text report for pasting into a bug report. Contains no cookies/tokens. */
export function formatBulkDiagnosticReport(
  summary: BulkRunSummary,
  entries: Array<{ code: string, label?: string }>,
): string {
  const c = summary.context
  const lines: string[] = []
  lines.push('=== TAMPERINA BULK ATTENDANCE DIAGNOSTIC ===')
  lines.push(`Time: ${new Date(c.startedAt).toLocaleString()} → ${new Date(c.finishedAt).toLocaleString()}`)
  lines.push(`Page: ${c.href}`)
  lines.push(`Lesson: ${c.lessonId || '(unknown)'} | Mode: ${c.paymentMode} | CSRF token: ${c.csrfPresent ? 'present' : 'MISSING'}`)
  lines.push(`Input lines: ${entries.length} | Result rows: ${summary.rows.length}`)
  lines.push(`Created: ${summary.created} | Existing: ${summary.duplicates} | Skipped-known: ${summary.skipped} | Failed: ${summary.failed} | Stopped: ${summary.stopped ? 'YES' : 'no'}`)
  lines.push('')

  const attempted = new Set(summary.rows.map((row) => row.code.toUpperCase()))
  const notAttempted: string[] = []
  for (const entry of entries) {
    const code = entry.code.toUpperCase()
    if (!attempted.has(code) && !notAttempted.includes(code)) notAttempted.push(code)
  }
  lines.push(`--- NEVER ATTEMPTED (${notAttempted.length}) ---`)
  lines.push(notAttempted.length ? notAttempted.join(', ') : '(none — every input line produced a result row)')
  lines.push('')

  const problems = summary.rows.filter((row) => row.status === 'error' || row.status === 'timeout')
  lines.push(`--- PROBLEM ROWS (${problems.length}) ---`)
  if (!problems.length) {
    lines.push('(none)')
  } else {
    problems.forEach((row, index) => {
      lines.push(`[${index + 1}] ${row.code}${row.label ? ` (${row.label})` : ''} — ${row.status}`)
      lines.push(`    message: ${row.message ?? '(none)'}`)
      if (row.debug?.request) {
        lines.push(`    request: ${row.debug.request.path} ${JSON.stringify(row.debug.request.payload)}`)
      }
      if (row.debug?.response) {
        const r = row.debug.response
        lines.push(`    response: HTTP ${r.status} ${r.statusText} | ${r.contentType || '(no content-type)'}`)
        lines.push(`    body: ${r.body || '(empty)'}`)
      }
      if (row.debug?.observer) lines.push(`    observer: ${row.debug.observer}`)
      if (row.debug?.note) lines.push(`    note: ${row.debug.note}`)
    })
  }
  lines.push('')

  const skipped = summary.rows.filter(
    (row) => row.status === 'skipped-known' || row.status === 'duplicate',
  )
  lines.push(`--- ALREADY REGISTERED / SKIPPED (${skipped.length}) ---`)
  lines.push(skipped.length
    ? skipped.map((row) => `${row.code}${row.message ? ` — ${row.message}` : ''}`).join('\n')
    : '(none)')
  lines.push('')

  const ok = summary.rows.filter((row) => row.status === 'created')
  lines.push(`--- CREATED ROWS (${ok.length}, first 10) ---`)
  for (const row of ok.slice(0, 10)) {
    lines.push(`${row.code}${row.recordId ? ` → #${row.recordId}` : ''}${row.debug?.observer ? ` [observer: ${row.debug.observer}]` : ''}`)
  }
  return lines.join('\n')
}

export function formatCandidate(candidate: StudentCandidate): string {
  const code = candidate.code ? ` (${candidate.code})` : ''
  return `${candidate.name || t('data.student')}${code}`
}
