import { unsafeWindow } from '$'
import { getUndoRedoController } from './undoRedo'

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

export interface BulkRowResult {
  code: string
  label?: string
  status: BulkRowStatus
  message?: string
  recordId?: string
  at: number
}

export interface BulkRunSummary {
  rows: BulkRowResult[]
  created: number
  duplicates: number
  skipped: number
  failed: number
  stopped: boolean
}

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
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

export function detectScanForm(): ScanFormInfo | null {
  const form = (document.getElementById('scanForm')
    ?? document.querySelector('form[action*="attendance"]')) as HTMLFormElement | null
  if (!form) return null

  const lessonId = form.dataset.voiceLessonId
    ?? form.dataset.lessonId
    ?? new URL(location.href).searchParams.get('lesson_id')
    ?? null
  const studentsUrl = form.dataset.voiceStudentsUrl
    ?? form.dataset.studentsUrl
    ?? null

  const selectors = [
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
  if (!scan?.studentsUrl) return { error: 'رابط البحث عن الطلاب غير متاح في الصفحة.' }

  try {
    const url = new URL(scan.studentsUrl, location.href)
    url.searchParams.set('lesson_id', lessonId)
    url.searchParams.set('q', query)
    url.searchParams.set('limit', '100')

    const response = await pageFetch()(url.href, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return { error: `تعذر البحث (${response.status})` }

    const json = await response.json()
    if (!Array.isArray(json)) return { error: 'استجابة بحث غير متوقعة.' }
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
    return { error: error instanceof Error ? error.message : 'تعذر الاتصال أثناء البحث.' }
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
    return { ...row, status: 'not-found', candidates: [], message: 'الاسم فارغ.' }
  }

  const result = await searchStudents(query, lessonId)
  if ('error' in result) {
    return { ...row, status: 'error', candidates: [], message: result.error }
  }
  if ('tooMany' in result) {
    return { ...row, status: 'too-many', candidates: [], message: 'نتائج كثيرة جدًا — حدّد الاسم أكثر أو استخدم الكود.' }
  }

  const candidates = result
  if (!candidates.length) {
    return { ...row, status: 'not-found', candidates: [], message: 'لم يتم العثور على طالب مطابق.' }
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
      message: `تم التعرف: ${c.name} (${c.code || 'بدون كود'})`,
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
      message: `مطابقة واحدة: ${c.name} (${c.code || 'بدون كود'})`,
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
        message: `تم الاختيار تلقائيًا: ${chosen.name} (${chosen.code || 'بدون كود'})`,
      }
    }
  }

  return {
    ...row,
    status: 'ambiguous',
    candidates,
    message: candidates.length > 1 ? 'يوجد أكثر من طالب مطابق — اختر الصحيح.' : 'تعذّر التأكد من المطابقة.',
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
    if (recordCode && recordCode !== code.toUpperCase()) return
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
async function submitSchoolAttendance(
  code: string,
  lessonId: string,
  override: PaymentOverride | undefined,
): Promise<{ ok: true, data: Record<string, unknown> } | { ok: false, message: string, status?: number }> {
  const csrf = getCsrfToken()
  if (!csrf) return { ok: false, message: 'تعذّر قراءة CSRF token من الصفحة.' }

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
    const data = await response.json() as Record<string, unknown>
    if (!response.ok) {
      const errors = data.errors as Record<string, string[]> | undefined
      const msg = String(data.message ?? (errors ? Object.values(errors).flat()[0] : '') ?? 'خطأ غير معروف')
      return { ok: false, message: msg, status: response.status }
    }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'تعذّر الاتصال بالخادم.' }
  }
}

export async function runBulkAttendance(options: {
  entries: Array<{ code: string, label?: string }>
  signal: { stop: boolean }
  onRow: (row: BulkRowResult) => void
  timeoutMs?: number
  paymentMode?: PaymentMode
  paymentOverrides?: PaymentOverride[]
  lessonId?: string
}): Promise<BulkRunSummary> {
  const undoRedo = getUndoRedoController()
  const timeoutMs = options.timeoutMs ?? 10000
  const paymentMode = options.paymentMode ?? 'center'
  const overrideMap = new Map<string, PaymentOverride>(
    (options.paymentOverrides ?? []).map((o) => [o.studentCode.toUpperCase(), o]),
  )
  const rows: BulkRowResult[] = []
  let created = 0
  let duplicates = 0
  let skipped = 0
  let failed = 0
  let stopped = false

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
      recordRow({ code: '', status: 'error', message: 'رقم الحصة غير معروف.', at: Date.now() })
      return { rows, created, duplicates, skipped, failed, stopped: true }
    }

    const known = new Set(undoRedo.knownRecordCodes.map((c) => c.toUpperCase()))
    const toRun: Array<{ code: string, label?: string }> = []
    const queued = new Set<string>()
    for (const entry of options.entries) {
      const code = entry.code.toUpperCase()
      if (options.signal.stop) {
        stopped = true
        break
      }
      if (known.has(code)) {
        recordRow({ code, label: entry.label, status: 'skipped-known', message: 'مسجّل بالفعل', at: Date.now() })
        continue
      }
      if (queued.has(code)) {
        recordRow({ code, label: entry.label, status: 'duplicate', message: 'مكرر في القائمة — لم يُرسل مرتين', at: Date.now() })
        continue
      }
      queued.add(code)
      toRun.push({ code, label: entry.label })
    }

    const duplicateMessage = (message: string): boolean =>
      /مسجّ?ل|سبق|موجود|مكرر|duplicate|already/i.test(message)

    const concurrency = 10
    let index = 0

    const worker = async (): Promise<void> => {
      while (true) {
        if (options.signal.stop) {
          stopped = true
          return
        }
        const i = index++
        if (i >= toRun.length) return
        const entry = toRun[i]
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
          })
          if (!duplicate) {
            options.signal.stop = true
            stopped = true
          }
          continue
        }
        // Confirmation must come from the shared observer: a record we cannot
        // undo must never be reported as part of the reversible batch.
        const event = await Promise.race([
          wait.promise,
          sleep(Math.min(timeoutMs, 4000)).then(() => 'timeout' as const),
        ])
        wait.cancel()
        if (event === 'timeout') {
          const id = result.data.id ?? result.data.record_id
          recordRow({
            code,
            label: entry.label,
            status: 'error',
            message: `تم الإرسال لكن لم يصل تأكيد المراقب — راجع السجل يدويًا${id == null ? '' : ` (#${id})`}`,
            recordId: id == null ? undefined : String(id),
            at: Date.now(),
          })
          options.signal.stop = true
          stopped = true
        } else if (event.type === 'add') {
          undoRedo.ensureAttendanceRecorded(event.record)
          const payLabel = override ? {
            paid: 'كامل', partial: 'جزئي', discounted: 'مخفض', forgotten: 'نسي/مؤجل',
          }[override.status] : 'افتراضي الحصة'
          recordRow({ code, label: entry.label, status: 'created', message: `تم التسجيل — ${payLabel}`, recordId: event.record.id, at: Date.now() })
        } else if (event.type === 'duplicate') {
          recordRow({ code, label: entry.label, status: 'duplicate', message: 'مسجّل بالفعل', recordId: event.record.id, at: Date.now() })
        } else {
          recordRow({ code, label: entry.label, status: 'error', message: 'استجابة غير متوقعة', at: Date.now() })
          options.signal.stop = true
          stopped = true
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, toRun.length || 1) }, () => worker())
    await Promise.all(workers)
    if (options.signal.stop && !stopped) stopped = true
    return { rows, created, duplicates, skipped, failed, stopped }
  }

  // ---- سنتر (center) mode: sequential scan-form loop (single input/form) ----
  for (const entry of options.entries) {
    const code = entry.code.toUpperCase()
    if (options.signal.stop) {
      stopped = true
      break
    }

    if (undoRedo.knownRecordCodes.includes(code)) {
      recordRow({ code, label: entry.label, status: 'skipped-known', message: 'مسجّل بالفعل', at: Date.now() })
      continue
    }

    const scan = detectScanForm()
    if (!scan) {
      recordRow({ code, label: entry.label, status: 'error', message: 'تعذّر العثور على نموذج/حقل الإدخال', at: Date.now() })
      stopped = true
      break
    }

    scan.input.value = code
    const wait = waitForCode(code, timeoutMs)
    submitScanForm(scan.form, scan.input)

    const result = await wait.promise

    if (result === 'timeout') {
      recordRow({ code, label: entry.label, status: 'timeout', message: 'لم يصل تأكيد من الخادم', at: Date.now() })
      stopped = true
      break
    }

    if (result.type === 'add') {
      undoRedo.ensureAttendanceRecorded(result.record)
      recordRow({ code, label: entry.label, status: 'created', message: 'تم التسجيل', recordId: result.record.id, at: Date.now() })
    } else if (result.type === 'duplicate') {
      recordRow({ code, label: entry.label, status: 'duplicate', message: 'مسجّل بالفعل', recordId: result.record.id, at: Date.now() })
    } else {
      recordRow({ code, label: entry.label, status: 'error', message: 'استجابة غير متوقعة', at: Date.now() })
    }

    // Minimal pacing to let the form/site settle between submissions.
    if (!options.signal.stop) await sleep(20)
  }

  if (options.signal.stop && !stopped) stopped = true

  return { rows, created, duplicates, skipped, failed, stopped }
}

export function formatCandidate(candidate: StudentCandidate): string {
  const code = candidate.code ? ` (${candidate.code})` : ''
  return `${candidate.name || 'طالب'}${code}`
}
