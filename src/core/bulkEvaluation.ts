import {
  evaluationRows,
  rowCode,
  rowName,
  rowLabel,
  normalizeDigits,
  normalizeLabel,
  examScoreInput,
  homeworkSelect,
  mainGradeSelect,
  findOptionByLabel,
  setSelectValue,
  setExamScore,
  gradeFromOptionText,
  commitExamTyping,
  isEvaluationPage,
} from './evaluation'
import { getUndoRedoController } from './undoRedo'

export interface EvalStudentCandidate {
  code: string
  name: string
}

export interface EvalValues {
  exam?: string
  homework?: string
}

export type EvalValueKind = 'exam' | 'homework'

export interface ParsedEvalLine {
  key: string
  raw: string
  identifier: string
  values: EvalValues
  /** True when two numeric values were provided and user must choose mapping. */
  ambiguousNumbers: boolean
  /** Original numeric tokens when ambiguousNumbers is true, in input order. */
  numberTokens?: [string, string]
  /** If the identifier is clearly a code/ID token. */
  identifierIsCode: boolean
}

export interface ParseEvalResult {
  entries: ParsedEvalLine[]
  invalid: string[]
  duplicates: string[]
  totalLines: number
}

export type EvalResolveStatus =
  | 'ready'
  | 'resolved'
  | 'ambiguous'
  | 'not-found'
  | 'too-many'
  | 'dropped'
  | 'numbers-ambiguous'
  | 'error'

export interface EvalNameRow {
  key: string
  raw: string
  identifier: string
  query: string
  values: EvalValues
  ambiguousNumbers: boolean
  numberTokens?: [string, string]
  status: EvalResolveStatus
  code?: string
  studentName?: string
  candidates: EvalStudentCandidate[]
  message?: string
}

export interface EvalDirectRow {
  key: string
  raw: string
  identifier: string
  code: string
  studentName?: string
  values: EvalValues
  ambiguousNumbers: boolean
  numberTokens?: [string, string]
  status: EvalResolveStatus
  message?: string
}

export type EvalRowStatus = 'applied' | 'partial' | 'not-found' | 'missing-field' | 'invalid' | 'error' | 'stopped' | 'skipped'

export interface EvalRowResult {
  key: string
  label: string
  status: EvalRowStatus
  message?: string
  at: number
}

export interface EvalRunSummary {
  rows: EvalRowResult[]
  applied: number
  partial: number
  failed: number
  skipped: number
  stopped: boolean
}

const KNOWN_GRADE_TEXTS = new Set(['امتياز', 'جيد جدا', 'جيد', 'مقبول', 'ضعيف', 'الواجب ناقص'])

function normId(value: string): string {
  return normalizeDigits(value).trim().toUpperCase()
}

function normName(value: string): string {
  return normalizeLabel(value)
}

function looksLikeCode(value: string): boolean {
  const v = normId(value)
  return /^[A-Z0-9_-]{2,20}$/.test(v) && /\d/.test(v)
}

function isNumberToken(value: string): boolean {
  const v = normalizeDigits(value).trim()
  return /^-?\d+(?:[.,]\d+)?$/.test(v)
}

function normalizeNumberToken(value: string): string {
  return normalizeDigits(value).trim().replace(',', '.')
}

function isGradeTextToken(value: string): boolean {
  const v = normalizeDigits(value).replace(/\s+/g, ' ').trim()
  if (!v) return false
  if (gradeFromOptionText(v)) return true
  const n = normalizeLabel(v)
  for (const key of KNOWN_GRADE_TEXTS) {
    const nk = normalizeLabel(key)
    if (n === nk || n.includes(nk)) return true
  }
  return false
}

function splitLine(line: string): string[] {
  // Split on commas and Arabic comma; keep backslash as separator too.
  // Also allow "name\id" style where backslash appears - treat '\' as separator
  // but if it yields an id-like token at start we rejoin carefully below.
  return line
    .split(/[،,\t]+/)
    .flatMap((part) => part.split(/\\/))
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseValues(tokens: string[]): { values: EvalValues; ambiguousNumbers: boolean; numberTokens?: [string, string]; error?: string } {
  if (tokens.length === 0) return { values: {}, ambiguousNumbers: false, error: 'لا توجد قيم' }
  if (tokens.length > 2) return { values: {}, ambiguousNumbers: false, error: 'حقول كثيرة' }

  const classified = tokens.map((t) => {
    if (isGradeTextToken(t)) return { type: 'homework' as const, value: normalizeDigits(t).replace(/\s+/g, ' ').trim() }
    if (isNumberToken(t)) return { type: 'exam' as const, value: normalizeNumberToken(t) }
    return { type: 'unknown' as const, value: t.trim() }
  })

  if (classified.some((c) => c.type === 'unknown')) {
    return { values: {}, ambiguousNumbers: false, error: 'قيمة غير مفهومة' }
  }

  if (classified.length === 1) {
    const c = classified[0]
    return {
      values: c.type === 'exam' ? { exam: c.value } : { homework: c.value },
      ambiguousNumbers: false,
    }
  }

  const [a, b] = classified
  if (a.type === 'exam' && b.type === 'homework') return { values: { exam: a.value, homework: b.value }, ambiguousNumbers: false }
  if (a.type === 'homework' && b.type === 'exam') return { values: { homework: a.value, exam: b.value }, ambiguousNumbers: false }
  if (a.type === 'homework' && b.type === 'homework') {
    // Two text grades are not a valid exam+homework pair for this bulk flow.
    return { values: {}, ambiguousNumbers: false, error: 'درجتا واجب بدون درجة امتحان' }
  }
  // Two numbers: ambiguous mapping, user must choose.
  return {
    values: {},
    ambiguousNumbers: true,
    numberTokens: [a.value, b.value],
  }
}

export function parseEvaluationEntries(text: string): ParseEvalResult {
  const lines = text.split(/\r?\n/)
  const entries: ParsedEvalLine[] = []
  const invalid: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()
  let seq = 0
  let totalLines = 0

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    totalLines++

    const parts = splitLine(trimmed)
    if (parts.length < 2) {
      invalid.push(trimmed)
      continue
    }

    // Identifier is the first token. (If user wrote name\id and split produced
    // separate tokens, prefer keeping first as identifier string; matching will
    // try code/name forms. Also handle "name \ id, ..." by re-joining leading
    // name-like parts is hard generally, but common case is single identifier.)
    let identifier = parts[0]
    let valueTokens = parts.slice(1)

    // Heuristic: handle "Name \ 1234, 9.5" split into ["Name", "1234", "9.5"]
    // where middle token is code-like and following are values -> treat as
    // identifier "1234" (code) but keep raw; actually better to use code token
    // as identifier if second is code-like and first looks like name and third+
    // look like values. Also handle "1234 \ Name" less common.
    if (parts.length >= 3) {
      const a = parts[0]
      const b = parts[1]
      const rest = parts.slice(2)
      const aCode = looksLikeCode(a)
      const bCode = looksLikeCode(b)
      const aName = !aCode && /[\u0600-\u06FF]/.test(a)
      if (aName && bCode && rest.length >= 1) {
        identifier = b // prefer code
        valueTokens = rest
      } else if (aCode && !bCode && /[\u0600-\u06FF]/.test(b) && rest.length >= 1) {
        identifier = a
        valueTokens = rest
      }
    }

    const parsed = parseValues(valueTokens)
    if (parsed.error && !parsed.ambiguousNumbers) {
      invalid.push(trimmed)
      continue
    }

    const dedupeKey = `${normId(identifier)}|${normName(identifier)}|${trimmed}`
    if (seen.has(dedupeKey)) {
      duplicates.push(trimmed)
      continue
    }
    seen.add(dedupeKey)

    entries.push({
      key: `e-${++seq}`,
      raw: trimmed,
      identifier,
      values: parsed.values,
      ambiguousNumbers: parsed.ambiguousNumbers,
      numberTokens: parsed.numberTokens,
      identifierIsCode: looksLikeCode(identifier),
    })
  }

  return { entries, invalid, duplicates, totalLines }
}

export function collectPageCandidates(): EvalStudentCandidate[] {
  if (!isEvaluationPage()) return []
  return evaluationRows().map((row) => ({
    code: normId(rowCode(row)),
    name: rowName(row),
  })).filter((c) => c.code || c.name)
}

export function matchIdentifier(identifier: string): { status: EvalResolveStatus; code?: string; studentName?: string; candidates: EvalStudentCandidate[]; message?: string } {
  const candidates = collectPageCandidates()
  const idNorm = normId(identifier)
  const nameNorm = normName(identifier)

  // Try exact code match first
  if (idNorm) {
    const byCode = candidates.filter((c) => c.code && c.code === idNorm)
    if (byCode.length === 1) {
      return { status: 'ready', code: byCode[0].code, studentName: byCode[0].name, candidates: byCode }
    }
  }

  // Try exact name match
  if (nameNorm) {
    const exact = candidates.filter((c) => normName(c.name) === nameNorm)
    if (exact.length === 1) {
      return { status: 'ready', code: exact[0].code || undefined, studentName: exact[0].name, candidates: exact }
    }
    if (exact.length > 1) {
      return { status: 'ambiguous', candidates: exact, message: 'الاسم مطابق لأكثر من طالب — اختر الصحيح' }
    }
  }

  // Try contains / fuzzy-ish: name contains query or query contains name
  if (nameNorm && nameNorm.length >= 2) {
    const partial = candidates.filter((c) => {
      const cn = normName(c.name)
      return cn && (cn.includes(nameNorm) || nameNorm.includes(cn))
    })
    if (partial.length === 1) {
      return { status: 'ready', code: partial[0].code || undefined, studentName: partial[0].name, candidates: partial }
    }
    if (partial.length > 1 && partial.length <= 12) {
      return { status: 'ambiguous', candidates: partial, message: 'وُجد أكثر من طالب مشابه — اختر الصحيح' }
    }
    if (partial.length > 12) {
      return { status: 'too-many', candidates: partial.slice(0, 12), message: 'نتائج كثيرة جدًا — حدّد الاسم أكثر' }
    }
  }

  // Code-like but not found
  if (looksLikeCode(identifier)) {
    return { status: 'not-found', candidates: [], message: 'لم يُعثر على هذا الكود في صفحة التقييم الحالية' }
  }

  return { status: 'not-found', candidates: [], message: 'لم يُعثر على الطالب في صفحة التقييم الحالية' }
}

export function findRowForCode(code: string): HTMLElement | null {
  const want = normId(code)
  if (!want) return null
  return evaluationRows().find((row) => normId(rowCode(row)) === want) ?? null
}

export async function applyEvaluationToRow(
  row: HTMLElement,
  values: EvalValues,
): Promise<{ status: EvalRowStatus; message?: string }> {
  commitExamTyping()
  let appliedAny = false
  let missing: string[] = []

  if (values.exam != null) {
    const input = examScoreInput(row)
    if (!input) {
      missing.push('درجة الامتحان')
    } else {
      setExamScore(row, values.exam)
      appliedAny = true
    }
  }

  if (values.homework != null) {
    const hwSelect = homeworkSelect(row) ?? mainGradeSelect(row)
    if (!hwSelect) {
      missing.push('درجة الواجب')
    } else {
      const option = findOptionByLabel(hwSelect, values.homework)
      if (!option) {
        missing.push(`خيار الواجب «${values.homework}»`)
      } else {
        setSelectValue(hwSelect, option.value)
        appliedAny = true
      }
    }
  }

  // Best-effort save: dispatch blur and try clicking obvious save controls.
  try {
    const active = document.activeElement as HTMLElement | null
    if (active && row.contains(active)) active.blur()
  } catch { /* ignore */ }

  // Attempt to trigger row/page save buttons if present (best-effort, unknown behavior).
  try {
    const saveBtn = row.querySelector<HTMLButtonElement | HTMLInputElement>(
      'button[type="submit"], input[type="submit"], button.save, .btn-save, [data-action="save"]'
    ) ?? Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find((b) => /حفظ|save/i.test(b.textContent || ''))
    if (saveBtn && !(saveBtn as HTMLButtonElement).disabled) {
      saveBtn.click()
    } else {
      const form = row.querySelector('form') ?? row.closest('form')
      if (form) {
        // Some pages auto-save on change; avoid double-submitting blindly.
        // If a submit event is needed, requestSubmit is safer than submit().
        if (typeof (form as HTMLFormElement).requestSubmit === 'function') {
          // only if form looks row-scoped
          if (row.contains(form) || form.contains(row)) (form as HTMLFormElement).requestSubmit()
        }
      }
    }
  } catch { /* best-effort */ }

  if (!appliedAny && missing.length) {
    return { status: 'missing-field', message: `لم يُعثر على: ${missing.join('، ')}` }
  }
  if (appliedAny && missing.length) {
    return { status: 'partial', message: `تم جزئيًا — تعذّر: ${missing.join('، ')}` }
  }
  if (!appliedAny) {
    return { status: 'skipped', message: 'لا توجد قيم للتطبيق' }
  }
  return { status: 'applied' }
}

export function formatEvalLabel(code?: string, name?: string, fallback?: string): string {
  if (name && code) return `${name} (${code})`
  return name || code || fallback || 'طالب'
}

