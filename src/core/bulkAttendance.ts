import { getUndoRedoController } from './undoRedo'

const CODE_RE = /^[A-Z0-9_-]{3,80}$/

export interface BulkParseResult {
  codes: string[]
  duplicates: string[]
  invalid: string[]
  totalTokens: number
}

export interface BulkPreview {
  parse: BulkParseResult
  lessonId: string | null
  pageLessonId: string | null
  knownCodes: readonly string[]
  alreadyPresent: string[]
  toSubmit: string[]
  chunkCount: number
}

export interface ScanFormInfo {
  form: HTMLFormElement
  input: HTMLInputElement
  lessonId: string | null
  inputSelector: string
}

export type BulkRowStatus = 'created' | 'duplicate' | 'skipped-known' | 'timeout' | 'error' | 'stopped'

export interface BulkRowResult {
  code: string
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

export function parseBulkCodes(text: string): BulkParseResult {
  const normalized = normalizeDigits(text).toUpperCase()
  const tokens = normalized
    .split(/[\s,\u060C;\u061B]+|و+/g)
    .map((token) => token.trim())
    .filter(Boolean)

  const seen = new Set<string>()
  const codes: string[] = []
  const duplicates: string[] = []
  const invalid: string[] = []

  for (const token of tokens) {
    if (!CODE_RE.test(token)) {
      invalid.push(token)
      continue
    }
    if (seen.has(token)) {
      duplicates.push(token)
      continue
    }
    seen.add(token)
    codes.push(token)
  }

  return { codes, duplicates, invalid, totalTokens: tokens.length }
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
    return { form, input, lessonId, inputSelector: describeInput(input) }
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

export function buildPreview(text: string, lessonId: string | null): BulkPreview {
  const parse = parseBulkCodes(text)
  const undoRedo = getUndoRedoController()
  const knownCodes = undoRedo.knownRecordCodes
  const knownSet = new Set(knownCodes.map((code) => code.toUpperCase()))
  const alreadyPresent = parse.codes.filter((code) => knownSet.has(code))
  const toSubmit = parse.codes.filter((code) => !knownSet.has(code))
  const pageLessonId = currentLessonIdFromPage()

  return {
    parse,
    lessonId,
    pageLessonId,
    knownCodes,
    alreadyPresent,
    toSubmit,
    chunkCount: Math.ceil(toSubmit.length / 50),
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

export async function runBulkAttendance(options: {
  codes: string[]
  signal: { stop: boolean }
  onRow: (row: BulkRowResult) => void
  timeoutMs?: number
}): Promise<BulkRunSummary> {
  const undoRedo = getUndoRedoController()
  const timeoutMs = options.timeoutMs ?? 10000
  const rows: BulkRowResult[] = []
  let created = 0
  let duplicates = 0
  let skipped = 0
  let failed = 0
  let stopped = false

  for (const code of options.codes) {
    if (options.signal.stop) {
      stopped = true
      break
    }

    if (undoRedo.knownRecordCodes.includes(code)) {
      const row: BulkRowResult = {
        code,
        status: 'skipped-known',
        message: 'مسجّل بالفعل',
        at: Date.now(),
      }
      rows.push(row)
      skipped++
      options.onRow(row)
      continue
    }

    const scan = detectScanForm()
    if (!scan) {
      const row: BulkRowResult = {
        code,
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
        status: 'error',
        message: 'استجابة غير متوقعة',
        at: Date.now(),
      }
      rows.push(row)
      failed++
      options.onRow(row)
    }

    // Small pause so the page can settle between submissions.
    if (!options.signal.stop) await sleep(150)
  }

  if (options.signal.stop && !stopped) stopped = true

  return { rows, created, duplicates, skipped, failed, stopped }
}
