import { beforeEach, describe, expect, it } from 'vitest'
import { placeHoldNotice, setPagePanelText } from '../src/ui/pagePanels'
import {
  renderExamStageFields,
  renderExamStageReview,
  renderExamStageTable,
  type ExamStageLabels,
  type ExamStageRowView,
} from '../src/ui/examStageTable'

const labels: ExamStageLabels = {
  title: 'Editable attendance stage',
  note: 'Values sent to the platform',
  empty: 'Empty',
  include: 'Include',
  ready: 'Ready',
  excluded: 'Ignored',
  studentCode: 'Code',
  codePlaceholder: 'Student code',
  statusLabel: 'Status',
  amountLabel: 'Amount',
  noteLabel: 'Note',
  sourceLabel: 'Source',
  remove: 'Remove',
  add: 'Add student',
  status: { paid: 'Paid', exempt: 'Exempt', deferred: 'Deferred' },
  source: { manual: 'Manual', scanner: 'Scanner', camera: 'Camera', image: 'Image' },
}

describe('placeHoldNotice', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="work-panel" data-work-panel="attendance">
        <section class="station"><form id="examScan"></form></section>
      </div>
    `
  })

  it('inserts the notice before the exam station on exam pages', () => {
    const panel = document.createElement('div')
    placeHoldNotice(panel, '/comprehensive-exams/16')
    const station = document.querySelector('.station')!
    expect(station.previousElementSibling).toBe(panel)
  })

  it('does nothing on non-exam pages', () => {
    const panel = document.createElement('div')
    placeHoldNotice(panel, '/attendance/scan')
    expect(panel.parentElement).toBeNull()
  })

  it('fills the panel text from translated strings', () => {
    const panel = document.createElement('div')
    panel.innerHTML = '<span><strong></strong><small></small></span><button></button>'
    setPagePanelText(panel, 'Title', 'Detail', 'Allow')
    expect(panel.querySelector('strong')!.textContent).toBe('Title')
    expect(panel.querySelector('small')!.textContent).toBe('Detail')
    expect(panel.querySelector('button')!.textContent).toBe('Allow')
  })
})

describe('renderExamStageTable', () => {
  it('renders an empty hint when no rows are staged', () => {
    expect(renderExamStageTable([], labels)).toContain('Empty')
  })

  it('renders every platform check-in option and escapes untrusted values', () => {
    const html = renderExamStageTable([{
      id: 'stage-1',
      enabled: true,
      code: '3766',
      options: { paymentStatus: 'exempt', amountPaid: '12.50', paymentNote: '<note>', source: 'camera' },
    }], labels)
    expect(html).toContain('data-exam-stage-field="code"')
    expect(html).toContain('value="3766"')
    expect(html).toContain('placeholder="Student code"')
    expect(html).not.toContain('readonly')
    expect(html).toContain('data-exam-stage-field="paymentStatus"')
    expect(html).toContain('value="exempt" selected')
    expect(html).toContain('value="camera" selected')
    expect(html).toContain('value="12.50"')
    expect(html).toContain('&lt;note&gt;')
    expect(html).not.toContain('<note>')
  })

  it('renders post-preview rows with the shared normal-attendance row builder', () => {
    const rows: ExamStageRowView[] = [{
      id: 'stage-1',
      enabled: false,
      code: '3766',
      options: { paymentStatus: 'paid', amountPaid: '0.00', paymentNote: '', source: 'manual' },
    }]
    const html = renderExamStageReview(rows, labels, {
      renderRow: (row) => `<div class="bulk-resolve-item ${row.enabled ? 'ok' : 'drop'}" data-exam-stage-row="${row.id}">
        <div class="bulk-resolve-head">
          <span class="bulk-resolve-name">${row.code}</span>
          <span class="feature-badge ${row.enabled ? 'on' : 'off'}">${row.enabled ? labels.ready : labels.excluded}</span>
        </div>
        ${renderExamStageFields(row, labels)}
      </div>`,
    })
    expect(html).toContain('bulk-resolve-item')
    expect(html).toContain('bulk-resolve-head')
    expect(html).toContain('data-exam-stage-row="stage-1"')
    expect(html).toContain('bulk-resolve-name')
    expect(html).toContain('3766')
    expect(html).toContain('Ignored')
    expect(html).toContain('data-exam-stage-field="code"')
    expect(html).toContain('data-exam-stage-remove')
    expect(html).toContain('data-exam-stage-add')
  })
})
