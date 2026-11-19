import { toast } from './toast'
import { getUndoRedoController } from './undoRedo'

/**
 * /evaluation helpers shared by the three new toggles:
 * - student selection (row highlight + hotkeys),
 * - find-bar targeting (4-digit code selection),
 * - homework grade buttons.
 */

export type EvaluationFeatureId = 'student-select' | 'evaluation-find' | 'homework-buttons'
export type GradeKey = 'امتياز' | 'جيد جدا' | 'جيد' | 'مقبول' | 'ضعيف' | 'الواجب ناقص'

const FEATURE_IDS: EvaluationFeatureId[] = ['student-select', 'evaluation-find', 'homework-buttons']
const SELECTED_CLASS = 'tamperina-selected'
const HOMEWORK_WRAPPER_CLASS = 'tamperina-grade-buttons'
const HIDDEN_SELECT_CLASS = 'tamperina-homework-select-hidden'
const STYLE_ID = 'tamperina-evaluation-styles'
const ROW_SELECTOR = '.evaluation-table tbody tr'

interface GradeDefinition {
  key: GradeKey
  keys: string[]
  codes: string[]
}

/** Physical keys are listed as well as characters so both Arabic and Latin layouts work. */
const GRADE_DEFINITIONS: GradeDefinition[] = [
  { key: 'امتياز', keys: ['?', '؟', 'h', 'H', 'ا'], codes: ['KeyH'] },
  { key: 'جيد جدا', keys: ['ج', '[', '{'], codes: ['KeyJ', 'BracketLeft'] },
  { key: 'جيد', keys: ['ح', 'p', 'P'], codes: ['KeyP'] },
  { key: 'مقبول', keys: ['م', 'l', 'L'], codes: ['KeyL'] },
  { key: 'ضعيف', keys: ['ض', 'q', 'Q'], codes: ['KeyQ'] },
  { key: 'الواجب ناقص', keys: ['ن', 'k', 'K'], codes: ['KeyK'] },
]

const GLOBAL_STYLES = `
.${SELECTED_CLASS} {
  outline: 2px solid #f2ceaa !important;
  outline-offset: -2px;
  background-color: rgba(242, 206, 170, 0.14) !important;
}
.${HIDDEN_SELECT_CLASS} { display: none !important; }
.${HOMEWORK_WRAPPER_CLASS} {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.tamperina-grade-btn {
  padding: 4px 9px;
  border: 1px solid currentColor;
  border-radius: 999px;
  background: rgba(10, 6, 3, 0.55);
  color: #f8efe7;
  font: 700 11px/1.5 Cairo, Tajawal, Tahoma, sans-serif;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}
.tamperina-grade-btn:hover { transform: translateY(-1px); background: rgba(242, 206, 170, 0.14); }
.tamperina-grade-btn[data-grade="امتياز"] {
  color: #83e6ad;
  box-shadow: 0 0 10px rgba(131, 230, 173, 0.55), inset 0 0 6px rgba(131, 230, 173, 0.25);
}
.tamperina-grade-btn[data-grade="جيد جدا"] {
  color: #77d7e6;
  box-shadow: 0 0 10px rgba(119, 215, 230, 0.5), inset 0 0 6px rgba(119, 215, 230, 0.22);
}
.tamperina-grade-btn[data-grade="جيد"] {
  color: #f2d071;
  box-shadow: 0 0 10px rgba(242, 208, 113, 0.5), inset 0 0 6px rgba(242, 208, 113, 0.22);
}
.tamperina-grade-btn[data-grade="مقبول"] {
  color: #f2aa71;
  box-shadow: 0 0 10px rgba(242, 170, 113, 0.5), inset 0 0 6px rgba(242, 170, 113, 0.22);
}
.tamperina-grade-btn[data-grade="ضعيف"] {
  color: #ef8b81;
  box-shadow: 0 0 10px rgba(239, 139, 129, 0.5), inset 0 0 6px rgba(239, 139, 129, 0.22);
}
.tamperina-grade-btn[data-grade="الواجب ناقص"] {
  color: #c6a9f2;
  box-shadow: 0 0 10px rgba(198, 169, 242, 0.5), inset 0 0 6px rgba(198, 169, 242, 0.22);
}
::highlight(tamperina-find) { background: rgba(242, 206, 170, 0.65); color: #17100b; }
.tamperina-find-hit td { background-color: rgba(242, 206, 170, 0.08) !important; }
.tamperina-find-current td { background-color: rgba(242, 206, 170, 0.18) !important; }
`

let initialised = false
let selectedRow: HTMLElement | null = null
let typing: { row: HTMLElement, text: string } | null = null
let commitTimer = 0
let rowsTimer = 0

const selectionListeners = new Set<() => void>()
const featureListeners = new Set<() => void>()
const rowListeners = new Set<() => void>()

export function isEvaluationPage(): boolean {
  return location.pathname.replace(/\/$/, '') === '/evaluation'
}

export function isEvaluationFeatureId(id: string): id is EvaluationFeatureId {
  return (FEATURE_IDS as string[]).includes(id)
}

export function normalizeDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (char) => String(char.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (char) => String(char.charCodeAt(0) - 0x06F0))
}

export function normalizeLabel(value: string): string {
  return normalizeDigits(value)
    .replace(/[\u0640\u200F\u200E]/g, '')
    .replace(/[\u0622\u0623\u0625]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\s+/g, ' ')
    .trim()
}

export function evaluationRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR))
}

export function rowCode(row: HTMLElement): string {
  const info = row.querySelector('.evaluation-student__info small')?.textContent?.trim() ?? ''
  return normalizeDigits(info.split('·')[0]?.trim() ?? '')
    || normalizeDigits(row.getAttribute('data-student-code') ?? '')
    || normalizeDigits(row.getAttribute('data-student-id') ?? '')
    || normalizeDigits(row.querySelector('.student-code')?.textContent?.trim() ?? '')
}

export function rowName(row: HTMLElement): string {
  return row.querySelector('.evaluation-student__info strong')?.textContent?.trim() || ''
}

export function rowLabel(row: HTMLElement): string {
  const name = rowName(row)
  const code = rowCode(row)
  return name && code ? `${name} (${code})` : name || code || 'الطالب'
}

// ---- toggles ----------------------------------------------------------------

export function isFeatureEnabled(id: EvaluationFeatureId): boolean {
  try {
    const raw = localStorage.getItem(`tamperina_${id}`)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

export function setFeatureEnabled(id: EvaluationFeatureId, enabled: boolean): void {
  try {
    localStorage.setItem(`tamperina_${id}`, String(enabled))
  } catch {
    // Storage may be unavailable; in-memory state still works for this load.
  }
  notifyFeatures()
}

export function featureStateSignature(): string {
  return FEATURE_IDS.map((id) => `${id}:${isFeatureEnabled(id)}`).join('|')
}

export function subscribeFeatures(listener: () => void): () => void {
  featureListeners.add(listener)
  return () => featureListeners.delete(listener)
}

export function subscribeSelection(listener: () => void): () => void {
  selectionListeners.add(listener)
  return () => selectionListeners.delete(listener)
}

export function subscribeRows(listener: () => void): () => void {
  rowListeners.add(listener)
  return () => rowListeners.delete(listener)
}

function notifyFeatures(): void {
  for (const listener of featureListeners) listener()
}

function notifyRows(): void {
  window.clearTimeout(rowsTimer)
  rowsTimer = window.setTimeout(() => {
    for (const listener of rowListeners) listener()
    applyHomeworkButtons()
  }, 50)
}

// ---- selection ---------------------------------------------------------------

export function getSelectedRow(): HTMLElement | null {
  return selectedRow && selectedRow.isConnected ? selectedRow : null
}

export function selectRow(row: HTMLElement | null, options?: { silent?: boolean }): void {
  if (selectedRow === row) return
  commitExamTyping()
  if (selectedRow) selectedRow.classList.remove(SELECTED_CLASS)
  selectedRow = row
  if (row) {
    row.classList.add(SELECTED_CLASS)
    if (!options?.silent) {
      toast({ title: 'تم تحديد الطالب', description: rowLabel(row), variant: 'info', duration: 2500 })
    }
  }
  for (const listener of selectionListeners) listener()
}

// ---- grade controls -----------------------------------------------------------

function selectLabels(select: HTMLSelectElement): string {
  const id = select.id
  const labels = Array.from(document.querySelectorAll<HTMLLabelElement>('label'))
    .filter((label) => (id && label.htmlFor === id) || label.contains(select))
    .map((label) => label.textContent ?? '')
  return `${select.name} ${id} ${select.getAttribute('aria-label') ?? ''} ${labels.join(' ')}`
}

function hasGradeOption(select: HTMLSelectElement): boolean {
  return Array.from(select.options).some((option) => {
    const text = normalizeLabel(option.textContent ?? '')
    return GRADE_DEFINITIONS.some((definition) => text.includes(normalizeLabel(definition.key)))
  })
}

function hasHomeworkLabel(select: HTMLSelectElement): boolean {
  return /واجب|homework|\bhw\b/i.test(selectLabels(select))
}

function hasHomeworkOnlyOption(select: HTMLSelectElement): boolean {
  return Array.from(select.options).some((option) => {
    const text = normalizeLabel(option.textContent ?? '')
    return text === 'واجب' || text === 'الواجب'
  })
}

function rowSelects(row: HTMLElement): HTMLSelectElement[] {
  return Array.from(row.querySelectorAll<HTMLSelectElement>('select'))
}

export function mainGradeSelect(row: HTMLElement): HTMLSelectElement | null {
  const selects = rowSelects(row)
  const exact = selects.find((select) => /^(grade|evaluation|estimation)$/i.test(select.name))
  if (exact) return exact
  const candidates = selects.filter((select) => !hasHomeworkLabel(select))
  const withGrades = candidates.filter(hasGradeOption)
  return withGrades[0] ?? candidates[0] ?? selects[0] ?? null
}

export function homeworkSelect(row: HTMLElement): HTMLSelectElement | null {
  const selects = rowSelects(row)
  const main = mainGradeSelect(row)

  // A homework label/name is the strongest signal (e.g. "تقييم الواجب").
  // Do NOT require grade-looking options here: homework selects usually use
  // their own wording ("واجب كامل", "ناقص", ...) that won't match the main
  // grade scale, which used to make detection fail and leave the dropdown.
  const byLabel = selects.find((select) => select !== main && hasHomeworkLabel(select))
  if (byLabel) return byLabel

  // An option named exactly "واجب" / "الواجب" is specific; "الواجب ناقص" is a
  // grade on the main select, not a homework label.
  const byOption = selects.find((select) => select !== main && hasHomeworkOnlyOption(select))
  if (byOption) return byOption

  // Some tables label the dropdown with plain cell text instead of a <label>.
  const byCell = selects.find((select) => {
    if (select === main) return false
    const cell = select.closest<HTMLElement>('td, th, label')
    return !!cell && /واجب|homework/i.test(cell.textContent ?? '')
  })
  if (byCell) return byCell

  // Fallback: when there is exactly one other select, it must be the homework one.
  const others = selects.filter((select) => select !== main)
  return others.length === 1 ? others[0] : null
}

export function findOptionByLabel(select: HTMLSelectElement, label: string): HTMLOptionElement | null {
  const wanted = normalizeLabel(label)
  const options = Array.from(select.options)
  return options.find((option) => normalizeLabel(option.textContent ?? '') === wanted)
    ?? options.find((option) => normalizeLabel(option.textContent ?? '').includes(wanted))
    ?? options.find((option) => normalizeLabel(option.value) === wanted)
    ?? null
}

export function setSelectValue(select: HTMLSelectElement, value: string): void {
  if (select.value === value) return
  // Remember the saved value before our write so Ctrl+Z can restore it.
  const row = select.closest<HTMLElement>(ROW_SELECTOR)
  if (row) getUndoRedoController().captureGradeBaseline(row)
  select.value = value
  select.dispatchEvent(new Event('input', { bubbles: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

export function setExamScore(row: HTMLElement, value: string): void {
  const input = examScoreInput(row)
  if (!input) return
  // Cancel any in-progress interactive typing so it can't overwrite this value.
  typing = null
  window.clearTimeout(commitTimer)
  getUndoRedoController().captureGradeBaseline(row)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

export function gradeFromOptionText(text: string): GradeKey | '' {
  const normalized = normalizeLabel(text)
  for (const definition of GRADE_DEFINITIONS) {
    const key = normalizeLabel(definition.key)
    if (normalized === key || normalized.includes(key)) return definition.key
  }
  return ''
}

export function gradeForKey(event: KeyboardEvent): GradeKey | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  for (const definition of GRADE_DEFINITIONS) {
    if (definition.keys.some((candidate) => candidate.toLowerCase() === key.toLowerCase())) {
      return definition.key
    }
  }
  for (const definition of GRADE_DEFINITIONS) {
    if (definition.codes.includes(event.code)) return definition.key
  }
  return null
}

export function isExamKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && /[0-9.\u0660-\u0669\u06F0-\u06F9]/.test(event.key)
}

export function examScoreInput(row: HTMLElement): HTMLInputElement | null {
  return row.querySelector<HTMLInputElement>('input[name="exam_score"], input[name="score"]')
}

export function typeExamKey(row: HTMLElement, char: string): void {
  const input = examScoreInput(row)
  if (!input) return
  if (!typing || typing.row !== row) {
    typing = { row, text: '' }
    // Baseline the score before the first keystroke changes the input.
    getUndoRedoController().captureGradeBaseline(row)
  }
  if (char === 'backspace') typing.text = typing.text.slice(0, -1)
  else if (char === '.') {
    if (!typing.text.includes('.')) typing.text += '.'
  } else typing.text += normalizeDigits(char)
  input.value = typing.text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  window.clearTimeout(commitTimer)
  commitTimer = window.setTimeout(commitExamTyping, 400)
}

export function hasExamTyping(): boolean {
  return typing !== null
}

export function commitExamTyping(): void {
  window.clearTimeout(commitTimer)
  if (!typing) return
  const input = examScoreInput(typing.row)
  if (input && input.value === typing.text) {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  typing = null
}

/** Returns true when the key was consumed by the selected student's grade inputs. */
export function handleSelectedRowKey(event: KeyboardEvent, row: HTMLElement): boolean {
  const grade = gradeForKey(event)
  if (grade) {
    commitExamTyping()
    const main = mainGradeSelect(row)
    const option = main ? findOptionByLabel(main, grade) : null
    if (option && main) setSelectValue(main, option.value)
    if (isFeatureEnabled('homework-buttons')) {
      const homework = homeworkSelect(row)
      const homeworkOption = homework ? findOptionByLabel(homework, grade) : null
      if (homework && homeworkOption) setSelectValue(homework, homeworkOption.value)
    }
    return true
  }
  if ((event.key === 'Enter' || event.key === 'Backspace') && !hasExamTyping()) return false
  if (event.key === 'Enter') {
    commitExamTyping()
    return true
  }
  if (event.key === 'Backspace') {
    typeExamKey(row, 'backspace')
    return true
  }
  if (isExamKey(event)) {
    typeExamKey(row, event.key)
    return true
  }
  return false
}

// ---- homework buttons ---------------------------------------------------------

function installHomeworkButtons(row: HTMLElement, select: HTMLSelectElement): void {
  const wrapper = document.createElement('div')
  wrapper.className = HOMEWORK_WRAPPER_CLASS
  for (const option of Array.from(select.options)) {
    const text = (option.textContent ?? '').trim()
    if (!text && !option.value) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'tamperina-grade-btn'
    button.dataset.grade = gradeFromOptionText(text)
    button.dataset.value = option.value
    button.textContent = text || option.value
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      selectRow(row, { silent: true })
      setSelectValue(select, option.value)
    })
    wrapper.appendChild(button)
  }
  ;(wrapper as HTMLElement & { tamperinaSelect?: HTMLSelectElement }).tamperinaSelect = select
  select.classList.add(HIDDEN_SELECT_CLASS)
  select.insertAdjacentElement('afterend', wrapper)
}

function uninstallHomeworkButtons(row: HTMLElement, select: HTMLSelectElement): void {
  row.querySelector(`.${HOMEWORK_WRAPPER_CLASS}`)?.remove()
  select.classList.remove(HIDDEN_SELECT_CLASS)
}

export function applyHomeworkButtons(): void {
  if (!isEvaluationPage()) return
  for (const row of evaluationRows()) {
    const select = homeworkSelect(row)
    if (!select) continue
    let wrapper = row.querySelector<HTMLElement>(`.${HOMEWORK_WRAPPER_CLASS}`)
    const attached = (wrapper as (HTMLElement & { tamperinaSelect?: HTMLSelectElement }) | null)?.tamperinaSelect
    if (wrapper && attached !== select) {
      uninstallHomeworkButtons(row, attached ?? select)
      wrapper = null
    }
    if (isFeatureEnabled('homework-buttons')) {
      if (!wrapper) installHomeworkButtons(row, select)
    } else if (wrapper) {
      uninstallHomeworkButtons(row, select)
    }
  }
}

/** Copyable report for diagnosing why homework buttons may not appear. */
export function diagnoseHomeworkButtons(): string {
  const rows = evaluationRows()
  const lines: string[] = [
    `page=${location.pathname}`,
    `enabled=${isFeatureEnabled('homework-buttons')}`,
    `rows=${rows.length}`,
  ]
  for (const [index, row] of rows.slice(0, 3).entries()) {
    const selects = rowSelects(row)
    const homework = homeworkSelect(row)
    lines.push(`row${index}: selects=${selects.length} main=${mainGradeSelect(row)?.name || '-'} homework=${homework?.name || '-'}`)
    for (const select of selects) {
      const options = Array.from(select.options).slice(0, 10)
        .map((option) => (option.textContent ?? '').trim()).join(' | ')
      lines.push(`  select name=${select.name || '-'} id=${select.id || '-'}`
        + ` label="${selectLabels(select).trim()}"`
        + ` hidden=${select.classList.contains(HIDDEN_SELECT_CLASS)}`
        + ` options=[${options}]`)
    }
  }
  return lines.join('\n')
}

// ---- boot ---------------------------------------------------------------------

function ensureGlobalStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = GLOBAL_STYLES
  ;(document.head ?? document.documentElement).appendChild(style)
}

export function initEvaluationTools(): void {
  if (initialised) return
  initialised = true

  if (document.head) ensureGlobalStyles()
  else document.addEventListener('DOMContentLoaded', ensureGlobalStyles, { once: true })

  document.addEventListener('click', (event) => {
    if (!isEvaluationPage() || !isFeatureEnabled('student-select')) return
    const target = event.target as Element | null
    if (target?.closest?.('#tamperina-root')) return
    if (target?.closest?.('input, select, button, a, textarea, label, [contenteditable="true"]')) return
    selectRow(target?.closest<HTMLElement>(ROW_SELECTOR) ?? null)
  })

  subscribeFeatures(() => applyHomeworkButtons())
  window.addEventListener('popstate', () => {
    selectRow(null, { silent: true })
    applyHomeworkButtons()
  })

  const observer = new MutationObserver(notifyRows)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  applyHomeworkButtons()
}
