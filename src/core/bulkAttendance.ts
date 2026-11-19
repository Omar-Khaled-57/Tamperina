import { getUndoRedoController } from './undoRedo'

const CODE_RE = /^[A-Z0-9_-]{3,80}$/

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

export interface ParsedCode {
  kind: 'code'
  key: string
  raw: string
  code: string
}

export interface ParsedName {
  kind: 'name'
  key: string
  raw: string
  query: string
}

export interface ParseEntriesResult {
  codes: ParsedCode[]
  names: ParsedName[]
  duplicates: string[]
  invalid: string[]
  totalTokens: number
}

export type ResolveStatus = 'ready' | 'resolved' | 'ambiguous' | 'not-found' | 'too-many' | 'dropped' | 'loading' | 'error'

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

  const pushCode = (raw: string, token: string): void => {
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
    codes.push({ kind: 'code', key: `c-${++seq}-${code}`, raw: raw.trim() || code, code })
  }

  const pushName = (raw: string): void => {
    const query = raw.trim().replace(/\s+/g, ' ')
    if (!query) return
    totalTokens++
    names.push({ kind: 'name', key: `n-${++seq}-${query}`, raw: query, query })
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Comma/semicolon separated parts. Arabic text -> treat whole line as a name.
    const hasArabic = /[\u0600-\u06FF]/.test(trimmed)
    const parts = hasArabic ? [trimmed] : trimmed.split(/[,\u060C;\u061B]+/).map((p) => p.trim()).filter(Boolean)
    const effectiveParts = parts.length ? parts : [trimmed]

    for (const part of effectiveParts) {
      const upper = part.toUpperCase()
      if (CODE_RE.test(upper) && !/[\u0600-\u06FF]/.test(part)) {
        pushCode(part, upper)
        continue
      }

      // Space-separated codes on a single line/part (e.g. "2349 2350")
      if (!hasArabic) {
        const spaceParts = part.split(/\s+/).map((p) => p.trim()).filter(Boolean)
        if (spaceParts.length > 1 && spaceParts.every((p) => CODE_RE.test(p.toUpperCase()))) {
          for (const sp of spaceParts) pushCode(sp, sp.toUpperCase())
          continue
        }
      }

      // Treat as name (or invalid short token)
      if (/^[A-Z0-9_-]+$/i.test(part) && !isArabicOrNameLike(part) && part.length < 3) {
        totalTokens++
        invalid.push(part)
        continue
      }
      pushName(part)
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

    const response = await fetch(url.href, {
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
    // Single partial match - resolve but keep note; UI can still show it.
    if (candidateMatchesQuery(c, query)) {
      return {
        ...row,
        status: 'resolved',
        code: c.code,
        studentName: c.name,
        candidates,
        message: `مطابقة واحدة: ${c.name} (${c.code || 'بدون كود'})`,
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

function waitForCode(
  code: string,
  timeoutMs: number,
): Promise<import('./undoRedo').AttendanceEvent | 'timeout'> {
  const undoRedo = getUndoRedoController()
  return new Promise((resolve) => {
    let done = false
    const timer = window.setTimeout(() => {
      if (done) return
      done = true
      off()
      resolve('timeout')
    }, timeoutMs)

    const off = undoRedo.onAttendance((event) => {
      if (done) return
      const recordCode = String(event.record.studentCode ?? event.record.username ?? '').toUpperCase()
      if (recordCode && recordCode !== code.toUpperCase()) return
      done = true
      window.clearTimeout(timer)
      off()
      resolve(event)
    })
  })
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
 * School-mode: POST directly to /attendance with payment body for each student.
 * This bypasses the scan form + payment dialog entirely, which is what we want
 * when we've already collected payment info in the bulk UI.
 */
async function submitSchoolAttendance(
  code: string,
  lessonId: string,
  override: PaymentOverride | undefined,
): Promise<{ ok: true, data: Record<string, unknown> } | { ok: false, message: string }> {
  const csrf = getCsrfToken()
  if (!csrf) return { ok: false, message: 'تعذّر قراءة CSRF token من الصفحة.' }

  const status = override?.status ?? 'paid'
  const body: Record<string, unknown> = {
    student: code,
    lesson_id: Number(lessonId),
    source: 'manual',
    payment_status: status,
  }
  if ((status === 'partial' || status === 'discounted') && override?.amountPaid != null) {
    body.amount_paid = override.amountPaid
  }
  if (override?.note) body.payment_note = override.note

  try {
    const response = await fetch('/attendance', {
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
      return { ok: false, message: msg }
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

  for (const entry of options.entries) {
    const code = entry.code.toUpperCase()
    if (options.signal.stop) {
      stopped = true
      break
    }

    if (undoRedo.knownRecordCodes.includes(code)) {
      const row: BulkRowResult = {
        code,
        label: entry.label,
        status: 'skipped-known',
        message: 'مسجّل بالفعل',
        at: Date.now(),
      }
      rows.push(row)
      skipped++
      options.onRow(row)
      continue
    }

    // ---- مدرسة (school) mode: direct fetch, no form/dialog interaction --------
    if (paymentMode === 'school') {
      const lessonId = options.lessonId ?? currentLessonIdFromPage() ?? ''
      if (!lessonId) {
        const row: BulkRowResult = { code, label: entry.label, status: 'error', message: 'رقم الحصة غير معروف.', at: Date.now() }
        rows.push(row); failed++; options.onRow(row); stopped = true; break
      }
      const override = overrideMap.get(code)
      const wait = waitForCode(code, timeoutMs)
      const result = await submitSchoolAttendance(code, lessonId, override)
      if (!result.ok) {
        // No attendance event will fire — cancel the wait
        const row: BulkRowResult = { code, label: entry.label, status: 'error', message: result.message, at: Date.now() }
        rows.push(row); failed++; options.onRow(row)
        // If it's a server error (not a duplicate/validation), stop
        if (!result.message.includes('مسجّل') && !result.message.includes('سبق')) { stopped = true; break }
        continue
      }
      // Wait for the undoRedo observer to confirm the attendance event
      const event = await wait
      if (event === 'timeout') {
        // The POST succeeded but the event didn't come — still count as created
        // (the undoRedo observer may not have caught it, but the record is there)
        const row: BulkRowResult = { code, label: entry.label, status: 'created', message: 'تم التسجيل (تأكيد المراقب لم يصل)', at: Date.now() }
        rows.push(row); created++; options.onRow(row)
      } else if (event.type === 'add') {
        const payLabel = override ? {
          paid: 'كامل', partial: 'جزئي', discounted: 'مخفض', forgotten: 'نسي الفلوس',
        }[override.status] : 'كامل'
        const row: BulkRowResult = { code, label: entry.label, status: 'created', message: `تم التسجيل — ${payLabel}`, recordId: event.record.id, at: Date.now() }
        rows.push(row); created++; options.onRow(row)
      } else if (event.type === 'duplicate') {
        const row: BulkRowResult = { code, label: entry.label, status: 'duplicate', message: 'مسجّل بالفعل', recordId: event.record.id, at: Date.now() }
        rows.push(row); duplicates++; options.onRow(row)
      } else {
        const row: BulkRowResult = { code, label: entry.label, status: 'error', message: 'استجابة غير متوقعة', at: Date.now() }
        rows.push(row); failed++; options.onRow(row)
      }
      if (!options.signal.stop) await sleep(150)
      continue
    }

    // ---- سنتر (center) mode: use the scan form as before ---------------------
    const scan = detectScanForm()
    if (!scan) {
      const row: BulkRowResult = {
        code,
        label: entry.label,
        status: 'error',
        message: 'تعذّر العثور على نموذج/حقل الإدخال',
        at: Date.now(),
      }
      rows.push(row)
      failed++
      options.onRow(row)
      stopped = true
      break
    }

    scan.input.value = code
    const wait = waitForCode(code, timeoutMs)
    submitScanForm(scan.form, scan.input)

    const result = await wait

    if (result === 'timeout') {
      const row: BulkRowResult = {
        code,
        label: entry.label,
        status: 'timeout',
        message: 'لم يصل تأكيد من الخادم',
        at: Date.now(),
      }
      rows.push(row)
      failed++
      options.onRow(row)
      stopped = true
      break
    }

    if (result.type === 'add') {
      const row: BulkRowResult = {
        code,
        label: entry.label,
        status: 'created',
        message: 'تم التسجيل',
        recordId: result.record.id,
        at: Date.now(),
      }
      rows.push(row)
      created++
      options.onRow(row)
    } else if (result.type === 'duplicate') {
      const row: BulkRowResult = {
        code,
        label: entry.label,
        status: 'duplicate',
        message: 'مسجّل بالفعل',
        recordId: result.record.id,
        at: Date.now(),
      }
      rows.push(row)
      duplicates++
      options.onRow(row)
    } else {
      const row: BulkRowResult = {
        code,
        label: entry.label,
        status: 'error',
        message: 'استجابة غير متوقعة',
        at: Date.now(),
      }
      rows.push(row)
      failed++
      options.onRow(row)
    }

    if (!options.signal.stop) await sleep(150)
  }

  if (options.signal.stop && !stopped) stopped = true

  return { rows, created, duplicates, skipped, failed, stopped }
}

export function formatCandidate(candidate: StudentCandidate): string {
  const code = candidate.code ? ` (${candidate.code})` : ''
  return `${candidate.name || 'طالب'}${code}`
}
