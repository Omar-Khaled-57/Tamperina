import type { ExamCheckinOptions } from '../core/bulkAttendance'
import { escapeHtml } from './dom'

/** Data needed to render one editable row of the exam check-in stage. */
export interface ExamStageRowView {
  id: string
  enabled: boolean
  code: string
  options: ExamCheckinOptions
}

/** Already-translated labels supplied by the shell. */
export interface ExamStageLabels {
  title: string
  note: string
  empty: string
  include: string
  ready: string
  excluded: string
  studentCode: string
  codePlaceholder: string
  statusLabel: string
  amountLabel: string
  noteLabel: string
  sourceLabel: string
  remove: string
  add: string
  status: Record<'paid' | 'exempt' | 'deferred', string>
  source: Record<'manual' | 'scanner' | 'camera' | 'image', string>
}

function optionList<T extends string>(
  values: readonly T[],
  selected: string | undefined,
  label: (value: T) => string,
): string {
  return values.map((value) => (
    `<option value="${value}" ${selected === value ? 'selected' : ''}>${label(value)}</option>`
  )).join('')
}

const STATUSES = ['paid', 'exempt', 'deferred'] as const
const SOURCES = ['manual', 'scanner', 'camera', 'image'] as const

/** Editable fields shared by the pre-preview stage table and the review rows. */
function stageFields(row: ExamStageRowView, labels: ExamStageLabels): string {
  return `
        <label class="bulk-stage-check" title="${labels.include}">
          <input type="checkbox" data-exam-stage-field="enabled" ${row.enabled ? 'checked' : ''} />
          <span>${labels.include}</span>
        </label>
        <div class="bulk-stage-code">
          <span>${labels.studentCode}</span>
          <input class="bulk-input" dir="ltr" inputmode="text" data-exam-stage-field="code" placeholder="${escapeHtml(labels.codePlaceholder)}" value="${escapeHtml(row.code)}" />
        </div>
        <label class="bulk-stage-field">
          <span>${labels.statusLabel}</span>
          <select class="bulk-input" data-exam-stage-field="paymentStatus">${optionList(STATUSES, row.options.paymentStatus, (v) => labels.status[v])}</select>
        </label>
        <label class="bulk-stage-field">
          <span>${labels.amountLabel}</span>
          <input class="bulk-input" dir="ltr" inputmode="decimal" data-exam-stage-field="amountPaid" value="${escapeHtml(row.options.amountPaid ?? '')}" />
        </label>
        <label class="bulk-stage-field">
          <span>${labels.noteLabel}</span>
          <input class="bulk-input" data-exam-stage-field="paymentNote" value="${escapeHtml(row.options.paymentNote ?? '')}" />
        </label>
        <label class="bulk-stage-field">
          <span>${labels.sourceLabel}</span>
          <select class="bulk-input" data-exam-stage-field="source">${optionList(SOURCES, row.options.source, (v) => labels.source[v])}</select>
        </label>
        <button type="button" class="bulk-mini-btn bulk-stage-remove" data-exam-stage-remove aria-label="${labels.remove}">${labels.remove}</button>`
}

/** Pure markup for the staged exam rows; no platform writes happen here. */
export function renderExamStageTable(rows: ExamStageRowView[], labels: ExamStageLabels): string {
  if (!rows.length) return `<div class="bulk-note-inline">${labels.empty}</div>`

  return rows.map((row) => `
      <div class="bulk-stage-row" data-exam-stage-row="${escapeHtml(row.id)}">${stageFields(row, labels)}
      </div>
    `).join('')
}

/** Compact inline controls, matching normal attendance's inline payment row. */
function reviewFields(row: ExamStageRowView, labels: ExamStageLabels): string {
  return `<div class="bulk-inline-pay bulk-stage-review-fields">
    <label class="bulk-inline-pay-field bulk-stage-review-check" title="${labels.include}">
      <input type="checkbox" data-exam-stage-field="enabled" ${row.enabled ? 'checked' : ''} />
      <span>${labels.include}</span>
    </label>
    <label class="bulk-inline-pay-field">
      <span>${labels.studentCode}</span>
      <input class="bulk-input" dir="ltr" inputmode="text" data-exam-stage-field="code" placeholder="${escapeHtml(labels.codePlaceholder)}" value="${escapeHtml(row.code)}" />
    </label>
    <label class="bulk-inline-pay-field">
      <span>${labels.statusLabel}</span>
      <select class="bulk-input" data-exam-stage-field="paymentStatus">${optionList(STATUSES, row.options.paymentStatus, (v) => labels.status[v])}</select>
    </label>
    <label class="bulk-inline-pay-field">
      <span>${labels.amountLabel}</span>
      <input class="bulk-input" dir="ltr" inputmode="decimal" data-exam-stage-field="amountPaid" value="${escapeHtml(row.options.amountPaid ?? '')}" />
    </label>
    <label class="bulk-inline-pay-field">
      <span>${labels.noteLabel}</span>
      <input class="bulk-input" data-exam-stage-field="paymentNote" value="${escapeHtml(row.options.paymentNote ?? '')}" />
    </label>
    <label class="bulk-inline-pay-field">
      <span>${labels.sourceLabel}</span>
      <select class="bulk-input" data-exam-stage-field="source">${optionList(SOURCES, row.options.source, (v) => labels.source[v])}</select>
    </label>
    <div class="bulk-resolve-actions">
      <button type="button" class="bulk-mini-btn bulk-stage-remove" data-exam-stage-remove aria-label="${labels.remove}">${labels.remove}</button>
    </div>
  </div>`
}

/**
 * Post-preview review rows use the same `.bulk-resolve-item` shape as ordinary
 * bulk attendance, so exam students look and behave like normal review items.
 * The editable check-in options stay inside the row instead of a second table.
 */
export function renderExamStageReview(
  rows: ExamStageRowView[],
  labels: ExamStageLabels,
  options: { addDisabled?: boolean } = {},
): string {
  const studentRows = rows.length
    ? rows.map((row) => {
      const student = row.code || labels.codePlaceholder
      return `<div class="bulk-resolve-item ${row.enabled ? 'ok' : 'drop'}" data-exam-stage-row="${escapeHtml(row.id)}">
        <div class="bulk-resolve-head">
          <span class="bulk-resolve-name" dir="ltr" title="${escapeHtml(student)}">${escapeHtml(student)}</span>
          <span class="feature-badge ${row.enabled ? 'on' : 'off'}">${row.enabled ? labels.ready : labels.excluded}</span>
        </div>
        ${reviewFields(row, labels)}
      </div>`
    }).join('')
    : `<div class="bulk-note-inline">${labels.empty}</div>`

  return `<div class="bulk-stage-review">
    <div class="bulk-undecided-head">
      <div class="bulk-undecided-title">
        <strong>${labels.title}</strong>
        <span class="feature-badge on">${rows.length}</span>
      </div>
      <div class="bulk-resolve-actions">
        <button type="button" class="bulk-mini-btn" data-exam-stage-add ${options.addDisabled ? 'disabled' : ''}>${labels.add}</button>
      </div>
    </div>
    <div class="bulk-note-inline">${labels.note}</div>
    ${studentRows}
  </div>`
}
