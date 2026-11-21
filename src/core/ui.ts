import {
  GM_addValueChangeListener,
  GM_getValue,
  GM_registerMenuCommand,
  GM_setValue,
  GM_unregisterMenuCommand,
  unsafeWindow,
} from '$'
import rina from 'virtual:tamperina-rina'
import cairoFontCss from 'virtual:tamperina-fonts'
import shellStyle from '../ui/styles.css?style'
import { escapeHtml } from '../ui/dom'
import { installKeyShield, isEditableTarget, isGlobalShortcutKey } from '../ui/keyShield'
import { ensureHoldPanel, placeHoldNotice, setPagePanelText } from '../ui/pagePanels'
import {
  renderExamStageFields,
  renderExamStageReview,
  renderExamStageTable,
  type ExamStageLabels,
  type ExamStageRowView,
} from '../ui/examStageTable'
import { icons } from '../icons'
import { attachToaster, toast } from './toast'
import { getUndoRedoController, type LiveRecord, type UndoRedoController } from './undoRedo'
import {
  commitExamTyping,
  diagnoseHomeworkButtons,
  featureStateSignature as evaluationFeatureStateSignature,
  getSelectedRow,
  handleSelectedRowKey,
  isEvaluationFeatureId,
  isEvaluationPage,
  isFeatureEnabled,
  selectRow,
  setFeatureEnabled,
  subscribeFeatures,
} from './evaluation'
import { mountFindBar } from './findBar'
import {
  bulkKindMatchesPath,
  isBulkRunKind,
  remoteInputAllowed,
  remoteTargetMatches,
  supportedBulkKinds,
  type BulkRunKind,
} from './pageGuards'
import {
  examEvalCodesAllowed,
  examIdFromPath,
  examTargetAllowed,
  isComprehensiveExamsPath,
  isExamBulkKind,
  isExamPagePath,
} from './examGuards'
import {
  initRemoteBulk,
  REQUEST_TIMEOUT_MESSAGE,
  REQUEST_TIMEOUT_MS,
  type RemoteBulkBridge,
  type RemoteBulkKind,
  type RemoteBulkPhase,
  type RemotePreview,
  type RemoteRequest,
  type RemoteTarget,
} from './remoteBulk'
import {
  currentLessonIdFromPage,
  detectScanForm,
  formatBulkDiagnosticReport,
  formatCandidate,
  normalizeStudentCode,
  parseBulkEntries,
  resolveNameEntry,
  runBulkAttendance,
  type BulkRowResult,
  type ExamCheckinOptions,
  type NameRow,
  type ParseEntriesResult,
  type PaymentMode,
  type PaymentStatus,
  type PaymentOverride,
  type StudentCandidate,
} from './bulkAttendance'
import {
  parseEvaluationEntries,
  matchIdentifier,
  findRowForCode,
  applyEvaluationToRow,
  formatEvalLabel,
  collectPageCandidates,
  type ParseEvalResult,
  type EvalNameRow,
  type EvalRowResult,
  type EvalRowStatus,
  type EvalResolveStatus,
  type EvalValues,
} from './bulkEvaluation'
import {
  loadShell,
  saveShell,
  SHELL_KEY,
  SIZE_MIN,
  SIZE_MAX,
  SIZE_STEP,
  type ShellState,
} from './storage'
import { applyTranslations, getLocale, listSeparator, setLocale, subscribeLocale, t } from './i18n'

const HOST_ID = 'tamperina-root'
const DRAG_THRESHOLD = 5
const HOTKEY_RESTORE = 'Alt+Shift+T'
let cairoFontReady = false
let toggleEffectsReady = false
/** The two new cards animate in once, not on every undo-history re-render. */
let featureCardsIntroduced = false

/** localStorage throws in privacy modes / sandboxed frames — treat as unavailable. */
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Storage may be unavailable; the class toggle still applies for this load.
  }
}

function ensureToggleEffectsStyle(): void {
  if (toggleEffectsReady || document.getElementById('tamperina-toggle-effects')) {
    toggleEffectsReady = true
    return
  }
  toggleEffectsReady = true
  const style = document.createElement('style')
  style.id = 'tamperina-toggle-effects'
  style.textContent = `
/* Tamperina toggle effects (page-level) */
.centered-payment-modal .modal,
.centered-payment-modal .modal-dialog,
.centered-payment-modal [class*="payment-modal"],
.centered-payment-modal [class*="PaymentModal"],
.centered-payment-modal dialog[open],
.centered-payment-modal .swal2-popup,
.centered-payment-modal .swal2-container {
  position: fixed !important;
  top: 50% !important;
  left: 50% !important;
  right: auto !important;
  bottom: auto !important;
  transform: translate(-50%, -50%) !important;
  margin: 0 !important;
}
.centered-payment-modal .modal-backdrop,
.centered-payment-modal .swal2-container {
  inset: 0 !important;
}
.barcode-hidden [id*="barcode" i]:not(input):not(textarea):not(select),
.barcode-hidden [class*="barcode" i]:not(input):not(textarea):not(select),
.barcode-hidden [data-barcode],
.barcode-hidden .fa-barcode,
.barcode-hidden .bi-upc-scan,
.barcode-hidden button[title*="باركود" i],
.barcode-hidden button[aria-label*="باركود" i],
.barcode-hidden a[title*="باركود" i],
.barcode-hidden a[aria-label*="باركود" i] {
  display: none !important;
}

#tamperina-whatsapp-hold {
  /* In-page notice: inserted into the exam work panel, so it scrolls with
     the platform instead of floating over it. */
  position: relative;
  inset: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin: 0 0 14px;
  padding: 12px 14px;
  border: 1px solid rgba(242, 206, 170, 0.4);
  border-radius: 14px;
  background: rgba(36, 24, 16, 0.96);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.18);
  color: #f8efe7;
  font: 13px/1.6 Cairo, Tajawal, Tahoma, Arial, sans-serif;
  direction: rtl;
  animation: tamperina-hold-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes tamperina-hold-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  #tamperina-whatsapp-hold { animation: none; }
}
#tamperina-whatsapp-hold[hidden] { display: none !important; }
#tamperina-whatsapp-hold[data-locale='en'] { direction: ltr; }
#tamperina-whatsapp-hold > span { flex: 1; min-width: 0; }
#tamperina-whatsapp-hold strong { display: block; font-size: 12px; font-weight: 800; }
#tamperina-whatsapp-hold small { display: block; margin-top: 2px; font-size: 11px; color: #b9a28f; }
#tamperina-whatsapp-hold button {
  flex-shrink: 0;
  padding: 7px 12px;
  border: 1px solid #f2ceaa;
  border-radius: 10px;
  background: #f2ceaa;
  color: #2a1608;
  font: 800 12px Cairo, Tajawal, Tahoma, Arial, sans-serif;
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.2s ease;
}
#tamperina-whatsapp-hold button:hover { background: #ffe0bd; transform: translateY(-1px); }
#tamperina-whatsapp-hold button:disabled { opacity: 0.5; cursor: default; transform: none; }
`
  ;(document.head || document.documentElement).appendChild(style)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snapSize(value: number): number {
  return clamp(Math.round(value / SIZE_STEP) * SIZE_STEP, SIZE_MIN, SIZE_MAX)
}


function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

function isAttendancePage(): boolean {
  return location.pathname.replace(/\/$/, '') === '/attendance/scan'
}

function featureScopeLabel(): string {
  return location.pathname.replace(/\/$/, '') === '/evaluation'
    ? t('ui.feature.scope.evaluation')
    : t('ui.feature.scope.attendance')
}

// Install before the platform registers its document-level scanner handlers.
installKeyShield(HOST_ID)

/**
 * Register the bundled font bytes directly instead of using data URL
 * @font-face rules. The host CSP may forbid data URL font sources.
 */
function ensureCairoFont(): void {
  if (cairoFontReady || !('FontFace' in window)) return
  cairoFontReady = true

  const faces = cairoFontCss.matchAll(
    /@font-face\{[^}]*font-family:'Cairo';font-style:([^;]+);font-weight:([^;]+);font-display:[^;]+;src:url\(data:font\/woff2;base64,([^)]*)\)[^;]*;unicode-range:([^}]+)\}/g,
  )

  void Promise.all(Array.from(faces, async ([, style, weight, base64, unicodeRange]) => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    const buffer = new ArrayBuffer(bytes.length)
    new Uint8Array(buffer).set(bytes)
    const face = new FontFace('Cairo', buffer, {
      style,
      weight,
      unicodeRange: unicodeRange.replace(/;$/, ''),
    })
    await face.load()
    document.fonts.add(face)
  })).catch(() => {
    cairoFontReady = false
  })
}

export function mountShell(): void {
  ensureCairoFont()
  ensureToggleEffectsStyle()
  if (document.getElementById(HOST_ID)) return

  // The locale must be active before the first markup is built: inline t()
  // calls in the templates render immediately.
  const state: ShellState = loadShell()
  setLocale(state.locale)

  const host = document.createElement('div')
  host.id = HOST_ID
  host.dir = state.locale === 'en' ? 'ltr' : 'rtl'
  document.documentElement.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  attachToaster(shadow)
  shadow.appendChild(shellStyle.cloneNode(true))

  const shellEl = document.createElement('div')
  shellEl.className = 'shell'
  shellEl.innerHTML = `
    <div class="launcher" title="Tamperina" tabindex="0" role="button" data-i18n-aria="ui.launcher.open">
      <div class="flip">
        <div class="spin">
          <img class="mascot" src="${rina.logo}" alt="Tamperina" draggable="false" />
        </div>
      </div>
      <div class="pill" role="toolbar" data-i18n-aria="ui.pill.aria">
        <button type="button" data-act="shrink" data-i18n-title="ui.pill.shrink">${icons.shrink}</button>
        <button type="button" data-act="grow" data-i18n-title="ui.pill.grow">${icons.grow}</button>
        <span class="sep" aria-hidden="true"></span>
        <button type="button" data-act="mirror" data-i18n-title="ui.pill.mirror">${icons.flip}</button>
        <button type="button" data-act="pause" data-i18n-title="ui.pill.pause">${icons.pause}</button>
        <span class="frames" role="group" data-i18n-aria="ui.pill.frames.aria" hidden>
          <button type="button" data-act="frame" data-frame="1" data-i18n-title="ui.pill.frame1">F1</button>
          <button type="button" data-act="frame" data-frame="2" data-i18n-title="ui.pill.frame2">F2</button>
          <button type="button" data-act="frame" data-frame="3" data-i18n-title="ui.pill.frame3">F3</button>
        </span>
        <button type="button" data-act="lock" data-i18n-title="ui.pill.lock">${icons.lockOpen}</button>
        <button type="button" data-act="clickThrough" data-i18n-title="ui.pill.clickThrough">${icons.clickThrough}</button>
      </div>
    </div>
    <button type="button" class="pin" title="${t('ui.pin.title', { p0: HOTKEY_RESTORE })}">${icons.pin}</button>
  `
  shadow.appendChild(shellEl)

  const backdrop = document.createElement('div')
  backdrop.className = 'backdrop'
  backdrop.hidden = true
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" data-i18n-aria="ui.modal.aria">
      <div class="modal-top">
        <div class="modal-head">
          <div class="brand">
            <span class="brand-dot"></span>
            <span>
              <strong data-i18n="ui.modal.brand"></strong>
              <small data-i18n="ui.modal.subtitle"></small>
            </span>
          </div>
          <button type="button" class="icon-btn" data-close data-i18n-title="ui.modal.close">${icons.close}</button>
        </div>
        <div class="tabs" role="tablist" data-i18n-aria="ui.tabs.aria">
          <span class="tab-indicator" aria-hidden="true"></span>
          <button type="button" class="tab" data-tab="toggles" role="tab" id="tamperina-tab-toggles" aria-controls="tamperina-panel-toggles" data-i18n-aria="ui.tab.toggles">${icons.toggles} <span data-i18n="ui.tab.toggles"></span></button>
          <button type="button" class="tab" data-tab="bulk" role="tab" id="tamperina-tab-bulk" aria-controls="tamperina-panel-bulk" data-i18n-aria="ui.tab.bulk">${icons.bulk} <span data-i18n="ui.tab.bulk"></span></button>
        </div>
      </div>
      <div class="panels">
        <div data-panel="toggles" role="tabpanel" id="tamperina-panel-toggles" aria-labelledby="tamperina-tab-toggles">
          <div data-feature-list class="feature-list"></div>
        </div>
        <div data-panel="bulk" role="tabpanel" id="tamperina-panel-bulk" aria-labelledby="tamperina-tab-bulk" hidden>
          <div class="bulk-menu" data-bulk-view="menu">
            <p class="bulk-note bulk-mode-hint" data-bulk-mode-hint hidden></p>
            <div class="bulk-menu-list">
              <button type="button" class="bulk-item" data-bulk-open="attendance" data-bulk-kind="attendance">
                <span class="feature-icon">${icons.bulk}</span>
                <span class="bulk-item-text">
                  <strong data-i18n="ui.bulk.menu.attendance.title"></strong>
                  <small data-i18n="ui.bulk.menu.attendance.desc"></small>
                </span>
                <span class="feature-badge on" data-bulk-availability></span>
              </button>

              <button type="button" class="bulk-item" data-bulk-open="evaluation" data-bulk-kind="evaluation">
                <span class="feature-icon">${icons.toggles}</span>
                <span class="bulk-item-text">
                  <strong data-i18n="ui.bulk.menu.evaluation.title"></strong>
                  <small data-i18n="ui.bulk.menu.evaluation.desc"></small>
                </span>
                <span class="feature-badge on" data-bulk-availability></span>
              </button>

              <button type="button" class="bulk-item" data-bulk-open="exam-attendance" data-bulk-kind="exam-attendance">
                <span class="feature-icon">${icons.bulk}</span>
                <span class="bulk-item-text">
                  <strong data-i18n="ui.bulk.menu.examAttendance.title"></strong>
                  <small data-i18n="ui.bulk.menu.examAttendance.desc"></small>
                </span>
                <span class="feature-badge on" data-bulk-availability></span>
              </button>

              <button type="button" class="bulk-item" data-bulk-open="exam-evaluation" data-bulk-kind="exam-evaluation">
                <span class="feature-icon">${icons.toggles}</span>
                <span class="bulk-item-text">
                  <strong data-i18n="ui.bulk.menu.examEvaluation.title"></strong>
                  <small data-i18n="ui.bulk.menu.examEvaluation.desc"></small>
                </span>
                <span class="feature-badge on" data-bulk-availability></span>
              </button>

              <button type="button" class="bulk-item" data-bulk-open="export" data-bulk-local>
                <span class="feature-icon">${icons.download}</span>
                <span class="bulk-item-text">
                  <strong data-i18n="ui.bulk.menu.export.title"></strong>
                  <small data-i18n="ui.bulk.menu.export.desc"></small>
                </span>
                <span class="feature-badge on" data-bulk-availability></span>
              </button>

              <button type="button" class="bulk-item" data-bulk-open="remove" data-bulk-local>
                <span class="feature-icon">${icons.trash}</span>
                <span class="bulk-item-text">
                  <strong data-i18n="ui.bulk.menu.remove.title"></strong>
                  <small data-i18n="ui.bulk.menu.remove.desc"></small>
                </span>
                <span class="feature-badge on" data-bulk-availability></span>
              </button>
            </div>
          </div>

          <div class="bulk-detail" data-bulk-view="attendance" hidden>
            <button type="button" class="bulk-back" data-bulk-back><span data-i18n="ui.bulk.back"></span></button>
            <div class="bulk-card" data-bulk-root>
              <div class="bulk-head">
                <span class="feature-icon">${icons.bulk}</span>
                <span class="feature-titles">
                  <strong data-bulk-head-title></strong>
                  <small data-bulk-head-subtitle></small>
                </span>
                <span class="feature-badge off" data-bulk-state-badge data-i18n="ui.common.ready"></span>
              </div>

              <p class="bulk-note">
                <span data-bulk-head-note></span>
              </p>

              <div class="bulk-grid">
                <label class="bulk-field">
                  <span data-i18n="ui.common.lessonLabel"></span>
                  <input type="text" inputmode="numeric" class="bulk-input" data-bulk-lesson data-i18n-placeholder="ui.common.lessonPlaceholder" />
                </label>
                <div class="bulk-field">
                  <span data-i18n="ui.bulk.attendance.modeLabel"></span>
                  <div class="bulk-mode-toggle" data-bulk-mode-toggle role="group" data-i18n-aria="ui.bulk.attendance.modeLabel">
                    <button type="button" class="bulk-mode-btn active" data-mode="center" aria-pressed="true">${icons.center}<span data-i18n="ui.bulk.attendance.modeCenter"></span></button>
                    <button type="button" class="bulk-mode-btn" data-mode="school" aria-pressed="false">${icons.school}<span data-i18n="ui.bulk.attendance.modeSchool"></span></button>
                  </div>
                </div>
              </div>

              <label class="bulk-field">
                <span data-i18n="ui.bulk.attendance.studentsLabel"></span>
                <textarea class="bulk-textarea" data-bulk-codes rows="7" data-i18n-placeholder="ui.bulk.attendance.inputPlaceholder"></textarea>
              </label>

              <div class="bulk-stage" data-exam-stage hidden>
                <div class="bulk-stage-head">
                  <span class="feature-titles">
                    <strong data-i18n="ui.bulk.exam.stage.title"></strong>
                    <small data-i18n="ui.bulk.exam.stage.note"></small>
                  </span>
                  <button type="button" class="bulk-mini-btn" data-exam-stage-add data-i18n="ui.bulk.exam.stage.add"></button>
                </div>
                <div class="bulk-stage-table" data-exam-stage-table></div>
              </div>

              <div class="bulk-actions">
                <button type="button" class="action-btn" data-bulk-preview>${icons.toggles}<span data-i18n="ui.common.previewAnalyze"></span></button>
                <button type="button" class="action-btn" data-bulk-arm disabled>${icons.lock}<span data-i18n="ui.common.armExecution"></span></button>
                <button type="button" class="action-btn bulk-run" data-bulk-run disabled>${icons.play}<span data-i18n="ui.common.run"></span></button>
                <button type="button" class="action-btn bulk-stop" data-bulk-stop disabled>${icons.pause}<span data-i18n="ui.common.stop"></span></button>
              </div>

              <div class="bulk-preview" data-bulk-preview-box data-i18n="ui.common.previewEmpty"></div>
              <div class="bulk-resolve" data-bulk-resolve hidden></div>

              <div class="history-head">
                ${icons.history}
                <strong data-i18n="ui.common.historyTitle"></strong>
                <small data-bulk-log-count>0</small>
              </div>
              <div class="bulk-log" data-bulk-log>
                <div class="history-empty" data-i18n="ui.common.logEmpty"></div>
              </div>

              <div class="bulk-diagnostics" data-bulk-diagnostics hidden>
                <div class="bulk-undecided-head">
                  <div class="bulk-undecided-title">
                    <strong data-i18n="ui.bulk.attendance.diagnosticsTitle"></strong>
                    <span class="feature-badge busy" data-bulk-debug-count>0</span>
                  </div>
                  <div class="bulk-resolve-actions">
                    <button type="button" class="bulk-mini-btn" data-bulk-copy-debug data-i18n="ui.bulk.attendance.copyReport"></button>
                    <button type="button" class="bulk-mini-btn" data-bulk-copy-failed data-i18n="ui.bulk.attendance.copyFailed"></button>
                    <button type="button" class="bulk-mini-btn" data-bulk-copy-skipped data-i18n="ui.bulk.attendance.copySkipped"></button>
                    <button type="button" class="bulk-mini-btn" data-bulk-retry disabled data-i18n="ui.bulk.attendance.retryFailed"></button>
                  </div>
                </div>
                <pre class="bulk-debug-text" data-bulk-debug-text></pre>
              </div>

              <p class="feature-note">${icons.shieldAlert}
                <span data-i18n="ui.bulk.attendance.footerNote"></span>
              </p>
            </div>
          </div>

          <div class="bulk-detail" data-bulk-view="export" hidden>
            <button type="button" class="bulk-back" data-bulk-back><span data-i18n="ui.bulk.back"></span></button>
            <div class="bulk-card" data-export-root>
              <div class="bulk-head">
                <span class="feature-icon">${icons.download}</span>
                <span class="feature-titles">
                  <strong data-i18n="ui.bulk.menu.export.title"></strong>
                  <small data-i18n="ui.bulk.export.subtitle"></small>
                </span>
                <span class="feature-badge off" data-export-count>${t('ui.bulk.export.count', { p0: 0 })}</span>
              </div>

              <p class="bulk-note">
                <span data-i18n="ui.bulk.export.note"></span>
              </p>

              <div class="bulk-grid">
                <label class="bulk-field">
                  <span data-i18n="ui.common.lessonLabel"></span>
                  <input type="text" inputmode="numeric" class="bulk-input" data-export-lesson data-i18n-placeholder="ui.common.lessonPlaceholder" />
                </label>
                <div class="bulk-field">
                  <span data-i18n="ui.bulk.export.savedLabel"></span>
                  <div class="bulk-mode-toggle" data-export-summary>
                    <span class="bulk-export-summary" data-export-summary-text>—</span>
                  </div>
                </div>
              </div>

              <div class="bulk-actions export-actions">
                <button type="button" class="action-btn" data-export-refresh>${icons.refresh}<span data-i18n="ui.common.refresh"></span></button>
                <button type="button" class="action-btn" data-export-copy>${icons.copy}<span data-i18n="ui.common.copy"></span></button>
                <button type="button" class="action-btn bulk-run" data-export-download>${icons.download}<span data-i18n="ui.bulk.export.download"></span></button>
              </div>

              <label class="bulk-field">
                <span data-i18n="ui.bulk.export.resultLabel"></span>
                <textarea class="bulk-textarea bulk-export-text" data-export-text rows="10" data-i18n-placeholder="ui.bulk.export.resultPlaceholder"></textarea>
              </label>

              <p class="feature-note" data-export-hint>${icons.shieldAlert}
                <span data-i18n="ui.bulk.export.hint"></span>
              </p>
            </div>
          </div>

          <div class="bulk-detail" data-bulk-view="remove" hidden>
            <button type="button" class="bulk-back" data-bulk-back><span data-i18n="ui.bulk.back"></span></button>
            <div class="bulk-card" data-remove-root>
              <div class="bulk-head">
                <span class="feature-icon">${icons.trash}</span>
                <span class="feature-titles">
                  <strong data-i18n="ui.bulk.menu.remove.title"></strong>
                  <small data-i18n="ui.bulk.remove.subtitle"></small>
                </span>
                <span class="feature-badge off" data-remove-badge data-i18n="ui.common.ready"></span>
              </div>

              <p class="bulk-note">
                <span data-i18n="ui.bulk.remove.note"></span>
              </p>
              <div class="bulk-warn" data-i18n="ui.bulk.remove.warn"></div>

              <div class="bulk-grid">
                <label class="bulk-field">
                  <span data-i18n="ui.common.lessonLabel"></span>
                  <input type="text" inputmode="numeric" class="bulk-input" data-remove-lesson data-i18n-placeholder="ui.common.lessonPlaceholder" />
                </label>
                <div class="bulk-field">
                  <span data-i18n="ui.bulk.remove.recordsLabel"></span>
                  <div class="bulk-export-summary" data-remove-summary>—</div>
                </div>
              </div>

              <div class="bulk-actions">
                <button type="button" class="action-btn" data-remove-refresh>${icons.refresh}<span data-i18n="ui.common.refresh"></span></button>
                <button type="button" class="action-btn" data-remove-arm disabled>${icons.lock}<span data-i18n="ui.bulk.remove.arm"></span></button>
                <button type="button" class="action-btn bulk-run" data-remove-run disabled>${icons.play}<span data-i18n="ui.bulk.remove.runAll"></span></button>
                <button type="button" class="action-btn bulk-stop" data-remove-stop disabled>${icons.pause}<span data-i18n="ui.common.stop"></span></button>
              </div>

              <div class="bulk-preview" data-remove-preview data-i18n="ui.bulk.remove.previewEmpty"></div>

              <div class="history-head">
                ${icons.history}
                <strong data-i18n="ui.bulk.remove.logTitle"></strong>
                <small data-remove-log-count>0</small>
              </div>
              <div class="bulk-log" data-remove-log>
                <div class="history-empty" data-i18n="ui.common.logEmpty"></div>
              </div>

              <p class="feature-note">${icons.shieldAlert}
                <span data-i18n="ui.bulk.remove.footerNote"></span>
              </p>
            </div>
          </div>

          <div class="bulk-detail" data-bulk-view="evaluation" hidden>
            <button type="button" class="bulk-back" data-bulk-back><span data-i18n="ui.bulk.back"></span></button>
            <div class="bulk-card" data-eval-bulk-root>
              <div class="bulk-head">
                <span class="feature-icon">${icons.toggles}</span>
                <span class="feature-titles">
                  <strong data-eval-head-title></strong>
                  <small data-eval-head-subtitle></small>
                </span>
                <span class="feature-badge off" data-eval-badge data-i18n="ui.common.ready"></span>
              </div>

              <p class="bulk-note"><span data-eval-head-note></span></p>

              <label class="bulk-field">
                <span data-i18n="ui.bulk.eval.listLabel"></span>
                <textarea class="bulk-textarea" data-eval-input rows="7" data-i18n-placeholder="ui.bulk.eval.inputPlaceholder"></textarea>
              </label>

              <div class="bulk-actions">
                <button type="button" class="action-btn" data-eval-preview>${icons.toggles}<span data-i18n="ui.common.previewAnalyze"></span></button>
                <button type="button" class="action-btn" data-eval-arm disabled>${icons.lock}<span data-i18n="ui.common.armExecution"></span></button>
                <button type="button" class="action-btn bulk-run" data-eval-run disabled>${icons.play}<span data-i18n="ui.common.run"></span></button>
                <button type="button" class="action-btn bulk-stop" data-eval-stop disabled>${icons.pause}<span data-i18n="ui.common.stop"></span></button>
              </div>

              <div class="bulk-preview" data-eval-preview-box data-i18n="ui.common.previewEmpty"></div>
              <div class="bulk-resolve" data-eval-resolve hidden></div>

              <div class="history-head">
                ${icons.history}
                <strong data-i18n="ui.common.historyTitle"></strong>
                <small data-eval-log-count>0</small>
                <button type="button" class="bulk-mini-btn" data-eval-copy-results data-i18n="ui.bulk.eval.copyResults"></button>
              </div>
              <div class="bulk-log" data-eval-log>
                <div class="history-empty" data-i18n="ui.common.logEmpty"></div>
              </div>

              <p class="feature-note">${icons.shieldAlert}
                <span data-i18n="ui.bulk.eval.footerNote"></span>
              </p>
            </div>
          </div>

          <div class="bulk-detail" data-bulk-view="remote" hidden>
            <button type="button" class="bulk-back" data-bulk-back><span data-i18n="ui.bulk.back"></span></button>
            <div class="bulk-card" data-remote-root>
              <div class="bulk-head">
                <span class="feature-icon">${icons.refresh}</span>
                <span class="feature-titles">
                  <strong data-i18n="ui.bulk.menu.remote.title"></strong>
                  <small data-i18n="ui.bulk.remote.subtitle"></small>
                </span>
                <span class="feature-badge off" data-remote-badge data-i18n="ui.common.ready"></span>
              </div>

              <p class="bulk-note"><span data-i18n="ui.bulk.remote.note"></span></p>
              <p class="bulk-note bulk-mode-hint" data-remote-mode-note><span data-i18n="ui.bulk.remote.modeNote"></span></p>
              <p class="bulk-note bulk-mode-hint" data-remote-kind-note hidden><span data-i18n="ui.bulk.remote.kindLocked"></span></p>

              <div class="bulk-grid">
                <label class="bulk-field">
                  <span data-i18n="ui.bulk.remote.idLabel"></span>
                  <input type="text" inputmode="numeric" class="bulk-input" data-remote-id data-i18n-placeholder="ui.bulk.remote.idPlaceholder" />
                </label>
              </div>
              <p class="bulk-note" data-remote-target-note></p>

              <label class="bulk-field">
                <span data-i18n="ui.bulk.remote.textLabel"></span>
                <textarea class="bulk-textarea" data-remote-input rows="7"></textarea>
              </label>

              <div class="bulk-actions">
                <button type="button" class="action-btn bulk-full" data-remote-refresh>${icons.refresh}<span data-i18n="ui.bulk.remote.refresh"></span></button>
                <button type="button" class="action-btn" data-remote-prepare>${icons.toggles}<span data-i18n="ui.bulk.remote.prepare"></span></button>
                <button type="button" class="action-btn" data-remote-arm disabled>${icons.lock}<span data-i18n="ui.bulk.remote.arm"></span></button>
                <button type="button" class="action-btn bulk-run" data-remote-run disabled>${icons.play}<span data-i18n="ui.bulk.remote.run"></span></button>
                <button type="button" class="action-btn bulk-stop" data-remote-stop disabled>${icons.pause}<span data-i18n="ui.bulk.remote.stop"></span></button>
              </div>

              <div class="bulk-preview" data-remote-status data-i18n="ui.common.previewEmpty"></div>

              <p class="feature-note">${icons.shieldAlert}
                <span data-i18n="ui.bulk.remote.footerNote"></span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
  shadow.appendChild(backdrop)
  applyTranslations(shadow)

  // The early shield makes our focused field visible to document-level
  // handlers. This bubble-phase stop is a second line of defence for events
  // that still escape the shadow tree; global shortcuts are left alone.
  for (const type of ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend'] as const) {
    shadow.addEventListener(type, (event) => {
      if (isGlobalShortcutKey(event)) return
      event.stopPropagation()
    })
  }

  const findBar = mountFindBar(shadow)

  const launcher = shellEl.querySelector<HTMLElement>('.launcher')!
  const flip = shellEl.querySelector<HTMLElement>('.flip')!
  const spin = shellEl.querySelector<HTMLElement>('.spin')!
  const pill = shellEl.querySelector<HTMLElement>('.pill')!
  const frames = shellEl.querySelector<HTMLElement>('.frames')!
  const pin = shellEl.querySelector<HTMLButtonElement>('.pin')!
  const closeBtn = backdrop.querySelector<HTMLButtonElement>('[data-close]')!
  const tabsBar = backdrop.querySelector<HTMLElement>('.tabs')!
  const tabIndicator = backdrop.querySelector<HTMLElement>('.tab-indicator')!
  const tabButtons = Array.from(backdrop.querySelectorAll<HTMLButtonElement>('[data-tab]'))
  const panels = Array.from(backdrop.querySelectorAll<HTMLElement>('[data-panel]'))
  const pillButtons = Array.from(pill.querySelectorAll<HTMLButtonElement>('[data-act]'))
  const featureList = backdrop.querySelector<HTMLElement>('[data-feature-list]')!

  function persist(): void {
    saveShell(state)
  }

  const undoRedo = getUndoRedoController()

  // ---- Exam test controls --------------------------------------------------
  const WHATSAPP_STATUS_URL = '/whatsapp/status'
  const WHATSAPP_WORKER_URL = '/whatsapp/worker/'
  const WHATSAPP_HOLD_KEY = 'tamperina.whatsapp.heldByTamperina.v1'
  let whatsappHeldLocally = false
  let whatsappReleasedThisLoad = false

  function whatsappIsHeld(): boolean {
    return whatsappHeldLocally || tamperinaHoldsWhatsapp()
  }

  function tamperinaHoldsWhatsapp(): boolean {
    try {
      return GM_getValue<boolean | undefined>(WHATSAPP_HOLD_KEY) === true
    } catch {
      return false
    }
  }

  function markWhatsappHeldByTamperina(held: boolean): void {
    whatsappHeldLocally = held
    try {
      GM_setValue(WHATSAPP_HOLD_KEY, held)
    } catch {
      // Storage may be unavailable; the current page still tracks the hold.
    }
  }

  function currentExamId(): string {
    return examIdFromPath(location.pathname) ?? ''
  }

  function isExamPage(): boolean {
    return isExamPagePath(location.pathname)
  }

  function platformCsrf(): string {
    return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
  }

  async function setWhatsappSending(enabled: boolean): Promise<boolean> {
    const csrf = platformCsrf()
    if (!csrf) return false
    try {
      const response = await fetch(`${WHATSAPP_WORKER_URL}${enabled ? 'start' : 'stop'}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-CSRF-TOKEN': csrf },
      })
      if (!response.ok) return false
      const data = await response.json().catch(() => ({})) as {
        sending_enabled?: boolean
        dispatch?: { sending_enabled?: boolean }
      }
      const responseEnabled = data.dispatch?.sending_enabled ?? data.sending_enabled
      if (responseEnabled !== undefined) return Boolean(responseEnabled) === enabled
      // Some server versions answer with an empty body; verify the real state.
      return await whatsappSendingEnabled() === enabled
    } catch {
      return false
    }
  }

  async function whatsappSendingEnabled(): Promise<boolean | null> {
    try {
      const response = await fetch(WHATSAPP_STATUS_URL, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) return null
      const data = await response.json() as { dispatch?: { sending_enabled?: boolean }, sending_enabled?: boolean }
      const value = data.dispatch?.sending_enabled ?? data.sending_enabled
      return value === undefined ? null : Boolean(value)
    } catch {
      return null
    }
  }

  function examStageVisible(): boolean {
    return state.examAttendanceStage && isExamPage() && bulkExamMode
  }

  function updateExamStagePanel(): void {
    const visible = examStageVisible()
    // Before preview the stage table is the input surface. After preview the
    // same rows move into the normal attendance-style review list to avoid
    // showing two per-student tables.
    examStageBox.hidden = !visible || !!bulkParsed
    if (visible) renderExamStage()
  }

  function updateWhatsappHoldPanel(held: boolean): void {
    const panel = ensureHoldPanel()
    if (!panel) return
    panel.hidden = !(state.holdWhatsappUntilApproved && held && isComprehensiveExamsPath(location.pathname))
    if (panel.hidden) return
    placeHoldNotice(panel, location.pathname)
    setPagePanelText(
      panel,
      t('ui.toggle.whatsappHold.panel'),
      t('ui.toggle.whatsappHold.held'),
      t('ui.toggle.whatsappHold.allow'),
    )
  }

  async function applyWhatsappHold(): Promise<void> {
    if (!state.holdWhatsappUntilApproved || whatsappReleasedThisLoad) {
      updateWhatsappHoldPanel(false)
      return
    }
    const sending = await whatsappSendingEnabled()
    if (sending === null) {
      updateWhatsappHoldPanel(whatsappIsHeld())
      return
    }
    if (sending) {
      const stopped = await setWhatsappSending(false)
      if (!stopped) {
        updateWhatsappHoldPanel(false)
        toast({ title: t('ui.toggle.whatsappHold.failed'), variant: 'error' })
        return
      }
      // Only a stop issued by this feature may be auto-resumed later.
      markWhatsappHeldByTamperina(true)
    }
    updateWhatsappHoldPanel(whatsappIsHeld())
  }

  async function releaseWhatsappHold(options?: { silent?: boolean }): Promise<void> {
    if (!whatsappIsHeld()) {
      updateWhatsappHoldPanel(false)
      return
    }
    const released = await setWhatsappSending(true)
    if (!released) {
      if (!options?.silent) toast({ title: t('ui.toggle.whatsappHold.failed'), variant: 'error' })
      return
    }
    markWhatsappHeldByTamperina(false)
    whatsappReleasedThisLoad = true
    updateWhatsappHoldPanel(false)
    if (!options?.silent) {
      toast({ title: t('ui.toggle.whatsappHold.released'), variant: 'applied' })
    }
  }

  function wirePagePanels(): void {
    const holdPanel = ensureHoldPanel()
    holdPanel?.querySelector('button')?.addEventListener('click', () => void releaseWhatsappHold())
  }

  let featureSignature = ''

  function featureStateSignature(controller: UndoRedoController): string {
    return [
      controller.supported,
      controller.enabled,
      controller.busy,
      controller.canUndo,
      controller.canRedo,
      controller.history.map((action) => `${action.id}:${action.title}`).join('|'),
      evaluationFeatureStateSignature(),
      isEvaluationPage(),
      isExamPage(),
      state.examAttendanceStage,
      state.holdWhatsappUntilApproved,
      state.remoteBulk,
      getLocale(),
    ].join('~')
  }

  function evaluationTogglesHtml(): string {
    const onPage = isEvaluationPage()
    const cards = [
      {
        id: 'student-select' as const,
        icon: icons.userCheck,
        title: t('ui.feature.studentSelect.title'),
        desc: t('ui.feature.studentSelect.desc'),
        note: t('ui.feature.studentSelect.note'),
      },
      {
        id: 'evaluation-find' as const,
        icon: icons.search,
        title: t('ui.feature.evalFind.title'),
        desc: t('ui.feature.evalFind.desc'),
        note: t('ui.feature.evalFind.note'),
      },
    ]

    return cards.map((card) => {
      const enabled = isFeatureEnabled(card.id)
      const badge = !onPage
        ? { text: t('ui.common.unavailable'), className: 'off' }
        : enabled
          ? { text: t('ui.common.enabled'), className: 'on' }
          : { text: t('ui.common.disabled'), className: 'off' }
      return `
        <section class="feature-card">
          <header class="feature-head">
            <span class="feature-icon">${card.icon}</span>
            <span class="feature-titles">
              <strong>${card.title}</strong>
              <small>${onPage ? t('ui.feature.scope.evaluation') : t('ui.feature.scope.evaluationOnly')}</small>
            </span>
            <span class="feature-badge ${badge.className}">${badge.text}</span>
            <button type="button" class="switch" data-feature-id="${card.id}" role="switch"
              aria-checked="${enabled}" aria-label="${t('ui.feature.switchAria', { p0: card.title })}" ${onPage ? '' : 'disabled'}><span></span></button>
          </header>
          <p class="feature-desc">${card.desc}</p>
          <p class="feature-note">${icons.keyboard} ${card.note}</p>
        </section>
      `
    }).join('')
  }

  function renderFeature(controller: UndoRedoController): void {
    ensureToggleEffectsStyle()

    // Rebuilding the feature list detaches the focused switch. Remember which
    // control had focus so keyboard users can keep toggling after the rebuild.
    const activeControl = (shadow.activeElement as HTMLElement | null)
      ?.closest<HTMLElement>('[data-locale-toggle], [data-feature-toggle], [data-undo], [data-redo], [data-feature-id]') ?? null
    const focusSelector = activeControl && featureList.contains(activeControl)
      ? activeControl.hasAttribute('data-locale-toggle') ? '[data-locale-toggle]'
        : activeControl.hasAttribute('data-feature-toggle') ? '[data-feature-toggle]'
          : activeControl.hasAttribute('data-undo') ? '[data-undo]'
            : activeControl.hasAttribute('data-redo') ? '[data-redo]'
              : activeControl.dataset.featureId
                ? `[data-feature-id="${CSS.escape(activeControl.dataset.featureId)}"]`
                : null
      : null
    const restoreFocus = (): void => {
      if (!focusSelector) return
      const replacement = featureList.querySelector<HTMLElement>(focusSelector)
      if (replacement && !replacement.hasAttribute('disabled')) replacement.focus()
    }

    const centerState = readFlag('tamperina_center_modal')
    const barcodeHidden = readFlag('tamperina_barcode_hidden')

    document.documentElement.classList.toggle('centered-payment-modal', centerState)
    document.documentElement.classList.toggle('barcode-hidden', barcodeHidden)

    const introClass = featureCardsIntroduced ? '' : ' feature-card--new'
    featureCardsIntroduced = true
    const generalTogglesHtml = `
      <section class="feature-card">
        <header class="feature-head">
          <span class="feature-icon">${icons.center}</span>
          <span class="feature-titles"><strong>${t('ui.toggle.center.title')}</strong></span>
          <button type="button" class="switch" data-feature-id="center-modal" role="switch" aria-checked="${centerState}" aria-label="${t('ui.toggle.center.aria')}"><span></span></button>
        </header>
      </section>
      <section class="feature-card">
        <header class="feature-head">
          <span class="feature-icon">${icons.barcode}</span>
          <span class="feature-titles"><strong>${t('ui.toggle.barcode.title')}</strong></span>
          <button type="button" class="switch" data-feature-id="hide-barcode" role="switch" aria-checked="${barcodeHidden}" aria-label="${t('ui.toggle.barcode.aria')}"><span></span></button>
        </header>
      </section>
      <div class="feature-separator" role="separator"></div>
      <section class="feature-card${introClass} ${state.examAttendanceStage ? 'is-on' : ''}">
        <header class="feature-head">
          <span class="feature-icon">${icons.bulk}</span>
          <span class="feature-titles">
            <strong>${t('ui.toggle.examStage.title')}</strong>
            <small>${t('ui.toggle.examStage.scope', { p0: currentExamId() || '—' })}</small>
          </span>
          <span class="feature-badge ${state.examAttendanceStage ? 'on' : 'off'}">${state.examAttendanceStage ? t('ui.common.enabled') : t('ui.common.disabled')}</span>
          <button type="button" class="switch" data-feature-id="exam-stage" role="switch"
            aria-checked="${state.examAttendanceStage}" aria-label="${t('ui.feature.switchAria', { p0: t('ui.toggle.examStage.title') })}"><span></span></button>
        </header>
        <p class="feature-desc">${t('ui.toggle.examStage.desc')}</p>
      </section>
      <div class="feature-separator" role="separator"></div>
      <section class="feature-card${introClass} ${state.holdWhatsappUntilApproved ? 'is-on' : ''}">
        <header class="feature-head">
          <span class="feature-icon">${icons.play}</span>
          <span class="feature-titles"><strong>${t('ui.toggle.whatsappHold.title')}</strong></span>
          <span class="feature-badge ${state.holdWhatsappUntilApproved ? 'on' : 'off'}">${state.holdWhatsappUntilApproved ? t('ui.common.enabled') : t('ui.common.disabled')}</span>
          <button type="button" class="switch" data-feature-id="whatsapp-hold" role="switch"
            aria-checked="${state.holdWhatsappUntilApproved}" aria-label="${t('ui.feature.switchAria', { p0: t('ui.toggle.whatsappHold.title') })}"><span></span></button>
        </header>
        <p class="feature-desc">${t('ui.toggle.whatsappHold.desc')}</p>
      </section>
      <div class="feature-separator" role="separator"></div>
      <section class="feature-card${introClass} ${state.remoteBulk ? 'is-on' : ''}">
        <header class="feature-head">
          <span class="feature-icon">${icons.refresh}</span>
          <span class="feature-titles">
            <strong>${t('ui.toggle.remoteBulk.title')}</strong>
            <small>${t('ui.toggle.remoteBulk.scope')}</small>
          </span>
          <span class="feature-badge ${state.remoteBulk ? 'on' : 'off'}">${state.remoteBulk ? t('ui.common.enabled') : t('ui.common.disabled')}</span>
          <button type="button" class="switch" data-feature-id="remote-bulk" role="switch"
            aria-checked="${state.remoteBulk}" aria-label="${t('ui.feature.switchAria', { p0: t('ui.toggle.remoteBulk.title') })}"><span></span></button>
        </header>
        <p class="feature-desc">${t('ui.toggle.remoteBulk.desc')}</p>
      </section>
    `
    // The language switch is intentionally the very last card in the menu.
    const englishToggleHtml = `
      <section class="feature-card">
        <header class="feature-head">
          <span class="feature-icon">${icons.toggles}</span>
          <span class="feature-titles"><strong>${t('ui.toggle.english.title')}</strong></span>
          <button type="button" class="switch" data-locale-toggle role="switch" aria-checked="${state.locale === 'en'}" aria-label="${t('ui.toggle.english.aria')}"><span></span></button>
        </header>
        <p class="feature-desc">${t('ui.toggle.english.desc')}</p>
      </section>
    `
    const separator = '<div class="feature-separator" role="separator"></div>'

    if (!controller.supported) {
      featureList.innerHTML = `
        ${generalTogglesHtml}
        ${separator}
        ${evaluationTogglesHtml()}
        ${separator}
        <section class="feature-card">
          <header class="feature-head">
            <span class="feature-icon">${icons.undo}</span>
            <span class="feature-titles">
              <strong>${t('ui.toggle.undo.title')}</strong>
              <small>${t('ui.toggle.undo.notAvailable')}</small>
            </span>
            <span class="feature-badge off">${t('ui.common.unavailable')}</span>
            <button type="button" class="switch" data-feature-toggle role="switch"
              aria-checked="${controller.enabled}" aria-label="${t('ui.toggle.undo.aria')}" disabled><span></span></button>
          </header>
          <p class="feature-desc">
            ${t('ui.toggle.undo.descShort')}
          </p>
        </section>
        ${separator}
        ${englishToggleHtml}
      `
      restoreFocus()
      return
    }

    const badge = controller.busy
      ? { text: t('ui.common.running'), className: 'busy' }
      : controller.enabled
        ? { text: t('ui.common.enabled'), className: 'on' }
        : { text: t('ui.common.disabled'), className: 'off' }

    const recent = controller.history.slice(0, 6)
    const historyHtml = recent.length
      ? `<ul class="history-list">${recent.map((action) => `
          <li class="history-item">
            <span class="history-time">${formatTime(action.at)}</span>
            <span class="history-text">
              <strong>${escapeHtml(action.title)}</strong>
              <small>${escapeHtml(action.detail)}</small>
            </span>
          </li>
        `).join('')}</ul>`
      : `<div class="history-empty">${t('ui.toggle.undo.emptyHistory')}</div>`

    featureList.innerHTML = `
      ${generalTogglesHtml}
      ${separator}
      ${evaluationTogglesHtml()}
      ${separator}
      <section class="feature-card">
        <header class="feature-head">
          <span class="feature-icon">${icons.undo}</span>
          <span class="feature-titles">
            <strong>${t('ui.toggle.undo.title')}</strong>
            <small>${featureScopeLabel()}</small>
          </span>
          <span class="feature-badge ${badge.className}">${badge.text}</span>
          <button type="button" class="switch" data-feature-toggle role="switch"
            aria-checked="${controller.enabled}" aria-label="${t('ui.toggle.undo.aria')}"
            ${controller.busy ? 'disabled' : ''}><span></span></button>
        </header>

        <p class="feature-desc">
          ${t('ui.toggle.undo.desc')}
        </p>

        <div class="feature-actions">
          <button type="button" class="action-btn" data-undo
            ${!controller.enabled || !controller.canUndo || controller.busy ? 'disabled' : ''}>
            ${icons.undo}<span>${t('ui.toggle.undo.undo')}</span><kbd>Ctrl+Z</kbd>
          </button>
          <button type="button" class="action-btn" data-redo
            ${!controller.enabled || !controller.canRedo || controller.busy ? 'disabled' : ''}>
            ${icons.redo}<span>${t('ui.toggle.undo.redo')}</span><kbd>Ctrl+Y</kbd>
          </button>
        </div>

        <div class="history-head">
          ${icons.history}
          <strong>${t('ui.toggle.undo.historyTitle')}</strong>
          <small>${t('ui.toggle.undo.historyCount', { p0: controller.history.length })}</small>
        </div>
        ${historyHtml}

        <p class="feature-note">${icons.shieldAlert}
          ${t('ui.toggle.undo.footerNote')}
        </p>
      </section>
      ${separator}
      ${englishToggleHtml}
    `
    restoreFocus()
  }

  function renderFeatureIfNeeded(): void {
    const signature = featureStateSignature(undoRedo)
    if (signature === featureSignature) return
    featureSignature = signature
    renderFeature(undoRedo)
  }

  undoRedo.subscribe(renderFeatureIfNeeded)
  window.addEventListener('popstate', () => {
    renderFeatureIfNeeded()
    renderBulkMenu()
  })

  /** Update a toggle card in place so its CSS transitions are not lost to a rebuild. */
  function syncToggleCard(button: HTMLButtonElement, enabled: boolean): void {
    const card = button.closest<HTMLElement>('.feature-card')
    if (!card) return
    card.classList.toggle('is-on', enabled)
    const badge = card.querySelector<HTMLElement>('.feature-badge')
    if (!badge) return
    badge.className = `feature-badge ${enabled ? 'on' : 'off'}`
    badge.textContent = enabled ? t('ui.common.enabled') : t('ui.common.disabled')
  }

  function render(): void {
    // The pin tooltip carries an interpolated hotkey, so applyTranslations()
    // cannot own it; refresh it here alongside the other dynamic titles.
    pin.title = t('ui.pin.title', { p0: HOTKEY_RESTORE })
    shellEl.style.insetInlineStart = `${state.x}%`
    shellEl.style.top = `${state.y}%`
    shellEl.style.setProperty('--size', `${state.size}px`)
    flip.classList.toggle('mirrored', state.mirrored)
    spin.classList.toggle('paused', state.paused)
    spin.classList.toggle('frame-1', state.frame === 1)
    spin.classList.toggle('frame-2', state.frame === 2)
    spin.classList.toggle('frame-3', state.frame === 3)
    const wasClickThrough = shellEl.classList.contains('clickthrough')
    shellEl.classList.toggle('clickthrough', state.clickThrough)
    // In click-through mode the launcher is a ghost that cannot receive pointer
    // events, so it must also leave the Tab order and the accessibility tree.
    // The pin button is the visible, focusable way to restore it.
    launcher.tabIndex = state.clickThrough ? -1 : 0
    if (state.clickThrough) launcher.setAttribute('aria-hidden', 'true')
    else launcher.removeAttribute('aria-hidden')
    if (wasClickThrough && !state.clickThrough
      && (shadow.activeElement as HTMLElement | null) === pin) {
      // The pin is about to be display:none; hand focus back to the launcher
      // so it isn't dropped to <body>. Covers pin click, hotkey and GM menu.
      launcher.focus()
    }
    frames.hidden = !state.paused

    for (const btn of pillButtons) {
      const act = btn.dataset.act
      const active = (act === 'mirror' && state.mirrored)
        || (act === 'pause' && state.paused)
        || (act === 'lock' && state.locked)
        || (act === 'clickThrough' && state.clickThrough)
        || (act === 'frame' && Number(btn.dataset.frame) === state.frame)
      btn.classList.toggle('active', active)
      // Only real toggles carry aria-pressed; shrink/grow are one-shot actions.
      if (act === 'mirror' || act === 'pause' || act === 'lock'
        || act === 'clickThrough' || act === 'frame') {
        btn.setAttribute('aria-pressed', String(active))
      }
    }

    const pauseBtn = pill.querySelector<HTMLButtonElement>('[data-act="pause"]')!
    pauseBtn.innerHTML = state.paused ? icons.play : icons.pause
    pauseBtn.title = state.paused ? t('ui.pill.play') : t('ui.pill.pause')

    const lockBtn = pill.querySelector<HTMLButtonElement>('[data-act="lock"]')!
    lockBtn.innerHTML = state.locked ? icons.lock : icons.lockOpen
    lockBtn.title = state.locked ? t('ui.pill.unlock') : t('ui.pill.lock')

    for (const tab of tabButtons) {
      const active = tab.dataset.tab === state.activeTab
      tab.classList.toggle('active', active)
      tab.setAttribute('aria-selected', String(active))
      // Roving tabindex: only the active tab is in the Tab sequence; arrow
      // keys move between tabs (see the tablist keydown handler below).
      tab.tabIndex = active ? 0 : -1
    }
    const activeTab = tabButtons.find((tab) => tab.dataset.tab === state.activeTab) ?? tabButtons[0]
    if (activeTab && tabIndicator) {
      tabIndicator.style.width = `${activeTab.offsetWidth}px`
      tabIndicator.style.height = `${activeTab.offsetHeight}px`
      tabIndicator.style.transform = `translate(${activeTab.offsetLeft}px, ${activeTab.offsetTop}px)`
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.panel !== state.activeTab
    }

    renderFeatureIfNeeded()
  }

  function isModalOpen(): boolean {
    return backdrop.classList.contains('open')
  }

  let closeTimer: number | undefined
  function openModal(): void {
    if (closeTimer) {
      window.clearTimeout(closeTimer)
      closeTimer = undefined
    }
    backdrop.hidden = false
    requestAnimationFrame(() => {
      backdrop.classList.add('open')
      render()
      closeBtn.focus()
    })
  }

  function closeModal(): void {
    if (!isModalOpen() && backdrop.hidden) return
    backdrop.classList.remove('open')
    if (closeTimer) window.clearTimeout(closeTimer)
    closeTimer = window.setTimeout(() => {
      backdrop.hidden = true
      closeTimer = undefined
    }, 240)
    launcher.focus()
  }

  function toggleModal(): void {
    if (isModalOpen()) closeModal()
    else openModal()
  }

  function resizeBy(delta: number): void {
    const next = snapSize(state.size + delta)
    if (next === state.size) return
    state.size = next
    persist()
    render()
  }

  // ---- pill controls -------------------------------------------------------
  pill.addEventListener('click', (event) => {
    const btn = (event.target as Element).closest<HTMLButtonElement>('[data-act]')
    if (!btn) return
    event.stopPropagation()

    switch (btn.dataset.act) {
      case 'shrink': resizeBy(-SIZE_STEP); break
      case 'grow': resizeBy(SIZE_STEP); break
      case 'mirror': state.mirrored = !state.mirrored; break
      case 'pause': state.paused = !state.paused; break
      case 'frame': {
        const frame = Number(btn.dataset.frame)
        if (frame === 1 || frame === 2 || frame === 3) state.frame = frame
        break
      }
      case 'lock': state.locked = !state.locked; break
      case 'clickThrough': {
        state.clickThrough = !state.clickThrough
        // The pill is hidden in click-through mode, so hand focus to the pin
        // restore button; otherwise keyboard focus would be stranded.
        if (state.clickThrough) window.setTimeout(() => pin.focus(), 0)
        break
      }
    }
    persist()
    render()
  })

  // ---- wheel resize (CTZ-style: damp, snap to grid, clamp final size) ------
  launcher.addEventListener('wheel', (event) => {
    if ((event.target as Element).closest('button')) return
    if (state.clickThrough) return
    event.preventDefault()
    event.stopPropagation()

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    const factor = event.deltaMode === 1 ? 16 : 1
    const raw = Math.abs(delta) * factor * 0.15 || 4
    const step = Math.sign(delta) * Math.max(SIZE_STEP, Math.round(raw / SIZE_STEP) * SIZE_STEP)
    resizeBy(step)
  }, { passive: false })

  // ---- drag vs click -------------------------------------------------------
  let dragging = false
  let moved = false
  let startPointerX = 0
  let startPointerY = 0
  let startX = 0
  let startY = 0

  launcher.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('button')) return
    if (state.locked || state.clickThrough) return
    dragging = true
    moved = false
    startPointerX = event.clientX
    startPointerY = event.clientY
    startX = state.x
    startY = state.y
    launcher.setPointerCapture(event.pointerId)
  })

  launcher.addEventListener('pointermove', (event) => {
    if (!dragging) return
    const dx = event.clientX - startPointerX
    const dy = event.clientY - startPointerY
    if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      moved = true
      launcher.classList.add('dragging')
    }
    if (!moved) return
    // x is an inline percentage: in RTL, moving the pointer right decreases it.
    const inlineSign = getComputedStyle(host).direction === 'rtl' ? -1 : 1
    state.x = clamp(startX + inlineSign * (dx / window.innerWidth) * 100, 4, 96)
    state.y = clamp(startY + (dy / window.innerHeight) * 100, 5, 95)
    render()
  })

  function endDrag(event: PointerEvent): void {
    if (!dragging) return
    dragging = false
    launcher.classList.remove('dragging')
    if (launcher.hasPointerCapture(event.pointerId)) launcher.releasePointerCapture(event.pointerId)
    if (moved) persist()
    else openModal()
  }

  launcher.addEventListener('pointerup', endDrag)
  launcher.addEventListener('pointercancel', endDrag)
  launcher.addEventListener('keydown', (event) => {
    if (state.clickThrough) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openModal()
    }
  })

  // ---- click-through recovery --------------------------------------------
  pin.addEventListener('click', (event) => {
    event.stopPropagation()
    state.clickThrough = false
    persist()
    render()
  })

  // ---- modal ---------------------------------------------------------------
  closeBtn.addEventListener('click', closeModal)
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal()
  })

  for (const tab of tabButtons) {
    tab.addEventListener('click', () => {
      const nextTab = tab.dataset.tab === 'bulk' ? 'bulk' : 'toggles'
      const returningToBulk = nextTab === 'bulk' && state.activeTab === 'bulk'
      state.activeTab = nextTab
      persist()
      // Clicking the already-active Bulk tab is a shortcut back to the menu,
      // out of whichever bulk action detail happens to be open.
      if (returningToBulk) showBulkView('menu')
      render()
    })
  }

  // Arrow keys move between tabs and focus the newly selected one, per the
  // WAI-ARIA tabs pattern. Horizontal arrows follow visual order, so they
  // reverse in RTL. Home/End jump to the first/last tab.
  const tablist = backdrop.querySelector<HTMLElement>('.tabs')!
  tablist.addEventListener('keydown', (event) => {
    if (!tabButtons.length) return
    // Inside a shadow tree, document.activeElement is the shadow HOST, not the
    // focused tab. event.target is the real tab; shadow.activeElement is a
    // fallback for synthetic events.
    const focused = (event.target as HTMLElement | null) ?? (shadow.activeElement as HTMLElement | null)
    const currentIndex = tabButtons.indexOf(focused as HTMLButtonElement)
    if (currentIndex < 0) return
    const rtl = getComputedStyle(tablist).direction === 'rtl'
    let nextIndex: number
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + (rtl ? -1 : 1) + tabButtons.length) % tabButtons.length
        break
      case 'ArrowLeft':
        nextIndex = (currentIndex + (rtl ? 1 : -1) + tabButtons.length) % tabButtons.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = tabButtons.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const next = tabButtons[nextIndex]
    state.activeTab = next.dataset.tab === 'bulk' ? 'bulk' : 'toggles'
    persist()
    render()
    next.focus()
  })

  featureList.addEventListener('click', (event) => {
    const btn = (event.target as Element).closest<HTMLButtonElement>('[data-locale-toggle], [data-feature-toggle], [data-undo], [data-redo], [data-feature-id]')
    if (!btn || btn.disabled) return
    event.stopPropagation()
    if (btn.hasAttribute('data-locale-toggle')) {
      state.locale = state.locale === 'en' ? 'ar' : 'en'
      persist()
      setLocale(state.locale)
    } else if (btn.hasAttribute('data-feature-toggle')) {
      const next = !undoRedo.enabled
      btn.setAttribute('aria-checked', String(next))
      window.setTimeout(() => undoRedo.setEnabled(next), 180)
    } else if (btn.hasAttribute('data-undo')) {
      void undoRedo.undo()
    } else if (btn.hasAttribute('data-redo')) {
      void undoRedo.redo()
    } else if (btn.hasAttribute('data-feature-id')) {
      const featureId = btn.dataset.featureId ?? ''
      if (isEvaluationFeatureId(featureId)) {
        const next = !isFeatureEnabled(featureId)
        btn.setAttribute('aria-checked', String(next))
        window.setTimeout(() => setFeatureEnabled(featureId, next), 180)
        return
      }
      if (featureId === 'exam-stage' || featureId === 'whatsapp-hold' || featureId === 'remote-bulk') {
        const current = featureId === 'exam-stage' ? state.examAttendanceStage
          : featureId === 'whatsapp-hold' ? state.holdWhatsappUntilApproved
            : state.remoteBulk
        const next = !current
        if (featureId === 'exam-stage') state.examAttendanceStage = next
        else if (featureId === 'whatsapp-hold') state.holdWhatsappUntilApproved = next
        else state.remoteBulk = next
        persist()
        btn.setAttribute('aria-checked', String(next))
        syncToggleCard(btn, next)
        if (featureId === 'exam-stage') {
          disarmBulk(t('ui.common.dataEdited'))
          if (next) {
            syncExamStageFromEntries(dedupeEntries(allExecutableEntries()))
            void analyzeBulkInput()
          } else {
            examStage = []
            renderExamStage()
            updateBulkButtons()
          }
          updateExamStagePanel()
        } else if (featureId === 'whatsapp-hold') {
          if (!next) {
            if (whatsappIsHeld()) void releaseWhatsappHold({ silent: true })
            else updateWhatsappHoldPanel(false)
          } else {
            whatsappReleasedThisLoad = false
            void applyWhatsappHold()
          }
        } else {
          // The toggle changes how every bulk action behaves, so leave any
          // open detail view and refresh the menu's availability badges.
          if (currentBulkView !== 'menu') showBulkView('menu')
          resetRemoteFlow()
          renderBulkMenu()
        }
        return
      }
      const storageKey = featureId === 'center-modal'
        ? 'tamperina_center_modal'
        : featureId === 'hide-barcode'
          ? 'tamperina_barcode_hidden'
          : `tamperina_${featureId}`
      const current = readFlag(storageKey)
      const newState = !current
      writeFlag(storageKey, newState)
      btn.setAttribute('aria-checked', String(newState))
      if (featureId === 'center-modal') {
        document.documentElement.classList.toggle('centered-payment-modal', newState)
      } else if (featureId === 'hide-barcode') {
        document.documentElement.classList.toggle('barcode-hidden', newState)
      }
    }
  })

  subscribeFeatures(() => {
    renderFeatureIfNeeded()
    if (!isFeatureEnabled('student-select')) selectRow(null, { silent: true })
    if (!isFeatureEnabled('evaluation-find')) findBar.toggle(false)
  })

  document.addEventListener('keydown', (event) => {
    // Events from the modal cross a shadow boundary, so event.target has been
    // retargeted to the host div. Use the composed path to see the real field.
    const path = event.composedPath()
    const realTarget = (path[0] as HTMLElement | null) ?? null
    const host = document.getElementById(HOST_ID)
    const insideTamperina = !!host && path.includes(host)

    // Evaluation find bar: Ctrl+Alt+F (plain Ctrl+F stays with the browser).
    if (event.ctrlKey && event.altKey && !event.metaKey && event.code === 'KeyF' && isEvaluationPage()) {
      if (isFeatureEnabled('evaluation-find')) {
        event.preventDefault()
        findBar.toggle()
      }
      return
    }

    if (!event.defaultPrevented && (event.ctrlKey || event.metaKey) && !event.altKey) {
      const redoShortcut = event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey)
      const undoShortcut = event.code === 'KeyZ' && !event.shiftKey
      if ((undoShortcut || redoShortcut)
        && (undoRedo.supported || undoRedo.canUndo || undoRedo.canRedo)
        && undoRedo.enabled
        // A bulk batch is accumulating actions; undoing here would pop a
        // previously committed action out from under the open batch.
        && !undoRedo.batching
        && (isAttendancePage() || insideTamperina || !isEditableTarget(realTarget))) {
        event.preventDefault()
        if (redoShortcut) void undoRedo.redo()
        else void undoRedo.undo()
        return
      }
    }

    if (event.key === 'Escape' && findBar.isOpen()) {
      event.preventDefault()
      findBar.toggle(false)
      return
    }
    if (event.key === 'Escape' && isModalOpen()) {
      closeModal()
      return
    }
    if (event.key === 'Escape' && isEvaluationPage() && getSelectedRow()) {
      event.preventDefault()
      commitExamTyping()
      selectRow(null, { silent: true })
      return
    }

    if (isEvaluationPage()
      && isFeatureEnabled('student-select')
      && !event.ctrlKey && !event.metaKey && !event.altKey
      && !findBar.isOpen()
      && !insideTamperina
      && !isEditableTarget(realTarget)
      && !realTarget?.closest?.('button, a, [role="button"]')) {
      const selected = getSelectedRow()
      if (selected && handleSelectedRowKey(event, selected)) {
        event.preventDefault()
        return
      }
    }

    if (event.altKey && event.shiftKey && event.code === 'KeyT') {
      event.preventDefault()
      if (state.clickThrough) {
        state.clickThrough = false
        persist()
        render()
      } else {
        toggleModal()
      }
    }
  })

  // ---- bulk attendance (M2) -----------------------------------------------
  const bulkRoot = backdrop.querySelector<HTMLElement>('[data-bulk-root]')!
  const bulkLessonInput = bulkRoot.querySelector<HTMLInputElement>('[data-bulk-lesson]')!
  const bulkCodesInput = bulkRoot.querySelector<HTMLTextAreaElement>('[data-bulk-codes]')!
  const bulkPreviewBtn = bulkRoot.querySelector<HTMLButtonElement>('[data-bulk-preview]')!
  const bulkArmBtn = bulkRoot.querySelector<HTMLButtonElement>('[data-bulk-arm]')!
  const bulkRunBtn = bulkRoot.querySelector<HTMLButtonElement>('[data-bulk-run]')!
  const bulkStopBtn = bulkRoot.querySelector<HTMLButtonElement>('[data-bulk-stop]')!
  const bulkPreviewBox = bulkRoot.querySelector<HTMLElement>('[data-bulk-preview-box]')!
  const bulkResolveBox = bulkRoot.querySelector<HTMLElement>('[data-bulk-resolve]')!
  const examStageBox = bulkRoot.querySelector<HTMLElement>('[data-exam-stage]')!
  const examStageTable = bulkRoot.querySelector<HTMLElement>('[data-exam-stage-table]')!
  const bulkLog = bulkRoot.querySelector<HTMLElement>('[data-bulk-log]')!
  const bulkLogCount = bulkRoot.querySelector<HTMLElement>('[data-bulk-log-count]')!
  const bulkDiagnostics = bulkRoot.querySelector<HTMLElement>('[data-bulk-diagnostics]')!
  const bulkDebugText = bulkRoot.querySelector<HTMLElement>('[data-bulk-debug-text]')!
  const bulkDebugCount = bulkRoot.querySelector<HTMLElement>('[data-bulk-debug-count]')!
  const bulkCopyDebugBtn = bulkRoot.querySelector<HTMLButtonElement>('[data-bulk-copy-debug]')!
  const bulkCopyFailedBtn = bulkRoot.querySelector<HTMLButtonElement>('[data-bulk-copy-failed]')!
  const bulkCopySkippedBtn = bulkRoot.querySelector<HTMLButtonElement>('[data-bulk-copy-skipped]')!
  const bulkRetryBtn = bulkRoot.querySelector<HTMLButtonElement>('[data-bulk-retry]')!
  const bulkBadge = bulkRoot.querySelector<HTMLElement>('[data-bulk-state-badge]')!
  const bulkModeBtns = Array.from(bulkRoot.querySelectorAll<HTMLButtonElement>('[data-bulk-mode-toggle] [data-mode]'))

  // ---- bulk attendance export --------------------------------------------
  const exportRoot = backdrop.querySelector<HTMLElement>('[data-export-root]')!
  const exportLessonInput = exportRoot.querySelector<HTMLInputElement>('[data-export-lesson]')!
  const exportTextarea = exportRoot.querySelector<HTMLTextAreaElement>('[data-export-text]')!
  const exportCount = exportRoot.querySelector<HTMLElement>('[data-export-count]')!
  const exportSummary = exportRoot.querySelector<HTMLElement>('[data-export-summary-text]')!
  const exportRefreshBtn = exportRoot.querySelector<HTMLButtonElement>('[data-export-refresh]')!
  const exportCopyBtn = exportRoot.querySelector<HTMLButtonElement>('[data-export-copy]')!
  const exportDownloadBtn = exportRoot.querySelector<HTMLButtonElement>('[data-export-download]')!

  interface ExamStageRow extends ExamStageRowView {
    label: string
    /** Same resolved identity used by a normal attendance review row. */
    resolved?: NameRow
  }

  let examStage: ExamStageRow[] = []
  let examStageCounter = 0

  function makeExamStageRow(code = '', label = ''): ExamStageRow {
    examStageCounter++
    return {
      id: `stage-${examStageCounter}`,
      enabled: true,
      code,
      label,
      options: { paymentStatus: 'paid', amountPaid: '0.00', paymentNote: '', source: 'manual' },
    }
  }

  function examStageResolvedRow(row: ExamStageRow): NameRow | undefined {
    const code = normalizeStudentCode(row.code)
    if (!code) return undefined
    const matchesCode = (candidate: NameRow): boolean =>
      normalizeStudentCode(candidate.code || candidate.query || candidate.raw) === code
    return bulkCodeRows.find(matchesCode) ?? bulkNameRows.find(matchesCode)
  }

  function stageResolvedRow(row: ExamStageRow): NameRow {
    const resolved = row.resolved ?? examStageResolvedRow(row)
    if (resolved) return resolved
    return {
      kind: 'name',
      key: `stage-${row.id}`,
      raw: row.code,
      query: row.code,
      status: bulkResolving ? 'loading' : 'ready',
      candidates: [],
      message: bulkResolving ? t('ui.common.searching') : undefined,
    }
  }

  /** Resolve exam attendance entries against the students listed on this exam page. */
  function resolveExamEntryFromPage(row: NameRow, allowUnknownCode = false): NameRow {
    const match = matchIdentifier(row.query)
    const candidates: StudentCandidate[] = match.candidates.filter((candidate) => candidate.code).map((candidate) => ({
      id: candidate.code,
      code: candidate.code,
      name: candidate.name,
    }))

    if (match.status === 'ready' && match.code && match.studentName) {
      return {
        ...row,
        status: 'resolved',
        code: match.code,
        studentName: match.studentName,
        candidates,
        message: t('data.name.identified', { p0: match.studentName, p1: match.code }),
      }
    }

    if (allowUnknownCode && match.status === 'not-found') {
      return { ...row, status: 'ready', candidates: [], message: undefined }
    }

    const status = match.status === 'ambiguous' || match.status === 'too-many'
      ? match.status
      : 'not-found'
    return { ...row, status, candidates, message: match.message }
  }

  function syncExamStageResolution(): void {
    for (const row of examStage) {
      const resolved = examStageResolvedRow(row)
      row.resolved = resolved
      if (resolved?.status === 'resolved' && resolved.code) {
        row.code = normalizeStudentCode(resolved.code)
      }
    }
  }

  function examStageEntries(): Array<{ code: string, label?: string, exam?: ExamCheckinOptions }> {
    const result: Array<{ code: string, label?: string, exam?: ExamCheckinOptions }> = []
    for (const row of examStage) {
      if (!row.enabled || !normalizeStudentCode(row.code)) continue
      const resolved = examStageResolvedRow(row)
      if (resolved?.status === 'dropped') continue
      const code = resolved?.status === 'resolved' && resolved.code
        ? normalizeStudentCode(resolved.code)
        : normalizeStudentCode(row.code)
      if (!code) continue
      result.push({
        code,
        label: resolved?.studentName || row.label || resolved?.raw || t('ui.bulk.menu.examAttendance.title'),
        exam: row.options,
      })
    }
    return result
  }

  function syncBulkCodesFromStage(): void {
    bulkCodesInput.value = examStage
      .filter((row) => row.enabled && !!normalizeStudentCode(row.code))
      .map((row) => normalizeStudentCode(row.code))
      .join('\n')
  }

  function refreshStageAnalysis(): void {
    if (!examStage.length) {
      bulkCodesInput.value = ''
      bulkParsed = null
      bulkNameRows = []
      bulkCodeRows = []
      bulkArmed = false
      bulkPreviewBox.textContent = t('ui.bulk.exam.stage.empty')
      renderExamStage()
      renderBulkResolve()
      updateBulkButtons()
      return
    }
    syncBulkCodesFromStage()
    void analyzeBulkInput()
  }

  function markExamStageChanged(): void {
    bulkArmed = false
    setBulkBadge(t('ui.common.dataEdited'), 'off')
    updateBulkButtons()
  }

  function examStageLabels(): ExamStageLabels {
    return {
      title: t('ui.bulk.exam.stage.title'),
      note: t('ui.bulk.exam.stage.note'),
      empty: t('ui.bulk.exam.stage.empty'),
      include: t('ui.bulk.exam.stage.include'),
      ready: t('ui.common.ready'),
      excluded: t('ui.bulk.attendance.ignored'),
      studentCode: t('ui.common.studentCode'),
      codePlaceholder: t('ui.bulk.exam.stage.codePlaceholder'),
      statusLabel: t('ui.bulk.exam.stage.statusLabel'),
      amountLabel: t('ui.bulk.exam.stage.amountLabel'),
      noteLabel: t('ui.bulk.exam.stage.noteLabel'),
      sourceLabel: t('ui.bulk.exam.stage.sourceLabel'),
      remove: t('ui.bulk.exam.stage.remove'),
      add: t('ui.bulk.exam.stage.add'),
      status: {
        paid: t('ui.bulk.exam.stage.status.paid'),
        exempt: t('ui.bulk.exam.stage.status.exempt'),
        deferred: t('ui.bulk.exam.stage.status.deferred'),
      },
      source: {
        manual: t('ui.bulk.exam.stage.source.manual'),
        scanner: t('ui.bulk.exam.stage.source.scanner'),
        camera: t('ui.bulk.exam.stage.source.camera'),
        image: t('ui.bulk.exam.stage.source.image'),
      },
    }
  }

  function renderExamStage(): void {
    for (const btn of bulkRoot.querySelectorAll<HTMLButtonElement>('[data-exam-stage-add]')) {
      btn.disabled = bulkRunning
    }
    examStageTable.innerHTML = renderExamStageTable(examStage, examStageLabels())
  }

  function syncExamStageFromEntries(entries: Array<{ code: string, label?: string, exam?: ExamCheckinOptions }>): void {
    const previous = new Map<string, ExamStageRow>()
    for (const row of examStage) {
      previous.set(normalizeStudentCode(row.code), row)
      const original = row.resolved?.query || row.resolved?.raw
      if (original) previous.set(normalizeStudentCode(original), row)
    }
    const next: ExamStageRow[] = []
    for (const entry of entries) {
      const code = normalizeStudentCode(entry.code)
      if (!code) continue
      const existing = previous.get(code)
      next.push(existing
        ? { ...existing, code, label: entry.label ?? existing.label, resolved: existing.resolved }
        : makeExamStageRow(code, entry.label))
    }
    // Keep blank rows the user just added so they can type the next student.
    for (const row of examStage) {
      if (!normalizeStudentCode(row.code) && !next.some((item) => item.id === row.id)) next.push(row)
    }
    examStage = next.length ? next : [makeExamStageRow()]
    renderExamStage()
  }

  let bulkExamMode = false
  let bulkRan = false
  let bulkParsed: ParseEntriesResult | null = null
  let bulkNameRows: NameRow[] = []
  /** Direct IDs/codes resolved into the same review rows as name inputs. */
  let bulkCodeRows: NameRow[] = []
  let bulkArmed = false
  let bulkRunning = false
  let bulkResolving = false
  let bulkStop = { stop: false }
  let bulkLessonTouched = false
  let bulkLogRows: BulkRowResult[] = []
  let bulkDiagnosticReport = ''
  const BULK_LAST_RUN_KEY = 'tamperina.bulk.lastRun.v1'
  const MAX_STORED_INPUT = 100_000
  const STORED_ROW_STATUSES = new Set<BulkRowResult['status']>([
    'created', 'duplicate', 'skipped-known', 'timeout', 'error', 'stopped',
  ])
  const STORED_PAYMENT_STATUSES = new Set<PaymentStatus>(['paid', 'partial', 'discounted', 'forgotten'])

  /** sessionStorage belongs to the host page, so every field is untrusted. */
  interface StoredBulkRun {
    report: string
    rows: BulkRowResult[]
    input?: string
    lessonId?: string
    paymentMode?: PaymentMode
    overrides?: Array<[string, PaymentOverride]>
  }
  function isStoredRow(value: unknown): value is BulkRowResult {
    if (!value || typeof value !== 'object') return false
    const row = value as Partial<BulkRowResult>
    return typeof row.code === 'string'
      && row.code.length <= 256
      && typeof row.status === 'string'
      && STORED_ROW_STATUSES.has(row.status as BulkRowResult['status'])
      && typeof row.at === 'number'
      && Number.isFinite(row.at)
      && (row.label === undefined || typeof row.label === 'string')
      && (row.message === undefined || typeof row.message === 'string')
      && (row.recordId === undefined || typeof row.recordId === 'string')
      && (row.debug === undefined || (!!row.debug && typeof row.debug === 'object'))
  }
  function isStoredOverride(value: unknown): value is [string, PaymentOverride] {
    if (!Array.isArray(value) || value.length !== 2) return false
    const [code, override] = value as [unknown, unknown]
    if (typeof code !== 'string' || !override || typeof override !== 'object') return false
    const payment = override as Partial<PaymentOverride>
    if (typeof payment.studentCode !== 'string') return false
    if (typeof payment.status !== 'string' || !STORED_PAYMENT_STATUSES.has(payment.status as PaymentStatus)) return false
    if (payment.amountPaid !== undefined && (typeof payment.amountPaid !== 'number' || !Number.isFinite(payment.amountPaid) || payment.amountPaid < 0)) return false
    if (payment.note !== undefined && typeof payment.note !== 'string') return false
    return true
  }
  function parseStoredRun(raw: unknown): StoredBulkRun | null {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Partial<StoredBulkRun>
    if (typeof value.report !== 'string' || value.report.length > MAX_STORED_INPUT) return null
    if (!Array.isArray(value.rows) || value.rows.length > 5000 || !value.rows.every(isStoredRow)) return null
    const run: StoredBulkRun = { report: value.report, rows: value.rows }
    if (typeof value.input === 'string' && value.input.length <= MAX_STORED_INPUT) run.input = value.input
    if (typeof value.lessonId === 'string' && value.lessonId.length <= 64) run.lessonId = value.lessonId
    if (value.paymentMode === 'center' || value.paymentMode === 'school') run.paymentMode = value.paymentMode
    if (Array.isArray(value.overrides) && value.overrides.every(isStoredOverride)) {
      run.overrides = value.overrides
    }
    return run
  }
  let lastBulkRun: StoredBulkRun | null = null
  let bulkAnalysisToken = 0
  let bulkPayMode: PaymentMode = 'center'
  // Walk-in registration preview (names with no matching code)
  let walkInPreviewOpen = false
  const walkInAmounts = new Map<string, number>()
  // Map: uppercase code → override (for school mode)
  const bulkPayOverrides = new Map<string, PaymentOverride>()

  function bulkSupported(): boolean {
    return isAttendancePage() || (bulkExamMode && isExamPage())
  }

  /** Detect center vs school from the scan form data attribute. */
  function detectPagePaymentMode(): PaymentMode {
    const form = document.getElementById('scanForm') as HTMLFormElement | null
    if (!form) return 'center'
    return form.dataset.voiceCenterLesson === '1' ? 'center' : 'school'
  }

  /** Apply a payment mode and update toggle UI. */
  function applyPaymentMode(mode: PaymentMode): void {
    bulkPayMode = mode
    for (const btn of bulkModeBtns) {
      const active = btn.dataset.mode === mode
      btn.classList.toggle('active', active)
      btn.setAttribute('aria-pressed', String(active))
    }
  }

  /** Seed overrides only from explicit payment info; absent info keeps the platform default. */
  function seedPaymentOverridesFromParsed(): void {
    if (!bulkParsed) return
    // Seed from direct codes
    for (const item of bulkParsed.codes) {
      const code = item.code.toUpperCase()
      if (!item.payment || bulkPayOverrides.has(code)) continue
      bulkPayOverrides.set(code, {
        studentCode: code,
        status: item.payment.status,
        amountPaid: item.payment.amountPaid,
      })
    }
    // Seed from resolved names
    for (const row of bulkNameRows) {
      if (row.status !== 'resolved' || !row.code || !row.payment) continue
      const code = row.code.toUpperCase()
      if (bulkPayOverrides.has(code)) continue
      bulkPayOverrides.set(code, {
        studentCode: code,
        status: row.payment.status,
        amountPaid: row.payment.amountPaid,
      })
    }
  }

  function renderInlinePaymentControls(code: string): string {
    if (bulkPayMode !== 'school') return ''
    const key = code.toUpperCase()
    const override = bulkPayOverrides.get(key)
    const status = override?.status ?? 'default'
    const amount = override?.amountPaid
    const needsAmount = status === 'partial' || status === 'discounted'
    const selectOpts = ([
      ['default', t('data.payment.default')],
      ['paid', t('data.payment.paid')],
      ['partial', t('data.payment.partial')],
      ['discounted', t('data.payment.discounted')],
      ['forgotten', t('data.payment.forgotten')],
    ] as const).map(([val, lbl]) =>
      `<option value="${val}" ${status === val ? 'selected' : ''}>${escapeBulk(lbl)}</option>`
    ).join('')
    return `<div class="bulk-inline-pay" data-inline-pay-code="${escapeBulk(key)}">
      <label class="bulk-inline-pay-field">
        <span>${t('ui.bulk.attendance.paymentLabel')}</span>
        <select class="bulk-pay-select" data-inline-pay-status="${escapeBulk(key)}">${selectOpts}</select>
      </label>
      <label class="bulk-inline-pay-field" ${needsAmount ? '' : 'hidden'} data-inline-pay-amount-wrap="${escapeBulk(key)}">
        <span>${t('ui.bulk.attendance.amountLabel')}</span>
        <input type="number" class="bulk-pay-amount" data-inline-pay-amount="${escapeBulk(key)}"
          placeholder="${t('ui.bulk.attendance.amountLabel')}" min="0" step="0.01" value="${amount != null ? escapeBulk(String(amount)) : ''}" />
      </label>
    </div>`
  }

  function setBulkBadge(text: string, className: string): void {
    bulkBadge.textContent = text
    bulkBadge.className = `feature-badge ${className}`
  }

  function escapeBulk(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char] ?? char)
  }

  function paymentStatusLabel(status: PaymentStatus): string {
    const keys: Record<PaymentStatus, Parameters<typeof t>[0]> = {
      paid: 'data.payment.paid',
      partial: 'data.payment.partial',
      discounted: 'data.payment.discounted',
      forgotten: 'data.payment.forgotten',
    }
    return t(keys[status])
  }

  function renderBulkLog(): void {
    bulkLogCount.textContent = String(bulkLogRows.length)
    if (!bulkLogRows.length) {
      bulkLog.innerHTML = `<div class="history-empty">${t('ui.common.logEmpty')}</div>`
      return
    }
    bulkLog.innerHTML = bulkLogRows.slice().reverse().map((row) => {
      const statusLabel: Record<BulkRowResult['status'], string> = {
        created: t('ui.bulk.attendance.logStatusCreated'),
        duplicate: t('ui.bulk.attendance.logStatusDuplicate'),
        'skipped-known': t('ui.bulk.attendance.logStatusSkipped'),
        timeout: t('ui.bulk.attendance.logStatusTimeout'),
        error: t('ui.common.error'),
        stopped: t('ui.common.stopped'),
      }
      const cls = row.status === 'created' ? 'ok'
        : row.status === 'duplicate' || row.status === 'skipped-known' ? 'warn'
        : 'err'
      const label = row.label ? `${escapeBulk(row.label)} · ` : ''
      const detail = row.recordId ? ` · #${escapeBulk(row.recordId)}` : ''
      const http = row.debug?.response ? ` · HTTP ${escapeBulk(String(row.debug.response.status))}` : ''
      const msg = row.message ? ` — ${escapeBulk(row.message)}` : ''
      const hover = row.debug ? ` title="${escapeBulk(JSON.stringify(row.debug))}"` : ''
      return `<div class="bulk-log-item ${cls}"${hover}>
        <span class="bulk-log-code" title="${escapeBulk(label)}${escapeBulk(row.code)}">${escapeBulk(row.code)}</span>
        <span class="bulk-log-status">${label}${statusLabel[row.status]}${detail}${http}${msg}</span>
        <span class="bulk-log-time">${formatTime(row.at)}</span>
      </div>`
    }).join('')
  }

  function appendBulkRow(row: BulkRowResult): void {
    bulkLogRows.push(row)
    renderBulkLog()
  }

  function saveLastBulkRun(): void {
    const snapshot: StoredBulkRun = {
      report: bulkDiagnosticReport,
      rows: bulkLogRows,
      input: bulkCodesInput.value,
      lessonId: bulkLessonInput.value.trim(),
      paymentMode: bulkPayMode,
      overrides: Array.from(bulkPayOverrides.entries()),
    }
    lastBulkRun = snapshot
    try {
      ;(unsafeWindow ?? window).sessionStorage?.setItem(BULK_LAST_RUN_KEY, JSON.stringify(snapshot))
    } catch {
      // sessionStorage can be unavailable; the in-memory snapshot still works.
    }
    updateBulkButtons()
  }

  function restoreLastBulkRun(): void {
    try {
      const raw = (unsafeWindow ?? window).sessionStorage?.getItem(BULK_LAST_RUN_KEY)
      if (!raw) return
      const parsed = parseStoredRun(JSON.parse(raw) as unknown)
      if (!parsed) return
      lastBulkRun = parsed
      bulkDiagnosticReport = parsed.report
      bulkLogRows = parsed.rows
      renderBulkLog()
      bulkDebugText.textContent = parsed.report
      bulkDebugCount.textContent = String(
        parsed.rows.filter((row) => row.status === 'error' || row.status === 'timeout').length,
      )
      bulkDiagnostics.hidden = false
      updateBulkButtons()
    } catch {
      // Ignore missing or malformed data from an older version.
    }
  }

  /** Unique, uppercase codes from failed rows — the only ones a retry may submit. */
  function retryableCodes(run: StoredBulkRun | null): string[] {
    if (!run) return []
    const seen = new Set<string>()
    const codes: string[] = []
    for (const row of run.rows) {
      if (row.status !== 'error' && row.status !== 'timeout') continue
      const code = row.code.trim().toUpperCase()
      if (!code || seen.has(code)) continue
      seen.add(code)
      codes.push(code)
    }
    return codes
  }

  function disarmBulk(reason?: string): void {
    bulkArmed = false
    if (reason) setBulkBadge(reason, 'off')
  }

  function allExecutableEntries(): Array<{ code: string, label?: string }> {
    if (!bulkParsed) return []
    const result: Array<{ code: string, label?: string }> = []
    for (const item of bulkParsed.codes) {
      const row = bulkCodeRows.find((candidate) => candidate.key === `code-${item.key}`)
      if (row?.status === 'dropped') continue
      result.push({
        code: row?.status === 'resolved' && row.code ? row.code.toUpperCase() : item.code,
        label: row?.studentName ?? item.raw,
      })
    }
    for (const row of bulkNameRows) {
      if (row.status === 'dropped') continue
      if (row.status === 'resolved' && row.code) {
        result.push({ code: row.code.toUpperCase(), label: row.studentName ?? row.query })
      }
    }
    return result
  }

  function dedupeEntries(entries: Array<{ code: string, label?: string, exam?: ExamCheckinOptions }>): Array<{ code: string, label?: string, exam?: ExamCheckinOptions }> {
    const seen = new Set<string>()
    return entries.filter((entry) => {
      const code = entry.code.toUpperCase()
      if (seen.has(code)) return false
      seen.add(code)
      return true
    })
  }

  /** Same student can appear as a code and as a resolved name — submit them once. */
  function executableEntries(): Array<{ code: string, label?: string, exam?: ExamCheckinOptions }> {
    if (bulkExamMode && examStageVisible()) return examStageEntries()
    return dedupeEntries(allExecutableEntries())
  }

  function duplicateEntryCount(): number {
    return allExecutableEntries().length - executableEntries().length
  }

  function unresolvedNameRows(): NameRow[] {
    return bulkNameRows.filter((row) =>
      row.status !== 'resolved' && row.status !== 'dropped' && row.status !== 'walk-in')
  }

  /**
   * Rows shown in the top follow-up section. Ignored rows stay here (instead
   * of being moved down with the decided ones) so the whole list can still be
   * copied or registered as walk-ins. They remain excluded from the batch and
   * from the arming gate — only their position/visibility changes.
   */
  function pendingNameRows(): NameRow[] {
    return bulkNameRows.filter((row) =>
      row.status !== 'resolved' && row.status !== 'walk-in')
  }

  const WALKIN_DEFAULT_AMOUNT = 45
  const WALKIN_MAX_AMOUNT = 999999.99

  function walkInAmountFor(row: NameRow): number {
    const stored = walkInAmounts.get(row.key)
    if (stored != null) return stored
    const parsed = row.payment?.amountPaid
    const amount = parsed == null || !Number.isFinite(parsed) ? WALKIN_DEFAULT_AMOUNT : parsed
    return Math.min(WALKIN_MAX_AMOUNT, Math.max(0, amount))
  }

  function formatWalkInAmount(amount: number): string {
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
  }

  function walkInPageHidden(el: HTMLElement): boolean {
    const style = getComputedStyle(el)
    return Boolean(el.hidden) || el.offsetParent === null
      || style.display === 'none' || style.visibility === 'hidden'
  }

  /** Walk-in panel can be collapsed; try the page's own toggle before filling it. */
  function ensureWalkInFormVisible(form: HTMLElement): boolean {
    if (!walkInPageHidden(form)) return true
    const label = /طلاب جدد بدون كارت|بدون كارت|walk.?in/i
    const toggle = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"], [aria-controls]'))
      .find((el) => el.getAttribute('aria-controls') === 'walkInForm'
        || (el.getAttribute('data-bs-target') || '').includes('walkIn')
        || label.test(el.textContent || ''))
    if (toggle) toggle.click()
    return !walkInPageHidden(form)
  }

  function waitForWalkInState(stateEl: HTMLElement, timeoutMs = 12000): Promise<{ text: string; timedOut: boolean }> {
    const initial = (stateEl.textContent || '').trim()
    if (initial && !/جار|جرى|جاري|loading|processing/i.test(initial)) {
      return Promise.resolve({ text: initial, timedOut: false })
    }
    return new Promise((resolve) => {
      let done = false
      const finish = (text: string, timedOut: boolean): void => {
        if (done) return
        done = true
        observer.disconnect()
        window.clearTimeout(timer)
        resolve({ text, timedOut })
      }
      const read = (): string => (stateEl.textContent || '').trim()
      const observer = new MutationObserver(() => {
        const text = read()
        if (text && !/جار|جرى|جاري|loading|processing/i.test(text)) finish(text, false)
      })
      observer.observe(stateEl, { childList: true, subtree: true, characterData: true })
      const timer = window.setTimeout(() => finish(read() || t('ui.bulk.attendance.submitTimeout'), true), timeoutMs)
    })
  }

  /** Fill the page's own "طلاب جدد بدون كارت" form and submit it. */
  async function registerWalkInStudents(): Promise<void> {
    const rows = pendingNameRows()
    if (!rows.length) return

    const form = document.getElementById('walkInForm') as HTMLFormElement | null
    const rowsBox = document.getElementById('walkInRows') as HTMLElement | null
    const addBtn = document.getElementById('addWalkInRow') as HTMLButtonElement | null
    const stateEl = document.getElementById('walkInState') as HTMLElement | null
    if (!form || !rowsBox || !addBtn || !stateEl) {
      toast({ title: t('ui.bulk.attendance.noFormTitle'), description: t('ui.bulk.attendance.noFormDesc'), variant: 'warning' })
      return
    }
    if (!ensureWalkInFormVisible(form)) {
      toast({ title: t('ui.bulk.attendance.panelHiddenTitle'), description: t('ui.bulk.attendance.panelHiddenDesc'), variant: 'warning' })
      return
    }

    const pageRows = (): HTMLElement[] =>
      Array.from(rowsBox.querySelectorAll<HTMLElement>('.walkin-row'))

    // Match the page's row count to our list. Use its own buttons so the
    // generated data-walkin-key UUIDs and listeners stay in sync.
    while (pageRows().length < rows.length) {
      const before = pageRows().length
      addBtn.click()
      if (pageRows().length <= before) break
    }
    const current = pageRows()
    for (let i = current.length - 1; i >= rows.length; i--) {
      const remove = current[i].querySelector<HTMLButtonElement>('.walkin-remove')
      if (remove) remove.click()
      if (current[i].parentNode) current[i].remove()
    }

    const targets = pageRows().slice(0, rows.length)
    if (targets.length !== rows.length) {
      toast({ title: t('ui.bulk.attendance.prepareFailedTitle'), description: t('ui.bulk.attendance.prepareFailedDesc'), variant: 'warning' })
      return
    }

    targets.forEach((target, index) => {
      const row = rows[index]
      const name = row.query || row.studentName || row.raw
      const nameInput = target.querySelector<HTMLInputElement>('[data-walkin-name]')
      const amountInput = target.querySelector<HTMLInputElement>('[data-walkin-amount]')
      if (nameInput) {
        nameInput.value = name
        nameInput.dispatchEvent(new Event('input', { bubbles: true }))
        nameInput.dispatchEvent(new Event('change', { bubbles: true }))
      }
      if (amountInput) {
        amountInput.value = formatWalkInAmount(walkInAmountFor(row))
        amountInput.dispatchEvent(new Event('input', { bubbles: true }))
        amountInput.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })

    stateEl.textContent = ''
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')
    if (!submitBtn) {
      toast({ title: t('ui.bulk.attendance.submitFailedTitle'), description: t('ui.bulk.attendance.submitFailedDesc'), variant: 'warning' })
      return
    }
    submitBtn.click()
    const { text: stateText, timedOut } = await waitForWalkInState(stateEl)

    if (timedOut) {
      toast({
        title: t('ui.bulk.attendance.walkInUnverifiedTitle'),
        description: t('ui.bulk.attendance.walkInUnverifiedDesc'),
        variant: 'warning',
        duration: 12000,
      })
      return
    }

    const failed = /خطأ|فشل|تعذّر|تعذر|غير صالح|لم يتم|لم تُسجّل|لم تسجل|error|failed/i.test(stateText)
    if (failed) {
      toast({ title: t('ui.bulk.attendance.registerFailedTitle'), description: stateText, variant: 'error', duration: 9000 })
      return
    }

    const now = Date.now()
    for (const row of rows) {
      const name = row.query || row.studentName || row.raw
      bulkNameRows = bulkNameRows.map((item) => item.key === row.key
        ? { ...item, status: 'walk-in' as const, message: stateText }
        : item)
      appendBulkRow({
        code: name,
        label: t('ui.bulk.attendance.walkInLogLabel'),
        status: 'created',
        message: stateText,
        at: now,
      })
    }
    walkInPreviewOpen = false
    bulkArmed = false
    renderBulkAnalysis()
    toast({
      title: t('ui.bulk.attendance.walkInRegisteredTitle'),
      description: t('ui.bulk.attendance.walkInRegisteredDesc', { p0: rows.length, p1: stateText }),
      variant: 'applied',
      duration: 9000,
    })
  }

  function readyToArm(): boolean {
    if (!bulkParsed) return false
    if (bulkExamMode && !examTargetAllowed('exam-attendance', bulkCodesInput.value)) return false
    if (bulkExamMode && examStageVisible() && examStageEntries().length === 0) return false
    if (bulkResolving) return false
    const exec = executableEntries()
    if (!exec.length) return false
    if (unresolvedNameRows().length) return false
    return true
  }

  /** Single review row builder shared by normal attendance and exam check-in. */
  function renderBulkRow(row: NameRow, exam?: ExamStageRow): string {
    const statusText: Record<NameRow['status'], string> = {
      ready: t('ui.common.ready'),
      resolved: row.studentName ? t('ui.bulk.attendance.identifiedAs', { p0: `${row.studentName}${row.code ? ` (${row.code})` : ''}` }) : t('ui.bulk.attendance.identified'),
      ambiguous: t('ui.bulk.attendance.ambiguousName'),
      'not-found': t('ui.bulk.attendance.nameNotFound'),
      'too-many': t('ui.common.tooMany'),
      dropped: t('ui.bulk.attendance.droppedManual'),
      'walk-in': row.message ? t('ui.bulk.attendance.walkInStatus', { p0: row.message }) : t('ui.bulk.attendance.walkInStatusShort'),
      loading: t('ui.common.searching'),
      error: t('ui.bulk.attendance.searchFailed'),
    }
    const cls = exam && !exam.enabled ? 'drop'
      : row.status === 'resolved' || row.status === 'walk-in' ? 'ok'
        : row.status === 'dropped' ? 'drop'
          : row.status === 'loading' ? ''
            : (row.status === 'ready' ? 'ok' : '')

    let choicesHtml = ''
    if ((row.status === 'ambiguous' || row.status === 'not-found' || row.status === 'too-many' || row.status === 'error' || row.status === 'resolved')
      && row.candidates.length) {
      const list = row.candidates.slice(0, 12)
      const isChosen = (c: (typeof list)[number]): boolean => row.status === 'resolved'
        && ((!!row.code && c.code === row.code) || (!row.code && c.name === row.studentName))
      const choiceButton = (c: (typeof list)[number]): string => {
        const chosen = isChosen(c)
        return `<button type="button" class="bulk-choice ${chosen ? 'selected' : ''}"
          data-resolve-action="choose" data-key="${escapeBulk(row.key)}"
          data-id="${escapeBulk(c.id)}" data-code="${escapeBulk(c.code)}" data-name="${escapeBulk(c.name)}">
          <span class="bulk-choice-label">
            ${chosen ? `<span class="bulk-choice-mark">${t('ui.bulk.attendance.chosenMark')}</span>` : ''}
            <span>${escapeBulk(c.name || t('ui.common.student'))}</span>
          </span>
          <small>${escapeBulk(c.code || t('ui.common.noCode'))}</small>
        </button>`
      }
      if (row.status === 'resolved') {
        const chosen = list.filter(isChosen)
        const others = list.filter((c) => !isChosen(c))
        if (chosen.length) {
          choicesHtml += `<div class="bulk-resolve-chosen-note">${t('ui.bulk.attendance.chosenNote')}</div>
            <div class="bulk-resolve-choices chosen-group">${chosen.map(choiceButton).join('')}</div>`
        }
        if (others.length) {
          choicesHtml += `<div class="bulk-resolve-chosen-note muted">${t('ui.bulk.attendance.otherResultsNote')}</div>
            <div class="bulk-resolve-choices other-group">${others.map(choiceButton).join('')}</div>`
        }
      } else {
        choicesHtml = `<div class="bulk-resolve-choices">${list.map(choiceButton).join('')}</div>`
      }
      if (row.candidates.length > 12) {
        choicesHtml += `<div class="bulk-note-inline">${t('ui.common.moreResults', { p0: row.candidates.length - 12 })}</div>`
      }
    }

    const editHtml = row.status === 'dropped' || row.status === 'walk-in' ? '' : `<div class="bulk-inline-edit" ${row.status === 'resolved' ? 'hidden' : ''}>
        <input type="text" class="bulk-input" data-resolve-edit="${escapeBulk(row.key)}" value="${escapeBulk(row.query)}" placeholder="${t('ui.bulk.attendance.editPlaceholder')}" />
        <button type="button" class="bulk-mini-btn" data-resolve-action="research" data-key="${escapeBulk(row.key)}">${t('ui.bulk.attendance.research')}</button>
      </div>`

    const actions = row.status === 'dropped' || row.status === 'walk-in'
      ? `<div class="bulk-resolve-actions"><button type="button" class="bulk-mini-btn" data-resolve-action="undrop" data-key="${escapeBulk(row.key)}">${t('ui.common.restore')}</button></div>`
      : `<div class="bulk-resolve-actions">
          ${row.status === 'resolved' ? `<button type="button" class="bulk-mini-btn" data-resolve-action="change" data-key="${escapeBulk(row.key)}">${t('ui.common.change')}</button>` : ''}
          <button type="button" class="bulk-mini-btn" data-resolve-action="drop" data-key="${escapeBulk(row.key)}">${t('ui.common.ignoreManual')}</button>
        </div>`

    const reason = row.message && row.status !== 'resolved' ? `<div class="bulk-resolve-reason">${escapeBulk(row.message)}</div>` : ''
    const pay = (row.status === 'resolved' && row.code) ? renderInlinePaymentControls(row.code) : ''

    // Both input kinds render the same resolved identity: name first, then its
    // ID. Exam rows keep their editable check-in fields inside this same row.
    const identityName = row.studentName || row.raw || row.query
    const identityCode = row.code
      ? `<span class="bulk-resolve-id" dir="ltr" title="${escapeBulk(row.code)}">#${escapeBulk(row.code)}</span>`
      : ''
    const labels = exam ? examStageLabels() : null
    const examBadge = exam && labels
      ? `<span class="feature-badge ${exam.enabled ? 'on' : 'off'}">${exam.enabled ? labels.ready : labels.excluded}</span>`
      : ''
    const examFields = exam && labels ? renderExamStageFields(exam, labels, { hidePayment: bulkPayMode === 'center' }) : ''
    const examAttrs = exam ? ` data-exam-stage-row="${escapeBulk(exam.id)}"` : ''

    return `<div class="bulk-resolve-item ${cls}" data-resolve-key="${escapeBulk(row.key)}"${examAttrs}>
      <div class="bulk-resolve-head">
        <span class="bulk-resolve-name">${escapeBulk(identityName)}</span>
        ${identityCode}
        <span class="feature-badge ${row.status === 'resolved' ? 'on' : row.status === 'dropped' ? 'off' : 'busy'}">${escapeBulk(statusText[row.status])}</span>
        ${examBadge}
      </div>
      ${reason}
      ${choicesHtml}
      ${row.status === 'loading' ? '' : editHtml}
      ${row.status === 'loading' ? '' : actions}
      ${pay}
      ${examFields}
    </div>`
  }

  function renderBulkResolve(): void {
    if (bulkParsed && bulkPayMode === 'school') seedPaymentOverridesFromParsed()

    const nameRows = bulkNameRows
    // Ignored rows deliberately remain at the top with the unresolved ones so
    // "نسخ" still includes them (e.g. ignore all, then copy to handle manually).
    const undecided = pendingNameRows()
    const decidedNames = nameRows.filter((row) =>
      row.status === 'resolved' || row.status === 'walk-in')
    // In exam attendance the staged students replace the separate stage table
    // after preview and use the same review-item markup as normal attendance.
    const showExamStageReview = bulkExamMode && examStageVisible() && !!bulkParsed
    const examReview = showExamStageReview
      ? renderExamStageReview(examStage, examStageLabels(), {
        addDisabled: bulkRunning,
        renderRow: (stageRow) => renderBulkRow(stageResolvedRow(stageRow), stageRow),
      })
      : ''
    // Direct IDs use the exact same resolved review rows as names, including
    // the identified pill and inline payment controls when applicable.
    if (!examReview && !nameRows.length && !bulkCodeRows.length) {
      bulkResolveBox.hidden = true
      bulkResolveBox.innerHTML = ''
      return
    }

    const renderNameRow = (row: NameRow): string => renderBulkRow(row)

    let html = ''

    if (undecided.length) {
      const undecidedText = undecided.map((row) => row.raw || row.query).join('\n')
      html += `<div class="bulk-undecided-section">
        <div class="bulk-undecided-head">
          <div class="bulk-undecided-title">
            <strong>${t('ui.bulk.attendance.unresolvedSectionTitle')}</strong>
            <span class="feature-badge busy">${undecided.length}</span>
          </div>
          <div class="bulk-resolve-actions">
            <button type="button" class="bulk-mini-btn" data-bulk-copy-undecided data-copy-text="${escapeBulk(undecidedText)}">${t('ui.common.copy')}</button>
            <button type="button" class="bulk-mini-btn" data-resolve-action="drop-all">${t('ui.bulk.attendance.dropAll')}</button>
            <button type="button" class="bulk-mini-btn" data-walkin-toggle aria-expanded="${walkInPreviewOpen}">${t('ui.bulk.attendance.walkInToggle')}</button>
          </div>
        </div>
        <div class="bulk-note-inline">${t('ui.bulk.attendance.ignoreNote')}</div>
        <div class="bulk-walkin-panel" data-walkin-panel ${walkInPreviewOpen ? '' : 'hidden'}>
          <div class="bulk-warn">${t('ui.bulk.attendance.walkInWarn')}</div>
          <div class="bulk-walkin-rows">
            ${undecided.map((row) => `<div class="bulk-walkin-row">
              <span title="${escapeBulk(row.raw)}">${escapeBulk(row.query || row.raw)}</span>
              <input type="number" class="bulk-input" inputmode="decimal" min="0" max="999999.99" step="0.01"
                data-walkin-amount-key="${escapeBulk(row.key)}" value="${formatWalkInAmount(walkInAmountFor(row))}"
                aria-label="${t('ui.bulk.attendance.walkInAmountAria', { p0: escapeBulk(row.query || row.raw) })}" />
            </div>`).join('')}
          </div>
          <div class="bulk-resolve-actions">
            <button type="button" class="bulk-mini-btn" data-walkin-confirm>${t('ui.bulk.attendance.registerAndCollect')}</button>
            <button type="button" class="bulk-mini-btn" data-walkin-cancel>${t('ui.bulk.attendance.cancel')}</button>
          </div>
        </div>
        ${undecided.map(renderNameRow).join('')}
      </div>`
    }

    if (bulkCodeRows.length && !showExamStageReview) {
      html += `<div class="bulk-resolve-group">${bulkCodeRows.map(renderNameRow).join('')}</div>`
    }

    if (decidedNames.length) {
      html += `<div class="bulk-resolve-group">${decidedNames.map(renderNameRow).join('')}</div>`
    }

    bulkResolveBox.hidden = false
    bulkResolveBox.innerHTML = `${examReview}${html}`
  }

  function updateBulkButtons(): void {
    const supported = bulkSupported()
    const canPreview = supported && !bulkRunning
    const canArm = supported && !bulkRunning && readyToArm()
    const canRun = supported && !bulkRunning && bulkArmed && readyToArm() && undoRedo.enabled

    bulkPreviewBtn.disabled = !canPreview
    bulkArmBtn.disabled = !canArm
    bulkRunBtn.disabled = !canRun
    bulkStopBtn.disabled = !bulkRunning
    bulkRetryBtn.disabled = !(supported && !bulkRunning && !bulkResolving
      && !!lastBulkRun?.input && retryableCodes(lastBulkRun).length > 0)

    if (!supported) {
      setBulkBadge(t('ui.bulk.attendance.notOnPage'), 'off')
    } else if (bulkRunning) {
      setBulkBadge(t('ui.common.running'), 'busy')
    } else if (bulkResolving) {
      setBulkBadge(t('ui.bulk.attendance.analyzing'), 'busy')
    } else if (bulkArmed) {
      setBulkBadge(t('ui.common.armed'), 'on')
    } else if (unresolvedNameRows().length) {
      setBulkBadge(t('ui.common.needsDecision'), 'busy')
    } else {
      setBulkBadge(t('ui.common.ready'), 'off')
    }
  }

  function refreshBulkLesson(force = false): void {
    if (bulkLessonTouched && !force) return
    const lessonId = currentLessonIdFromPage()
    if (lessonId) bulkLessonInput.value = String(lessonId)
  }

  function renderBulkAnalysisSummary(): void {
    if (!bulkParsed) {
      bulkPreviewBox.textContent = t('ui.common.previewEmpty')
      return
    }

    if (!bulkSupported()) {
      bulkPreviewBox.innerHTML = `<div class="bulk-warn">${t('ui.bulk.attendance.openScanPage')}</div>`
      return
    }

    const scan = detectScanForm()
    const lessonId = bulkLessonInput.value.trim() || currentLessonIdFromPage() || null
    const pageLessonId = scan?.lessonId ?? currentLessonIdFromPage() ?? null
    const exec = executableEntries()
    const unresolved = unresolvedNameRows()
    const dropped = bulkNameRows.filter((r) => r.status === 'dropped').length
    const walkInCount = bulkNameRows.filter((r) => r.status === 'walk-in').length
    const resolvedNames = bulkNameRows.filter((r) => r.status === 'resolved').length
      + bulkCodeRows.filter((r) => r.status === 'resolved').length

    const parts: string[] = []
    parts.push(`<div class="bulk-preview-grid">
      <div><strong>${t('ui.bulk.attendance.targetLesson')}</strong><span>${escapeHtml(lessonId ?? t('ui.bulk.attendance.unknownLesson'))}</span></div>
      <div><strong>${t('ui.bulk.attendance.openLesson')}</strong><span>${escapeHtml(pageLessonId ?? t('ui.bulk.attendance.unknownPageLesson'))}</span></div>
      <div><strong>${t('ui.bulk.attendance.inputField')}</strong><span dir="ltr">${escapeHtml(scan?.inputSelector ?? t('ui.bulk.attendance.unknownSelector'))}</span></div>
      <div><strong>${t('ui.bulk.attendance.directCodes')}</strong><span>${bulkParsed.codes.length}</span></div>
      <div><strong>${t('ui.bulk.attendance.recognizedNames')}</strong><span>${resolvedNames}/${bulkParsed.names.length}</span></div>
      <div><strong>${t('ui.bulk.attendance.needsDecision')}</strong><span>${unresolved.length}</span></div>
      <div><strong>${t('ui.bulk.attendance.ignored')}</strong><span>${dropped}</span></div>
      <div><strong>${t('ui.bulk.attendance.walkIns')}</strong><span>${walkInCount}</span></div>
      <div><strong>${t('ui.bulk.attendance.readyToSend')}</strong><span>${exec.length}</span></div>
      <div><strong>${t('ui.bulk.attendance.duplicates')}</strong><span>${bulkParsed.duplicates.length + duplicateEntryCount()}</span></div>
      <div><strong>${t('ui.bulk.attendance.modeLabel')}</strong><span>${bulkPayMode === 'school' ? t('ui.bulk.attendance.modeSchool') : t('ui.bulk.attendance.modeCenter')}</span></div>
      <div><strong>${t('ui.bulk.attendance.invalid')}</strong><span>${bulkParsed.invalid.length}</span></div>
    </div>`)

    if (!scan) {
      parts.push(`<div class="bulk-warn">${t('ui.bulk.attendance.formNotFound')}</div>`)
    }
    if (pageLessonId && lessonId && String(lessonId) !== String(pageLessonId)) {
      parts.push(`<div class="bulk-warn">${t('ui.bulk.attendance.lessonMismatch', { p0: escapeHtml(lessonId), p1: escapeHtml(pageLessonId) })}</div>`)
    }
    if (bulkParsed.invalid.length) {
      parts.push(`<div class="bulk-warn">${t('ui.bulk.attendance.invalidValues', { p0: bulkParsed.invalid.slice(0, 12).map(escapeHtml).join(listSeparator()), p1: bulkParsed.invalid.length > 12 ? '…' : '' })}</div>`)
    }
    if (bulkParsed.duplicates.length) {
      parts.push(`<div class="bulk-note-inline">${t('ui.bulk.attendance.removedDuplicates', { p0: bulkParsed.duplicates.slice(0, 12).map(escapeHtml).join(listSeparator()), p1: bulkParsed.duplicates.length > 12 ? '…' : '' })}</div>`)
    }
    if (unresolved.length) {
      parts.push(`<div class="bulk-warn">${t('ui.bulk.attendance.unresolvedWarning', { p0: unresolved.length })}</div>`)
    }
    if (!undoRedo.enabled) {
      parts.push(`<div class="bulk-warn">${t('ui.bulk.attendance.undoDisabledWarning')}</div>`)
    }
    if (!exec.length && !bulkResolving) {
      parts.push(`<div class="bulk-warn">${t('ui.bulk.attendance.noReadyEntries')}</div>`)
    }
    if (duplicateEntryCount()) {
      parts.push(`<div class="bulk-note-inline">${t('ui.bulk.attendance.mergedDuplicates', { p0: duplicateEntryCount() })}</div>`)
    }
    parts.push(bulkPayMode === 'school'
      ? `<div class="bulk-note-inline">${t('ui.bulk.attendance.schoolMode')}</div>`
      : `<div class="bulk-note-inline">${t('ui.bulk.attendance.centerMode')}</div>`)

    bulkPreviewBox.innerHTML = parts.join('')
  }

  function renderBulkAnalysis(): void {
    updateExamStagePanel()
    renderBulkAnalysisSummary()
    renderBulkResolve()
    updateBulkButtons()
  }

  function invalidateBulkAnalysis(): void {
    if (bulkRunning) return
    bulkAnalysisToken++
    bulkResolving = false
    bulkParsed = null
    bulkNameRows = []
    bulkCodeRows = []
    bulkArmed = false
    bulkPayOverrides.clear()
    bulkPreviewBox.textContent = t('ui.common.dataEdited')
    bulkResolveBox.hidden = true
    bulkResolveBox.innerHTML = ''
    updateExamStagePanel()
    updateBulkButtons()
  }

  async function analyzeBulkInput(): Promise<void> {
    if (!bulkSupported()) {
      bulkParsed = null
      bulkNameRows = []
      bulkCodeRows = []
      renderBulkAnalysis()
      disarmBulk(t('ui.common.unavailable'))
      return
    }

    if (bulkExamMode && !examTargetAllowed('exam-attendance', bulkCodesInput.value)) {
      bulkAnalysisToken++
      bulkParsed = null
      bulkNameRows = []
      bulkCodeRows = []
      bulkResolving = false
      bulkPreviewBox.innerHTML = `<div class="bulk-warn">${t('ui.bulk.exam.guard')}</div>`
      bulkResolveBox.hidden = true
      bulkResolveBox.innerHTML = ''
      disarmBulk(t('ui.common.unavailable'))
      updateBulkButtons()
      return
    }

    const token = ++bulkAnalysisToken
    const lessonId = bulkLessonInput.value.trim() || currentLessonIdFromPage() || ''
    bulkParsed = parseBulkEntries(bulkCodesInput.value)
    const makeRow = (key: string, raw: string, query: string, payment?: NameRow['payment']): NameRow => ({
      kind: 'name',
      key,
      raw,
      query,
      status: lessonId || bulkExamMode ? 'loading' : 'error',
      candidates: [],
      message: lessonId || bulkExamMode ? t('ui.common.searching') : t('ui.bulk.attendance.specifyLesson'),
      payment,
    })
    bulkNameRows = bulkParsed.names.map((entry) => makeRow(entry.key, entry.raw, entry.query, entry.payment))
    // Direct IDs — including exam stage IDs — go through the same resolution so
    // their review row is identical to a name row: name + id + identified pill.
    bulkCodeRows = bulkParsed.codes.map((entry) =>
      makeRow(`code-${entry.key}`, entry.raw, entry.code, entry.payment))
    bulkArmed = false
    bulkPayOverrides.clear()
    seedPaymentOverridesFromParsed()
    if (bulkExamMode && examStageVisible()) {
      syncExamStageFromEntries(dedupeEntries(allExecutableEntries()))
      syncExamStageResolution()
    }
    bulkResolving = (bulkNameRows.length + bulkCodeRows.length) > 0 && (!!lessonId || bulkExamMode)
    renderBulkAnalysis()

    if (!lessonId && !bulkExamMode) {
      bulkResolving = false
      renderBulkAnalysis()
      return
    }

    const resolveRows = async (rows: NameRow[], useExamPage = false): Promise<void> => {
      for (let i = 0; i < rows.length; i++) {
        if (token !== bulkAnalysisToken) return
        const current = rows[i]
        const resolved = useExamPage
          ? resolveExamEntryFromPage(current, rows === bulkCodeRows)
          : await resolveNameEntry(current, lessonId)
        if (token !== bulkAnalysisToken) return
        rows[i] = { ...resolved, payment: current.payment }
        if (rows[i].payment && rows[i].status === 'resolved' && rows[i].code) {
          const code = rows[i].code!.toUpperCase()
          if (!bulkPayOverrides.has(code)) {
            bulkPayOverrides.set(code, {
              studentCode: code,
              status: rows[i].payment!.status,
              amountPaid: rows[i].payment!.amountPaid,
            })
          }
        }
        if (bulkExamMode && examStageVisible()) {
          syncExamStageFromEntries(dedupeEntries(allExecutableEntries()))
          syncExamStageResolution()
        }
        renderBulkAnalysis()
      }
    }

    await resolveRows(bulkNameRows, bulkExamMode)
    if (token !== bulkAnalysisToken) return
    await resolveRows(bulkCodeRows, bulkExamMode)
    if (token !== bulkAnalysisToken) return
    if (bulkExamMode && examStageVisible()) syncExamStageResolution()
    bulkResolving = false
    renderBulkAnalysis()
  }

  function renderAfterResolveChange(): void {
    if (bulkExamMode && examStageVisible()) {
      syncExamStageFromEntries(dedupeEntries(allExecutableEntries()))
      syncExamStageResolution()
    }
    renderBulkAnalysis()
  }

  async function reResolveNameRow(key: string, nextQuery: string): Promise<void> {
    const lessonId = bulkLessonInput.value.trim() || currentLessonIdFromPage() || ''
    const rows = bulkNameRows.some((row) => row.key === key) ? bulkNameRows : bulkCodeRows
    const isExamRow = bulkExamMode
    if (!lessonId && !isExamRow) return
    const index = rows.findIndex((row) => row.key === key)
    if (index < 0) return
    const token = ++bulkAnalysisToken
    bulkArmed = false
    rows[index] = { ...rows[index], query: nextQuery.trim() || rows[index].query, status: 'loading', message: t('ui.common.searching') }
    renderBulkAnalysis()
    const payment = rows[index].payment
    const resolved = isExamRow
      ? resolveExamEntryFromPage(rows[index], rows === bulkCodeRows)
      : await resolveNameEntry(rows[index], lessonId)
    if (token !== bulkAnalysisToken) return
    rows[index] = { ...resolved, payment }
    if (payment && rows[index].status === 'resolved' && rows[index].code) {
      const code = rows[index].code!.toUpperCase()
      if (!bulkPayOverrides.has(code)) {
        bulkPayOverrides.set(code, { studentCode: code, status: payment.status, amountPaid: payment.amountPaid })
      }
    }
    renderAfterResolveChange()
  }

  /**
   * Reloads failed codes from the last run into the input and leaves the batch
   * disarmed. Submission still goes through the normal preview → arm → run path.
   */
  async function retryFailedBulk(): Promise<void> {
    if (bulkRunning || bulkResolving || !bulkSupported()) return
    const snapshot = lastBulkRun
    if (!snapshot || typeof snapshot.input !== 'string') return
    const codes = retryableCodes(snapshot)
    if (!codes.length) return

    const retryInput = codes.join('\n')
    bulkCodesInput.value = retryInput
    if (snapshot.lessonId) {
      bulkLessonInput.value = snapshot.lessonId
      bulkLessonTouched = true
    }
    applyPaymentMode(snapshot.paymentMode ?? detectPagePaymentMode())
    updateBulkInputPlaceholder()

    // analyzeBulkInput() clears + reseeds overrides, so replay stored ones after it.
    await analyzeBulkInput()
    if (bulkCodesInput.value !== retryInput) return // input edited while analyzing
    const failedSet = new Set(codes)
    bulkPayOverrides.clear()
    for (const [storedCode, override] of snapshot.overrides ?? []) {
      const code = storedCode.trim().toUpperCase()
      if (!failedSet.has(code)) continue
      bulkPayOverrides.set(code, { ...override, studentCode: code })
    }

    disarmBulk()
    renderBulkAnalysis()
    const hadTimeout = snapshot.rows.some(
      (row) => row.status === 'timeout' && failedSet.has(row.code.trim().toUpperCase()),
    )
    toast({
      title: t('ui.bulk.attendance.retryLoadedTitle'),
      description: t('ui.bulk.attendance.retryLoadedDesc', { p0: codes.length })
        + (hadTimeout ? t('ui.bulk.attendance.retryTimeoutHint') : ''),
      variant: 'info',
      duration: 8000,
    })
  }

  async function executeBulk(): Promise<void> {
    bulkRan = false
    if (bulkRunning || !bulkArmed || !bulkParsed) return
    if (!bulkSupported()) return
    if (bulkExamMode && !examTargetAllowed('exam-attendance', bulkCodesInput.value)) {
      toast({ title: t('ui.bulk.exam.title', { p0: t('ui.bulk.menu.examAttendance.title') }), description: t('ui.bulk.exam.guard'), variant: 'warning' })
      return
    }

    const scan = detectScanForm(bulkExamMode)
    if (!scan) {
      toast({ title: t('ui.bulk.attendance.executeFailedTitle'), description: t('ui.bulk.attendance.executeFailedDesc'), variant: 'error' })
      return
    }

    const targetLesson = bulkLessonInput.value.trim() || currentLessonIdFromPage() || ''
    const pageLesson = scan.lessonId ?? currentLessonIdFromPage() ?? ''
    if (targetLesson && pageLesson && String(targetLesson) !== String(pageLesson)) {
      toast({
        title: t('ui.bulk.attendance.lessonMismatchTitle'),
        description: t('ui.bulk.attendance.lessonMismatchToast', { p0: targetLesson }),
        variant: 'warning',
        duration: 7000,
      })
      return
    }

    if (unresolvedNameRows().length) {
      toast({ title: t('ui.bulk.attendance.unresolvedTitle'), description: t('ui.bulk.attendance.unresolvedDesc'), variant: 'warning' })
      return
    }

    const entries = executableEntries()
    if (!entries.length) return

    if (bulkPayMode === 'school') {
      const sendingCodes = new Set(entries.map((entry) => entry.code.toUpperCase()))
      const missingAmount = Array.from(bulkPayOverrides.values()).find(
        (o) => sendingCodes.has(o.studentCode.toUpperCase())
          && (o.status === 'partial' || o.status === 'discounted')
          && (o.amountPaid == null || Number.isNaN(o.amountPaid)),
      )
      if (missingAmount) {
        toast({
          title: t('ui.bulk.attendance.missingAmountTitle'),
          description: t('ui.bulk.attendance.missingAmountDesc', { p0: missingAmount.studentCode }),
          variant: 'warning',
        })
        return
      }
    }

    if (!undoRedo.enabled) {
      toast({ title: t('ui.menu.enableUndoTitle'), description: t('ui.bulk.attendance.enableUndoDesc'), variant: 'warning' })
      return
    }

    // Collect payment overrides for school mode
    const paymentOverrides: PaymentOverride[] = bulkPayMode === 'school'
      ? Array.from(bulkPayOverrides.values())
      : []
    const lessonId = bulkLessonInput.value.trim() || currentLessonIdFromPage() || ''

    bulkRunning = true
    bulkStop = { stop: false }
    bulkLogRows = []
    bulkDiagnosticReport = ''
    bulkDebugText.textContent = ''
    bulkDiagnostics.hidden = true
    renderBulkLog()
    disarmBulk()
    updateBulkButtons()

    undoRedo.beginBatch(t('ui.bulk.attendance.batchTitle'))
    bulkRan = true
    try {
      const summary = await runBulkAttendance({
        entries,
        signal: bulkStop,
        onRow: appendBulkRow,
        paymentMode: bulkPayMode,
        paymentOverrides,
        lessonId,
        ...(bulkExamMode ? { target: 'exam' as const } : {}),
      })

      bulkDiagnosticReport = formatBulkDiagnosticReport(summary, entries)
      bulkDebugText.textContent = bulkDiagnosticReport
      bulkDiagnostics.hidden = false
      bulkDebugCount.textContent = String(
        summary.rows.filter((row) => row.status === 'error' || row.status === 'timeout').length,
      )
      console.info('[Tamperina] bulk attendance diagnostic\n' + bulkDiagnosticReport)
      saveLastBulkRun()

      const recordedBeforeCommit = undoRedo.batchCount
      const committed = undoRedo.commitBatch({
        title: t('ui.bulk.attendance.batchTitleCount', { p0: summary.created }),
        detail: t('ui.bulk.attendance.batchDetail', { p0: summary.created, p1: summary.duplicates, p2: summary.skipped, p3: summary.failed, p4: summary.stopped ? t('ui.common.stoppedSuffix') : '' }),
      })

      if (bulkExamMode && summary.created > 0) {
        toast({
          title: t('ui.bulk.exam.title', { p0: t('ui.bulk.menu.examAttendance.title') }),
          description: t('ui.bulk.exam.attendanceWarning'),
          variant: 'warning',
          duration: 9000,
        })
      } else if (!committed && summary.created > 0) {
        toast({
          title: t('ui.bulk.attendance.noUndoTitle'),
          description: t('ui.bulk.attendance.noUndoDesc', { p0: summary.created }),
          variant: 'warning',
          duration: 9000,
        })
        console.warn('[Tamperina] bulk batch had no recorded actions', {
          created: summary.created,
          recordedBeforeCommit,
          debug: undoRedo.debug(),
        })
      } else if (summary.created > 0) {
        const breakdown = t('ui.bulk.attendance.summaryDetail', { p0: summary.created, p1: summary.duplicates, p2: summary.skipped, p3: summary.failed, p4: summary.stopped ? t('ui.common.stoppedSuffix') : '' })
        // Handoff: only rows explicitly confirmed as created are offered for copy.
        // Timed-out rows may have succeeded server-side, but are not claimed here.
        const newCodes = summary.rows
          .filter((row) => row.status === 'created')
          .map((row) => row.code)
        toast({
          title: t('ui.bulk.attendance.completedTitle'),
          description: `${breakdown} ${t('ui.bulk.attendance.ofEntries', { p0: entries.length })} ${summary.failed > 0 ? t('ui.bulk.attendance.reviewReportHint') : ''}${t('ui.common.undoBatchHint')}`,
          variant: summary.failed > 0 ? 'warning' : 'applied',
          duration: 9000,
          action: newCodes.length ? {
            label: t('ui.bulk.attendance.copyNewCodes'),
            onClick: () => { void copyPlainText(
              newCodes.join('\n'),
              t('ui.bulk.attendance.newCodesCopiedTitle'),
              t('ui.bulk.attendance.newCodesCopiedDesc', { p0: newCodes.length }),
            ) },
          } : undefined,
        })
        console.info('[Tamperina] bulk attendance summary', breakdown, {
          entries: entries.length,
          rows: summary.rows,
        })
      } else if (summary.failed > 0 || summary.duplicates > 0 || summary.skipped > 0) {
        toast({
          title: t('ui.bulk.attendance.nothingNewTitle'),
          description: t('ui.bulk.attendance.nothingNewDesc', { p0: entries.length, p1: summary.duplicates, p2: summary.skipped, p3: summary.failed, p4: summary.stopped ? t('ui.common.stoppedSuffix') : '' }),
          variant: 'warning',
          duration: 9000,
        })
      } else {
        toast({
          title: t('ui.bulk.attendance.noNewRecordsTitle'),
          description: t('ui.bulk.attendance.noNewRecordsDesc'),
          variant: 'info',
        })
      }

      renderBulkAnalysisSummary()
    } catch (error) {
      undoRedo.commitBatch({
        title: t('ui.bulk.attendance.batchTitleCount', { p0: undoRedo.batchCount }),
        detail: t('ui.bulk.attendance.errorEnded'),
      })
      toast({
        title: t('ui.common.executionErrorTitle'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'error',
      })
    } finally {
      bulkRunning = false
      bulkStop.stop = false
      renderBulkAnalysis()
    }
  }

  bulkPreviewBtn.addEventListener('click', () => {
    refreshBulkLesson()
    void analyzeBulkInput()
  })
  bulkCopyDebugBtn.addEventListener('click', () => {
    void copyPlainText(
      bulkDiagnosticReport || t('ui.bulk.attendance.noReportYet'),
      t('ui.bulk.attendance.reportCopiedTitle'),
      t('ui.bulk.attendance.reportCopiedDesc'),
    )
  })
  bulkCopyFailedBtn.addEventListener('click', () => {
    const failedCodes = bulkLogRows
      .filter((row) => row.status === 'error' || row.status === 'timeout')
      .map((row) => row.code)
    void copyPlainText(
      failedCodes.join('\n') || t('ui.bulk.attendance.noFailedCodes'),
      t('ui.bulk.attendance.failedCopiedTitle'),
      t('ui.bulk.attendance.failedCopiedDesc', { p0: failedCodes.length }),
    )
  })
  bulkCopySkippedBtn.addEventListener('click', () => {
    const skippedRows = bulkLogRows.filter(
      (row) => row.status === 'skipped-known' || row.status === 'duplicate',
    )
    const text = skippedRows.map((row) => `${row.code}${row.label ? `,${row.label}` : ''}`).join('\n')
    void copyPlainText(
      text || t('ui.bulk.attendance.noSkippedCodes'),
      t('ui.bulk.attendance.skippedCopiedTitle'),
      t('ui.bulk.attendance.skippedCopiedDesc', { p0: skippedRows.length }),
    )
  })
  bulkRetryBtn.addEventListener('click', () => { void retryFailedBulk() })
  bulkArmBtn.addEventListener('click', () => {
    if (!readyToArm()) {
      void analyzeBulkInput()
      return
    }
    bulkArmed = true
    setBulkBadge(t('ui.common.armed'), 'on')
    updateBulkButtons()
    toast({
      title: t('ui.bulk.attendance.armedTitle'),
      description: t('ui.bulk.attendance.armedDesc'),
      variant: 'warning',
    })
  })
  bulkRunBtn.addEventListener('click', () => { void executeBulk() })
  bulkStopBtn.addEventListener('click', () => {
    if (!bulkRunning) return
    bulkStop.stop = true
    setBulkBadge(t('ui.common.stopping'), 'busy')
    toast({ title: t('ui.common.willStop'), description: t('ui.bulk.attendance.stopDesc'), variant: 'warning' })
  })

  bulkCodesInput.addEventListener('input', invalidateBulkAnalysis)
  bulkLessonInput.addEventListener('input', () => { bulkLessonTouched = true; invalidateBulkAnalysis() })

  // Listen on the whole bulk panel: after preview the same editable fields
  // live in the normal review list rather than in the pre-preview stage table.
  bulkRoot.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    if (target.closest('[data-exam-stage-add]')) {
      if (!examStageVisible() || bulkRunning) return
      examStage.push(makeExamStageRow())
      refreshStageAnalysis()
      return
    }
    const button = target.closest<HTMLElement>('[data-exam-stage-remove]')
    if (!button) return
    const rowEl = button.closest<HTMLElement>('[data-exam-stage-row]')
    examStage = examStage.filter((row) => row.id !== rowEl?.dataset.examStageRow)
    markExamStageChanged()
    refreshStageAnalysis()
  })
  function examStageRowFromEvent(event: Event): ExamStageRow | null {
    const target = event.target as HTMLElement
    const rowEl = target.closest<HTMLElement>('[data-exam-stage-row]')
    return examStage.find((item) => item.id === rowEl?.dataset.examStageRow) ?? null
  }

  bulkRoot.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement
    const field = target.dataset.examStageField
    const row = examStageRowFromEvent(event)
    if (!field || !row) return
    if (field === 'enabled') {
      row.enabled = (target as HTMLInputElement).checked
      syncBulkCodesFromStage()
      refreshStageAnalysis()
      return
    } else if (field === 'code') {
      // Keep the caret in the field while typing; the change event re-renders.
      row.code = normalizeStudentCode(target.value)
      syncBulkCodesFromStage()
      markExamStageChanged()
      return
    } else if (field === 'amountPaid') row.options.amountPaid = target.value
    else if (field === 'paymentNote') row.options.paymentNote = target.value
    else return
    markExamStageChanged()
  })
  bulkRoot.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement
    const field = target.dataset.examStageField
    const row = examStageRowFromEvent(event)
    if (!field || !row) return
    if (field === 'paymentStatus') row.options.paymentStatus = target.value as ExamCheckinOptions['paymentStatus']
    else if (field === 'source') row.options.source = target.value as ExamCheckinOptions['source']
    else if (field === 'code') {
      row.code = normalizeStudentCode(target.value)
      refreshStageAnalysis()
      return
    } else return
    markExamStageChanged()
  })

  exportRefreshBtn.addEventListener('click', refreshAttendanceExport)
  exportCopyBtn.addEventListener('click', () => { void copyAttendanceExport() })
  exportDownloadBtn.addEventListener('click', downloadAttendanceExport)
  exportLessonInput.addEventListener('input', refreshAttendanceExport)

  function updateBulkInputPlaceholder(): void {
    bulkLessonInput.placeholder = bulkExamMode
      ? currentExamId() || t('ui.common.lessonPlaceholder')
      : t('ui.common.lessonPlaceholder')
    if (bulkPayMode === 'school') {
      bulkCodesInput.placeholder = t('ui.bulk.attendance.inputPlaceholderSchool')
    } else {
      bulkCodesInput.placeholder = t('ui.bulk.attendance.inputPlaceholderCenter')
    }
  }

  // ---- mode toggle ---------------------------------------------------------
  for (const btn of bulkModeBtns) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode as PaymentMode
      if (mode === bulkPayMode) return
      applyPaymentMode(mode)
      bulkArmed = false
      bulkPayOverrides.clear()
      updateBulkInputPlaceholder()
      // Preserve analysis/resolution; re-render to show/hide inline payment controls.
      if (bulkParsed) {
        renderBulkAnalysis()
      } else {
        updateBulkButtons()
      }
    })
  }

  // ---- inline payment interaction (school mode, per student item) ----------
  bulkResolveBox.addEventListener('change', (event) => {
    const target = event.target as HTMLElement
    const statusEl = target.closest<HTMLSelectElement>('[data-inline-pay-status]')
    if (statusEl) {
      const code = statusEl.dataset.inlinePayStatus!.toUpperCase()
      const newStatus = statusEl.value
      const needsAmount = newStatus === 'partial' || newStatus === 'discounted'
      if (newStatus === 'default') {
        bulkPayOverrides.delete(code)
      } else {
        const existing = bulkPayOverrides.get(code) ?? { studentCode: code, status: 'paid' as PaymentStatus }
        existing.status = newStatus as PaymentStatus
        if (!needsAmount) delete existing.amountPaid
        bulkPayOverrides.set(code, existing)
      }
      const wrap = bulkResolveBox.querySelector<HTMLElement>(`[data-inline-pay-amount-wrap="${CSS.escape(code)}"]`)
      const amountInput = bulkResolveBox.querySelector<HTMLInputElement>(`[data-inline-pay-amount="${CSS.escape(code)}"]`)
      if (wrap) wrap.hidden = !needsAmount
      if (amountInput && !needsAmount) amountInput.value = ''
      if (amountInput && needsAmount) amountInput.focus()
      bulkArmed = false
      updateBulkButtons()
      return
    }
    const amountEl = target.closest<HTMLInputElement>('[data-inline-pay-amount]')
    if (amountEl) {
      const code = amountEl.dataset.inlinePayAmount!.toUpperCase()
      const existing = bulkPayOverrides.get(code) ?? { studentCode: code, status: 'partial' }
      const val = parseFloat(amountEl.value)
      existing.amountPaid = Number.isNaN(val) ? undefined : val
      bulkPayOverrides.set(code, existing)
      bulkArmed = false
      updateBulkButtons()
    }
  })
  bulkResolveBox.addEventListener('input', (event) => {
    const walkInInput = (event.target as HTMLElement).closest<HTMLInputElement>('[data-walkin-amount-key]')
    if (walkInInput) {
      const val = Number(walkInInput.value)
      const key = walkInInput.dataset.walkinAmountKey!
      if (walkInInput.value.trim() && Number.isFinite(val)) {
        walkInAmounts.set(key, Math.min(WALKIN_MAX_AMOUNT, Math.max(0, val)))
      } else {
        walkInAmounts.delete(key)
      }
      return
    }
    const amountEl = (event.target as HTMLElement).closest<HTMLInputElement>('[data-inline-pay-amount]')
    if (!amountEl) return
    const code = amountEl.dataset.inlinePayAmount!.toUpperCase()
    const existing = bulkPayOverrides.get(code) ?? { studentCode: code, status: 'partial' }
    const val = parseFloat(amountEl.value)
    existing.amountPaid = Number.isNaN(val) ? undefined : val
    bulkPayOverrides.set(code, existing)
    bulkArmed = false
    updateBulkButtons()
  })

  bulkResolveBox.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-walkin-toggle]')) {
      walkInPreviewOpen = !walkInPreviewOpen
      renderBulkResolve()
      return
    }
    if ((event.target as Element).closest('[data-walkin-cancel]')) {
      walkInPreviewOpen = false
      renderBulkResolve()
      return
    }
    if ((event.target as Element).closest('[data-walkin-confirm]')) {
      void registerWalkInStudents()
      return
    }

    const copyBtn = (event.target as Element).closest<HTMLButtonElement>('[data-bulk-copy-undecided]')
    if (copyBtn) {
      void copyPlainText(
        copyBtn.dataset.copyText || '',
        t('ui.bulk.attendance.copiedTitle'),
        t('ui.bulk.attendance.undecidedCopiedDesc'),
      )
      return
    }

    const btn = (event.target as Element).closest<HTMLButtonElement>('[data-resolve-action]')
    if (!btn) return
    const action = btn.dataset.resolveAction

    if (action === 'drop-all') {
      let changed = false
      const dropUnresolved = (rows: NameRow[]): NameRow[] => rows.map((row) => {
        if (row.status === 'resolved' || row.status === 'dropped' || row.status === 'walk-in') return row
        changed = true
        return { ...row, status: 'dropped' as const, message: t('ui.bulk.attendance.ignoredMessage') }
      })
      bulkNameRows = dropUnresolved(bulkNameRows)
      bulkCodeRows = dropUnresolved(bulkCodeRows)
      if (changed) {
        bulkArmed = false
        renderAfterResolveChange()
      }
      return
    }

    const key = btn.dataset.key || ''
    let rows = bulkNameRows
    let index = rows.findIndex((row) => row.key === key)
    if (index < 0) {
      rows = bulkCodeRows
      index = rows.findIndex((row) => row.key === key)
    }
    if (index < 0) return

    if (action === 'choose') {
      const code = (btn.dataset.code || '').toUpperCase()
      const name = btn.dataset.name || ''
      if (!code) {
        toast({ title: t('ui.bulk.attendance.noCodeTitle'), description: t('ui.bulk.attendance.noCodeDesc'), variant: 'warning' })
        return
      }
      rows[index] = {
        ...rows[index],
        status: 'resolved',
        code,
        studentName: name,
        message: t('ui.bulk.attendance.chosenMessage', { p0: name, p1: code ? ` (${code})` : '' }),
      }
      bulkArmed = false
      renderAfterResolveChange()
      return
    }

    if (action === 'drop') {
      rows[index] = { ...rows[index], status: 'dropped', message: t('ui.bulk.attendance.ignoredMessage') }
      bulkArmed = false
      renderAfterResolveChange()
      return
    }

    if (action === 'undrop' || action === 'change') {
      const nextStatus = rows[index].candidates.length ? 'ambiguous' : 'not-found'
      rows[index] = {
        ...rows[index],
        status: nextStatus,
        code: undefined,
        studentName: undefined,
        message: undefined,
      }
      bulkArmed = false
      renderAfterResolveChange()
      return
    }

    if (action === 'research') {
      const edit = bulkResolveBox.querySelector<HTMLInputElement>(`[data-resolve-edit="${CSS.escape(key)}"]`)
      const nextQuery = edit?.value.trim() || rows[index].query
      void reResolveNameRow(key, nextQuery)
    }
  })

  // Prefill lesson and keep bulk controls in sync with undoRedo state.
  refreshBulkLesson()
  restoreLastBulkRun()
  // Auto-detect mode from the page
  applyPaymentMode(detectPagePaymentMode())
  updateBulkInputPlaceholder()
  renderBulkAnalysis()
  undoRedo.subscribe(() => {
    refreshBulkLesson()
    updateBulkButtons()
    updateEvalBulkButtons()
  })

  async function copyPlainText(text: string, title: string, description: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
      toast({ title, description, variant: 'applied' })
    } catch {
      toast({ title: t('ui.toast.copyFailedTitle'), description: t('ui.toast.copyFailedDesc'), variant: 'warning' })
    }
  }

  function exportLessonId(): string {
    return exportLessonInput.value.trim() || currentLessonIdFromPage() || undoRedo.lessonId || ''
  }

  function buildAttendanceExport(): { text: string, count: number, lesson: string, total: number } {
    const lesson = exportLessonId()
    const records = undoRedo.attendanceRecords
    const seen = new Set<string>()
    const lines: string[] = []
    for (const record of records) {
      const recordLesson = record.lessonId == null ? '' : String(record.lessonId)
      if (lesson && recordLesson && recordLesson !== lesson) continue
      const code = String(record.studentCode ?? record.username ?? '').trim().toUpperCase()
      if (!code || seen.has(code)) continue
      seen.add(code)
      const name = String(record.name ?? '').trim()
      lines.push(name ? `${code}, ${name}` : code)
    }
    lines.sort((a, b) => a.localeCompare(b, 'ar'))
    return { text: lines.join('\n'), count: lines.length, lesson, total: records.length }
  }

  function refreshAttendanceExport(): void {
    if (!exportLessonInput.value.trim()) {
      const lesson = currentLessonIdFromPage() || undoRedo.lessonId || ''
      if (lesson) exportLessonInput.value = String(lesson)
    }
    const { text, count, lesson, total } = buildAttendanceExport()
    exportTextarea.value = text
    exportCount.textContent = t('ui.bulk.export.count', { p0: count })
    exportCount.classList.toggle('off', count === 0)
    exportCount.classList.toggle('on', count > 0)
    exportSummary.textContent = lesson ? t('ui.bulk.export.summaryWithLesson', { p0: lesson, p1: total }) : t('ui.bulk.export.summaryNoLesson', { p0: total })
  }

  async function copyAttendanceExport(): Promise<void> {
    const text = exportTextarea.value.trim()
    if (!text) {
      toast({ title: t('ui.bulk.export.noListTitle'), description: t('ui.bulk.export.noListDesc'), variant: 'warning' })
      return
    }
    await copyPlainText(text, t('ui.bulk.attendance.copiedTitle'), t('ui.bulk.export.copiedDesc'))
  }

  function downloadAttendanceExport(): void {
    const text = exportTextarea.value.trim()
    if (!text) {
      toast({ title: t('ui.bulk.export.noListTitle'), description: t('ui.bulk.export.noListDesc'), variant: 'warning' })
      return
    }
    const lesson = exportLessonId() || 'all'
    const filename = `attendance-ids-${lesson}-${new Date().toISOString().slice(0, 10)}.txt`
    try {
      // BOM keeps Arabic names readable when the file is opened in Windows Notepad.
      const blob = new Blob(['\uFEFF', text, '\n'], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast({ title: t('ui.bulk.export.downloadedTitle'), description: filename, variant: 'applied' })
    } catch {
      toast({ title: t('ui.bulk.export.downloadFailedTitle'), description: t('ui.bulk.export.copyFailedDesc'), variant: 'warning' })
    }
  }

  // ---- bulk evaluation -----------------------------------------------------
  const evalRoot = backdrop.querySelector<HTMLElement>('[data-eval-bulk-root]')!
  const evalInput = evalRoot.querySelector<HTMLTextAreaElement>('[data-eval-input]')!
  const evalPreviewBtn = evalRoot.querySelector<HTMLButtonElement>('[data-eval-preview]')!
  const evalArmBtn = evalRoot.querySelector<HTMLButtonElement>('[data-eval-arm]')!
  const evalRunBtn = evalRoot.querySelector<HTMLButtonElement>('[data-eval-run]')!
  const evalStopBtn = evalRoot.querySelector<HTMLButtonElement>('[data-eval-stop]')!
  const evalPreviewBox = evalRoot.querySelector<HTMLElement>('[data-eval-preview-box]')!
  const evalResolveBox = evalRoot.querySelector<HTMLElement>('[data-eval-resolve]')!
  const evalLog = evalRoot.querySelector<HTMLElement>('[data-eval-log]')!
  const evalLogCount = evalRoot.querySelector<HTMLElement>('[data-eval-log-count]')!
  const evalCopyResultsBtn = evalRoot.querySelector<HTMLButtonElement>('[data-eval-copy-results]')!
  const evalBadge = evalRoot.querySelector<HTMLElement>('[data-eval-badge]')!

  type EvalNumberMap = 'exam-homework' | 'homework-exam'
  interface EvalWorkRow {
    key: string
    raw: string
    identifier: string
    query: string
    values: EvalValues
    ambiguousNumbers: boolean
    numberTokens?: [string, string]
    numberMap?: EvalNumberMap
    identityStatus: EvalResolveStatus
    code?: string
    studentName?: string
    candidates: { code: string; name: string }[]
    message?: string
  }

  let evalExamMode = false
  let evalRan = false
  let evalParsed: ParseEvalResult | null = null
  let evalRows: EvalWorkRow[] = []
  let evalArmed = false
  let evalRunning = false
  let evalStop = { stop: false }
  let evalLogRows: EvalRowResult[] = []
  let evalAnalysisToken = 0

  function evalSupported(): boolean {
    return isEvaluationPage() || (evalExamMode && isExamPage())
  }

  function setEvalBadge(text: string, className: string): void {
    evalBadge.textContent = text
    evalBadge.className = `feature-badge ${className}`
  }

  function evalEffectiveValues(row: EvalWorkRow): EvalValues | null {
    if (row.ambiguousNumbers) {
      if (!row.numberMap || !row.numberTokens) return null
      const [a, b] = row.numberTokens
      return row.numberMap === 'exam-homework' ? { exam: a, homework: b } : { homework: a, exam: b }
    }
    return row.values
  }

  function evalRowReady(row: EvalWorkRow): boolean {
    if (row.identityStatus === 'dropped') return false
    if (!(row.identityStatus === 'ready' || row.identityStatus === 'resolved')) return false
    if (!row.code) return false
    if (row.ambiguousNumbers && !row.numberMap) return false
    const v = evalEffectiveValues(row)
    return !!(v && (v.exam != null || v.homework != null))
  }

  function evalNeedsDecision(row: EvalWorkRow): boolean {
    if (row.identityStatus === 'dropped') return false
    if (row.ambiguousNumbers && !row.numberMap) return true
    return !['ready', 'resolved', 'dropped'].includes(row.identityStatus)
  }

  function evalExecutableRows(): EvalWorkRow[] {
    const seen = new Set<string>()
    return evalRows.filter((row) => {
      if (!evalRowReady(row)) return false
      const code = (row.code || '').toUpperCase()
      if (!code || seen.has(code)) return false
      seen.add(code)
      return true
    })
  }

  /** Re-check resolved rows too: the raw textarea alone cannot stop a rematch. */
  function examEvalRowsAllowed(): boolean {
    if (!evalExamMode) return true
    return examEvalCodesAllowed(evalExecutableRows().map((row) => row.code ?? ''))
  }

  function evalStatusLabel(status: EvalRowStatus): string {
    const labels: Record<EvalRowStatus, string> = {
      applied: t('ui.bulk.eval.logStatusApplied'),
      partial: t('ui.bulk.eval.logStatusPartial'),
      'not-found': t('ui.bulk.eval.logStatusNotFound'),
      'missing-field': t('ui.bulk.eval.logStatusMissingField'),
      invalid: t('ui.bulk.eval.logStatusInvalid'),
      error: t('ui.common.error'),
      stopped: t('ui.common.stopped'),
      skipped: t('ui.bulk.eval.logStatusSkipped'),
    }
    return labels[status]
  }

  /** Compact, translatable summary shared by the log action and the completion toast. */
  function formatEvalResultSummary(rows: EvalRowResult[]): string {
    let applied = 0
    let partial = 0
    let skipped = 0
    let failed = 0
    let stopped = false
    for (const row of rows) {
      if (row.status === 'applied') applied++
      else if (row.status === 'partial') partial++
      else if (row.status === 'skipped') skipped++
      else if (row.status === 'stopped') stopped = true
      else failed++
    }
    const detail = t('ui.bulk.eval.detail', { p0: applied, p1: partial, p2: failed, p3: skipped })
    return `${detail}${stopped ? t('ui.common.stoppedSuffix') : ''}`
  }

  function renderEvalLog(): void {
    evalLogCount.textContent = String(evalLogRows.length)
    if (!evalLogRows.length) {
      evalLog.innerHTML = `<div class="history-empty">${t('ui.common.logEmpty')}</div>`
      return
    }
    evalLog.innerHTML = evalLogRows.slice().reverse().map((row) => {
      const cls = row.status === 'applied' ? 'ok'
        : row.status === 'partial' ? 'warn'
        : row.status === 'stopped' || row.status === 'skipped' ? 'warn'
        : 'err'
      const msg = row.message ? ` — ${escapeHtml(row.message)}` : ''
      return `<div class="bulk-log-item ${cls}">
        <span class="bulk-log-code" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span>
        <span class="bulk-log-status">${evalStatusLabel(row.status)}${msg}</span>
        <span class="bulk-log-time">${formatTime(row.at)}</span>
      </div>`
    }).join('')
  }

  function appendEvalLog(row: EvalRowResult): void {
    evalLogRows.push(row)
    renderEvalLog()
  }

  function evalReadyToArm(): boolean {
    if (!evalParsed) return false
    if (evalExamMode && (!examTargetAllowed('exam-evaluation', evalInput.value) || !examEvalRowsAllowed())) return false
    if (evalRunning) return false
    if (!evalExecutableRows().length) return false
    if (evalRows.some((row) => evalNeedsDecision(row))) return false
    return true
  }

  function formatEvalValues(values: EvalValues | null): string {
    if (!values) return '—'
    const parts: string[] = []
    if (values.exam != null) parts.push(t('ui.bulk.eval.examValue', { p0: values.exam }))
    if (values.homework != null) parts.push(t('ui.bulk.eval.homeworkValue', { p0: values.homework }))
    return parts.join(' · ') || '—'
  }

  function renderEvalResolve(): void {
    if (!evalRows.length) {
      evalResolveBox.hidden = true
      evalResolveBox.innerHTML = ''
      return
    }

    const undecided = evalRows.filter((row) => evalNeedsDecision(row))
    const dropped = evalRows.filter((row) => row.identityStatus === 'dropped')
    const resolvedOk = evalRows.filter((row) => (row.identityStatus === 'ready' || row.identityStatus === 'resolved') && !(row.ambiguousNumbers && !row.numberMap))

    const renderRow = (row: EvalWorkRow): string => {
      const eff = evalEffectiveValues(row)
      const identityOk = row.identityStatus === 'ready' || row.identityStatus === 'resolved'
      const statusText = row.identityStatus === 'dropped' ? t('ui.common.dropped')
        : row.ambiguousNumbers && !row.numberMap ? t('ui.bulk.eval.numberOrderQuestion')
        : identityOk
          ? `${formatEvalLabel(row.code, row.studentName, row.identifier)} — ${formatEvalValues(eff)}`
          : row.identityStatus === 'ambiguous' ? t('ui.bulk.eval.ambiguousIdentity')
          : row.identityStatus === 'not-found' ? t('ui.bulk.eval.studentNotFound')
          : row.identityStatus === 'too-many' ? t('ui.common.tooMany')
          : row.identityStatus === 'error' ? t('ui.bulk.eval.analysisFailed')
          : row.message || t('ui.bulk.eval.needsDecision')

      const badgeCls = identityOk && !(row.ambiguousNumbers && !row.numberMap) ? 'on'
        : row.identityStatus === 'dropped' ? 'off'
        : 'busy'

      let choicesHtml = ''
      if (row.identityStatus !== 'dropped' && row.candidates.length) {
        const list = row.candidates.slice(0, 12)
        choicesHtml = `<div class="bulk-resolve-choices">${list.map((c) => {
          const chosen = identityOk && row.code && c.code === row.code
          return `<button type="button" class="bulk-choice ${chosen ? 'selected' : ''}" ${evalExamMode ? 'disabled' : ''}
            data-eval-action="choose" data-key="${escapeHtml(row.key)}"
            data-code="${escapeHtml(c.code)}" data-name="${escapeHtml(c.name)}">
            <span>${escapeHtml(c.name || t('ui.common.student'))}</span>
            <small dir="ltr">${escapeHtml(c.code || t('ui.common.noCode'))}</small>
          </button>`
        }).join('')}${row.candidates.length > 12 ? `<div class="bulk-note-inline">${t('ui.common.moreResults', { p0: row.candidates.length - 12 })}</div>` : ''}</div>`
      }

      let numberChoiceHtml = ''
      if (row.ambiguousNumbers && row.numberTokens) {
        const [a, b] = row.numberTokens
        numberChoiceHtml = `<div class="bulk-note-inline">${t('ui.bulk.eval.numberOrderPrompt', { p0: escapeHtml(a), p1: escapeHtml(b) })}</div>
          <div class="bulk-resolve-actions">
            <button type="button" class="bulk-mini-btn ${row.numberMap === 'exam-homework' ? 'active' : ''}" data-eval-action="map" data-key="${escapeHtml(row.key)}" data-map="exam-homework">${t('ui.bulk.eval.firstExam', { p0: escapeHtml(a), p1: escapeHtml(b) })}</button>
            <button type="button" class="bulk-mini-btn ${row.numberMap === 'homework-exam' ? 'active' : ''}" data-eval-action="map" data-key="${escapeHtml(row.key)}" data-map="homework-exam">${t('ui.bulk.eval.firstHomework', { p0: escapeHtml(a), p1: escapeHtml(b) })}</button>
          </div>`
      }

      const showEdit = row.identityStatus !== 'dropped' && !evalExamMode
      const editHtml = showEdit ? `<div class="bulk-inline-edit" ${(identityOk && !(row.ambiguousNumbers && !row.numberMap)) ? 'hidden' : ''}>
          <input type="text" class="bulk-input" data-eval-edit="${escapeHtml(row.key)}" value="${escapeHtml(row.query)}" placeholder="${t('ui.bulk.eval.editPlaceholder')}" />
          <button type="button" class="bulk-mini-btn" data-eval-action="rematch" data-key="${escapeHtml(row.key)}">${t('ui.bulk.eval.rematch')}</button>
        </div>` : ''

      const actions = row.identityStatus === 'dropped'
        ? `<div class="bulk-resolve-actions"><button type="button" class="bulk-mini-btn" data-eval-action="undrop" data-key="${escapeHtml(row.key)}">${t('ui.common.restore')}</button></div>`
        : `<div class="bulk-resolve-actions">
            ${identityOk && !evalExamMode ? `<button type="button" class="bulk-mini-btn" data-eval-action="change" data-key="${escapeHtml(row.key)}">${t('ui.bulk.eval.changeStudent')}</button>` : ''}
            <button type="button" class="bulk-mini-btn" data-eval-action="drop" data-key="${escapeHtml(row.key)}">${t('ui.common.drop')}</button>
          </div>`

      const reason = row.message && !identityOk ? `<div class="bulk-resolve-reason">${escapeHtml(row.message)}</div>` : ''
      const valuesNote = (identityOk && eff) ? `<div class="bulk-note-inline">${t('ui.bulk.eval.valuesNote', { p0: escapeHtml(formatEvalValues(eff)) })}</div>` : ''

      return `<div class="bulk-resolve-item ${badgeCls === 'on' ? 'ok' : row.identityStatus === 'dropped' ? 'drop' : ''}" data-eval-key="${escapeHtml(row.key)}">
        <div class="bulk-resolve-head">
          <span class="bulk-resolve-name">${escapeHtml(row.raw)}</span>
          <span class="feature-badge ${badgeCls}">${escapeHtml(statusText)}</span>
        </div>
        ${reason}
        ${numberChoiceHtml}
        ${choicesHtml}
        ${editHtml}
        ${actions}
        ${valuesNote}
      </div>`
    }

    let html = ''
    if (undecided.length) {
      html += `<div class="bulk-undecided-section">
        <div class="bulk-undecided-head">
          <div class="bulk-undecided-title">
            <strong>${t('ui.bulk.eval.decisionTitle')}</strong>
            <span class="feature-badge busy">${undecided.length}</span>
          </div>
          <div class="bulk-resolve-actions">
            <button type="button" class="bulk-mini-btn" data-eval-action="drop-all-unresolved">${t('ui.bulk.eval.dropUnresolved')}</button>
          </div>
        </div>
        <div class="bulk-note-inline">${t('ui.bulk.eval.decisionNote')}</div>
        ${undecided.map(renderRow).join('')}
      </div>`
    }
    if (resolvedOk.length) {
      html += `<div class="bulk-resolve-group">${resolvedOk.map(renderRow).join('')}</div>`
    }
    if (dropped.length) {
      html += `<div class="bulk-resolve-group">${dropped.map(renderRow).join('')}</div>`
    }

    evalResolveBox.hidden = false
    evalResolveBox.innerHTML = html
  }

  function renderEvalAnalysis(): void {
    if (!evalParsed) {
      evalPreviewBox.textContent = t('ui.common.previewEmpty')
      evalResolveBox.hidden = true
      evalResolveBox.innerHTML = ''
      updateEvalBulkButtons()
      return
    }
    if (!evalSupported()) {
      evalPreviewBox.innerHTML = `<div class="bulk-warn">${t('ui.bulk.eval.openEvalPage')}</div>`
      renderEvalResolve()
      updateEvalBulkButtons()
      return
    }

    const exec = evalExecutableRows()
    const needs = evalRows.filter((row) => evalNeedsDecision(row)).length
    const dropped = evalRows.filter((row) => row.identityStatus === 'dropped').length
    const numbersAmb = evalRows.filter((row) => row.ambiguousNumbers && !row.numberMap).length
    const parts: string[] = []
    parts.push(`<div class="bulk-preview-grid">
      <div><strong>${t('ui.bulk.eval.summaryValid')}</strong><span>${evalParsed.entries.length}</span></div>
      <div><strong>${t('ui.bulk.eval.summaryReady')}</strong><span>${exec.length}</span></div>
      <div><strong>${t('ui.bulk.eval.summaryNeeds')}</strong><span>${needs}</span></div>
      <div><strong>${t('ui.bulk.eval.summaryAmbiguous')}</strong><span>${numbersAmb}</span></div>
      <div><strong>${t('ui.bulk.eval.summaryDropped')}</strong><span>${dropped}</span></div>
      <div><strong>${t('ui.bulk.attendance.invalid')}</strong><span>${evalParsed.invalid.length}</span></div>
      <div><strong>${t('ui.bulk.attendance.duplicates')}</strong><span>${evalParsed.duplicates.length}</span></div>
    </div>`)
    if (!evalParsed.entries.length) parts.push(`<div class="bulk-warn">${t('ui.bulk.eval.noValidLines')}</div>`)
    if (evalParsed.invalid.length) parts.push(`<div class="bulk-warn">${t('ui.bulk.eval.invalidLines', { p0: evalParsed.invalid.slice(0, 8).map(escapeHtml).join(listSeparator()), p1: evalParsed.invalid.length > 8 ? '…' : '' })}</div>`)
    if (numbersAmb) parts.push(`<div class="bulk-warn">${t('ui.bulk.eval.ambiguousNumbersWarning', { p0: numbersAmb })}</div>`)
    if (needs) parts.push(`<div class="bulk-warn">${t('ui.bulk.eval.needsDecisionWarning', { p0: needs })}</div>`)
    if (!undoRedo.enabled) parts.push(`<div class="bulk-warn">${t('ui.bulk.eval.undoDisabledWarning')}</div>`)
    if (!exec.length && evalParsed.entries.length) parts.push(`<div class="bulk-warn">${t('ui.bulk.eval.noReadyItems')}</div>`)
    parts.push(`<div class="bulk-note-inline">${t('ui.bulk.eval.matchingNote')}</div>`)
    evalPreviewBox.innerHTML = parts.join('')
    renderEvalResolve()
    updateEvalBulkButtons()
  }

  function updateEvalBulkButtons(): void {
    if (!evalBadge) return
    const supported = evalSupported()
    evalPreviewBtn.disabled = !supported || evalRunning
    evalArmBtn.disabled = !supported || evalRunning || !evalReadyToArm()
    evalRunBtn.disabled = !supported || evalRunning || !evalArmed || !evalReadyToArm() || !undoRedo.enabled
    evalStopBtn.disabled = !evalRunning

    if (!supported) setEvalBadge(t('ui.bulk.eval.notOnPage'), 'off')
    else if (evalRunning) setEvalBadge(t('ui.common.running'), 'busy')
    else if (evalArmed) setEvalBadge(t('ui.common.armed'), 'on')
    else if (evalRows.some((row) => evalNeedsDecision(row))) setEvalBadge(t('ui.common.needsDecision'), 'busy')
    else setEvalBadge(t('ui.common.ready'), 'off')
  }

  function analyzeEvaluationBulk(): void {
    if (evalExamMode && !examTargetAllowed('exam-evaluation', evalInput.value)) {
      evalAnalysisToken++
      evalParsed = null
      evalRows = []
      evalArmed = false
      evalPreviewBox.innerHTML = `<div class="bulk-warn">${t('ui.bulk.exam.guard')}</div>`
      evalResolveBox.hidden = true
      evalResolveBox.innerHTML = ''
      renderEvalLog()
      updateEvalBulkButtons()
      return
    }

    evalAnalysisToken++
    evalParsed = parseEvaluationEntries(evalInput.value)
    evalRows = evalParsed.entries.map((entry) => {
      const m = matchIdentifier(entry.identifier)
      return {
        key: entry.key,
        raw: entry.raw,
        identifier: entry.identifier,
        query: entry.identifier,
        values: entry.values,
        ambiguousNumbers: entry.ambiguousNumbers,
        numberTokens: entry.numberTokens,
        numberMap: undefined,
        identityStatus: m.status,
        code: m.code,
        studentName: m.studentName,
        candidates: m.candidates,
        message: m.message,
      }
    })
    evalArmed = false
    evalLogRows = []
    renderEvalLog()
    renderEvalAnalysis()
  }

  function invalidateEvalBulk(): void {
    if (evalRunning) return
    evalAnalysisToken++
    evalParsed = null
    evalRows = []
    evalArmed = false
    evalPreviewBox.textContent = t('ui.common.dataEdited')
    evalResolveBox.hidden = true
    evalResolveBox.innerHTML = ''
    updateEvalBulkButtons()
  }

  function rematchEvalRow(key: string, nextQuery: string): void {
    const index = evalRows.findIndex((row) => row.key === key)
    if (index < 0) return
    const row = evalRows[index]
    const query = nextQuery.trim() || row.query
    const m = matchIdentifier(query)
    evalRows[index] = {
      ...row,
      query,
      identityStatus: m.status,
      code: m.code,
      studentName: m.studentName,
      candidates: m.candidates,
      message: m.message,
    }
    evalArmed = false
    renderEvalAnalysis()
  }

  async function executeEvaluationBulk(): Promise<void> {
    evalRan = false
    if (evalRunning || !evalArmed || !evalParsed) return
    if (evalExamMode && (!examTargetAllowed('exam-evaluation', evalInput.value) || !examEvalRowsAllowed())) {
      toast({ title: t('ui.bulk.exam.title', { p0: t('ui.bulk.menu.examEvaluation.title') }), description: t('ui.bulk.exam.guard'), variant: 'warning' })
      return
    }
    if (!evalSupported()) {
      toast({ title: t('ui.bulk.eval.notOnPage'), description: t('ui.bulk.eval.openPageToast'), variant: 'warning' })
      return
    }
    if (evalRows.some((row) => evalNeedsDecision(row))) {
      toast({ title: t('ui.bulk.eval.unresolvedToastTitle'), description: t('ui.bulk.eval.unresolvedToastDesc'), variant: 'warning' })
      return
    }
    const entries = evalExecutableRows()
    if (!entries.length) return
    if (!undoRedo.enabled) {
      toast({ title: t('ui.menu.enableUndoTitle'), description: t('ui.bulk.eval.enableUndoDesc'), variant: 'warning' })
      return
    }

    evalRunning = true
    evalStop = { stop: false }
    evalLogRows = []
    renderEvalLog()
    evalArmed = false
    updateEvalBulkButtons()

    undoRedo.beginBatch(t('ui.bulk.eval.batchTitle'))
    evalRan = true
    let applied = 0
    let partial = 0

    try {
      for (const item of entries) {
        if (evalStop.stop) {
          appendEvalLog({ key: item.key, label: formatEvalLabel(item.code, item.studentName, item.identifier), status: 'stopped', message: t('ui.bulk.eval.stoppedMessage'), at: Date.now() })
          break
        }
        const values = evalEffectiveValues(item)
        const label = formatEvalLabel(item.code, item.studentName, item.identifier)
        if (!item.code || !values) {
          appendEvalLog({ key: item.key, label, status: 'skipped', message: t('ui.bulk.eval.incompleteData'), at: Date.now() })
          continue
        }
        const row = findRowForCode(item.code)
        if (!row) {
          appendEvalLog({ key: item.key, label, status: 'not-found', message: t('ui.bulk.eval.rowNotFound'), at: Date.now() })
          continue
        }
        try {
          const res = await applyEvaluationToRow(row, values)
          const at = Date.now()
          if (res.status === 'applied') applied++
          else if (res.status === 'partial') partial++
          appendEvalLog({ key: item.key, label, status: res.status, message: res.message, at })
          // allow page to react/save between rows (best-effort)
          await new Promise((r) => window.setTimeout(r, 120))
        } catch (err) {
          appendEvalLog({ key: item.key, label, status: 'error', message: err instanceof Error ? err.message : String(err), at: Date.now() })
        }
      }

      const detail = formatEvalResultSummary(evalLogRows)
      const committed = undoRedo.commitBatch({
        title: t('ui.bulk.eval.batchTitleCount', { p0: applied + partial }),
        detail,
      })

      if ((applied + partial) > 0 && !committed) {
        toast({
          title: t('ui.bulk.attendance.noUndoTitle'),
          description: t('ui.bulk.eval.noUndoDesc'),
          variant: 'warning',
          duration: 8000,
        })
      } else if (applied + partial > 0) {
        const resultRows = evalLogRows.slice()
        toast({
          title: t('ui.bulk.eval.completedTitle'),
          description: `${detail}${t('ui.common.undoBatchSuffix')}`,
          variant: 'applied',
          duration: 7000,
          action: resultRows.length ? {
            label: t('ui.bulk.eval.copyResults'),
            onClick: () => { void copyPlainText(
              formatEvalResultSummary(resultRows),
              t('ui.bulk.eval.resultsCopiedTitle'),
              t('ui.bulk.eval.resultsCopiedDesc'),
            ) },
          } : undefined,
        })
      } else {
        toast({ title: t('ui.bulk.eval.noChangesTitle'), description: detail, variant: 'info' })
      }
    } catch (error) {
      undoRedo.commitBatch({ title: t('ui.bulk.eval.batchTitleCount', { p0: undoRedo.batchCount }), detail: t('ui.bulk.attendance.errorEnded') })
      toast({ title: t('ui.common.executionErrorTitle'), description: error instanceof Error ? error.message : String(error), variant: 'error' })
    } finally {
      evalRunning = false
      evalStop.stop = false
      renderEvalAnalysis()
    }
  }

  evalPreviewBtn.addEventListener('click', analyzeEvaluationBulk)
  evalCopyResultsBtn.addEventListener('click', () => {
    void copyPlainText(
      evalLogRows.length ? formatEvalResultSummary(evalLogRows) : t('ui.common.logEmpty'),
      t('ui.bulk.eval.resultsCopiedTitle'),
      t('ui.bulk.eval.resultsCopiedDesc'),
    )
  })
  evalArmBtn.addEventListener('click', () => {
    if (!evalReadyToArm()) { analyzeEvaluationBulk(); return }
    evalArmed = true
    setEvalBadge(t('ui.common.armed'), 'on')
    updateEvalBulkButtons()
    toast({ title: t('ui.bulk.attendance.armedTitle'), description: t('ui.bulk.eval.armedDesc'), variant: 'warning' })
  })
  evalRunBtn.addEventListener('click', () => { void executeEvaluationBulk() })
  evalStopBtn.addEventListener('click', () => {
    if (!evalRunning) return
    evalStop.stop = true
    setEvalBadge(t('ui.common.stopping'), 'busy')
    toast({ title: t('ui.common.willStop'), description: t('ui.bulk.attendance.stopDesc'), variant: 'warning' })
  })
  evalInput.addEventListener('input', invalidateEvalBulk)

  evalResolveBox.addEventListener('click', (event) => {
    const btn = (event.target as Element).closest<HTMLButtonElement>('[data-eval-action]')
    if (!btn) return
    const action = btn.dataset.evalAction
    const key = btn.dataset.key || ''

    if (action === 'drop-all-unresolved') {
      let changed = false
      evalRows = evalRows.map((row) => {
        if (!evalNeedsDecision(row) || row.identityStatus === 'dropped') return row
        changed = true
        return { ...row, identityStatus: 'dropped' as const, message: t('ui.common.dropped') }
      })
      if (changed) { evalArmed = false; renderEvalAnalysis() }
      return
    }

    const index = evalRows.findIndex((row) => row.key === key)
    if (index < 0) return

    if (action === 'choose') {
      const code = (btn.dataset.code || '').toUpperCase()
      const name = btn.dataset.name || ''
      if (!code) {
        toast({ title: t('ui.bulk.attendance.noCodeTitle'), description: t('ui.bulk.attendance.noCodeDesc'), variant: 'warning' })
        return
      }
      evalRows[index] = { ...evalRows[index], identityStatus: 'resolved', code, studentName: name, message: t('ui.bulk.eval.chosenMessage', { p0: name }) }
      evalArmed = false
      renderEvalAnalysis()
      return
    }
    if (action === 'map') {
      const map = btn.dataset.map as EvalNumberMap | undefined
      if (map === 'exam-homework' || map === 'homework-exam') {
        evalRows[index] = { ...evalRows[index], numberMap: map }
        evalArmed = false
        renderEvalAnalysis()
      }
      return
    }
    if (action === 'drop') {
      evalRows[index] = { ...evalRows[index], identityStatus: 'dropped', message: t('ui.common.dropped') }
      evalArmed = false
      renderEvalAnalysis()
      return
    }
    if (action === 'undrop' || action === 'change') {
      const row = evalRows[index]
      const m = matchIdentifier(row.query || row.identifier)
      evalRows[index] = { ...row, identityStatus: m.status, code: m.code, studentName: m.studentName, candidates: m.candidates, message: m.message }
      evalArmed = false
      renderEvalAnalysis()
      return
    }
    if (action === 'rematch') {
      const edit = evalResolveBox.querySelector<HTMLInputElement>(`[data-eval-edit="${CSS.escape(key)}"]`)
      const nextQuery = edit?.value.trim() || evalRows[index].query
      rematchEvalRow(key, nextQuery)
    }
  })

  updateEvalBulkButtons()

  // ---- bulk attendance removal --------------------------------------------
  const removeRoot = backdrop.querySelector<HTMLElement>('[data-remove-root]')!
  const removeLessonInput = removeRoot.querySelector<HTMLInputElement>('[data-remove-lesson]')!
  const removeSummary = removeRoot.querySelector<HTMLElement>('[data-remove-summary]')!
  const removePreview = removeRoot.querySelector<HTMLElement>('[data-remove-preview]')!
  const removeBadge = removeRoot.querySelector<HTMLElement>('[data-remove-badge]')!
  const removeRefreshBtn = removeRoot.querySelector<HTMLButtonElement>('[data-remove-refresh]')!
  const removeArmBtn = removeRoot.querySelector<HTMLButtonElement>('[data-remove-arm]')!
  const removeRunBtn = removeRoot.querySelector<HTMLButtonElement>('[data-remove-run]')!
  const removeStopBtn = removeRoot.querySelector<HTMLButtonElement>('[data-remove-stop]')!
  const removeLog = removeRoot.querySelector<HTMLElement>('[data-remove-log]')!
  const removeLogCount = removeRoot.querySelector<HTMLElement>('[data-remove-log-count]')!

  type RemoveLogStatus = 'removed' | 'error' | 'stopped'
  interface RemoveLogRow {
    label: string
    status: RemoveLogStatus
    message?: string
    at: number
  }

  let removeRecords: LiveRecord[] = []
  let removeArmed = false
  let removeRunning = false
  let removeStop = { stop: false }
  let removeLogRows: RemoveLogRow[] = []

  function removeSupported(): boolean {
    return isAttendancePage()
  }

  function setRemoveBadge(text: string, className: string): void {
    removeBadge.textContent = text
    removeBadge.className = `feature-badge ${className}`
  }

  function removeLessonId(): string {
    return removeLessonInput.value.trim() || currentLessonIdFromPage() || undoRedo.lessonId || ''
  }

  function removeRecordLabel(record: LiveRecord): string {
    const code = String(record.studentCode ?? record.username ?? '').trim()
    const name = String(record.name ?? '').trim()
    return name && code ? `${name} (${code})` : name || code || t('ui.bulk.remove.recordFallback', { p0: record.id })
  }

  function renderRemoveLog(): void {
    removeLogCount.textContent = String(removeLogRows.length)
    if (!removeLogRows.length) {
      removeLog.innerHTML = `<div class="history-empty">${t('ui.common.logEmpty')}</div>`
      return
    }
    const statusLabel: Record<RemoveLogStatus, string> = {
      removed: t('ui.bulk.remove.logStatusRemoved'),
      error: t('ui.common.error'),
      stopped: t('ui.common.stopped'),
    }
    removeLog.innerHTML = removeLogRows.slice().reverse().map((row) => {
      const cls = row.status === 'removed' ? 'ok' : row.status === 'stopped' ? 'warn' : 'err'
      const msg = row.message ? ` — ${escapeHtml(row.message)}` : ''
      return `<div class="bulk-log-item ${cls}">
        <span class="bulk-log-code" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span>
        <span class="bulk-log-status">${statusLabel[row.status]}${msg}</span>
        <span class="bulk-log-time">${formatTime(row.at)}</span>
      </div>`
    }).join('')
  }

  function appendRemoveLog(row: RemoveLogRow): void {
    removeLogRows.push(row)
    renderRemoveLog()
  }

  function renderRemovePreview(): void {
    const lesson = removeLessonId()
    if (!removeSupported()) {
      removeSummary.textContent = '—'
      removePreview.innerHTML = `<div class="bulk-warn">${t('ui.bulk.attendance.openScanPage')}</div>`
      return
    }
    if (!removeRecords.length) {
      removeSummary.textContent = lesson ? t('ui.bulk.remove.summaryWithLesson', { p0: lesson, p1: 0 }) : t('ui.bulk.remove.summaryNoLesson', { p0: 0 })
      removePreview.textContent = t('ui.bulk.remove.noRecordsPreview')
      return
    }
    const lines = removeRecords.slice(0, 20).map((record) => `<div class="bulk-remove-name">${escapeHtml(removeRecordLabel(record))}</div>`).join('')
    const more = removeRecords.length > 20 ? `<div class="bulk-note-inline">${t('ui.bulk.remove.moreRecords', { p0: removeRecords.length - 20 })}</div>` : ''
    removeSummary.textContent = t('ui.bulk.remove.summaryWithLesson', { p0: lesson || '?', p1: removeRecords.length })
    removePreview.innerHTML = `<strong>${t('ui.bulk.remove.recordsToDelete', { p0: removeRecords.length })}</strong>${lines}${more}`
  }

  function updateRemoveButtons(): void {
    const supported = removeSupported()
    const hasRecords = removeRecords.length > 0
    removeRefreshBtn.disabled = !supported || removeRunning
    removeArmBtn.disabled = !supported || removeRunning || removeArmed || !hasRecords
    removeRunBtn.disabled = !supported || removeRunning || !removeArmed || !hasRecords || !undoRedo.enabled
    removeStopBtn.disabled = !removeRunning

    if (!supported) setRemoveBadge(t('ui.bulk.attendance.notOnPage'), 'off')
    else if (removeRunning) setRemoveBadge(t('ui.bulk.remove.deleting'), 'busy')
    else if (removeArmed) setRemoveBadge(t('ui.common.armed'), 'on')
    else if (hasRecords) setRemoveBadge(t('ui.common.ready'), 'off')
    else setRemoveBadge(t('ui.bulk.remove.noRecordsBadge'), 'off')
  }

  async function refreshRemoveRecords(quiet = false): Promise<void> {
    if (removeRunning) return
    if (!removeSupported()) {
      removeRecords = []
      removeArmed = false
      renderRemovePreview()
      updateRemoveButtons()
      toast({ title: t('ui.bulk.attendance.notOnPage'), description: t('ui.bulk.remove.noPageDesc'), variant: 'warning' })
      return
    }
    const lesson = removeLessonId()
    if (!lesson) {
      toast({ title: t('ui.bulk.remove.lessonRequiredTitle'), description: t('ui.bulk.remove.lessonRequiredDesc'), variant: 'warning' })
      return
    }
    if (!removeLessonInput.value.trim()) removeLessonInput.value = lesson
    setRemoveBadge(t('ui.bulk.remove.loading'), 'busy')
    removeRefreshBtn.disabled = true
    try {
      removeRecords = await undoRedo.refreshAttendanceLesson(lesson)
      removeArmed = false
      renderRemovePreview()
      if (!quiet) {
        toast({
          title: t('ui.bulk.remove.refreshedTitle'),
          description: t('ui.bulk.remove.refreshedDesc', { p0: removeRecords.length, p1: lesson }),
          variant: 'info',
        })
      }
    } catch (error) {
      removeRecords = []
      removeArmed = false
      renderRemovePreview()
      toast({
        title: t('ui.bulk.remove.loadFailedTitle'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'error',
      })
    } finally {
      updateRemoveButtons()
    }
  }

  async function executeRemoveAll(): Promise<void> {
    if (removeRunning || !removeArmed || !removeRecords.length) return
    if (!removeSupported()) {
      toast({ title: t('ui.bulk.attendance.notOnPage'), description: t('ui.bulk.remove.noPageDesc'), variant: 'warning' })
      return
    }
    if (!undoRedo.enabled) {
      toast({ title: t('ui.menu.enableUndoTitle'), description: t('ui.bulk.remove.enableUndoDesc'), variant: 'warning' })
      return
    }

    const lesson = removeLessonId()
    removeRunning = true
    removeStop = { stop: false }
    removeArmed = false
    removeLogRows = []
    renderRemoveLog()
    renderRemovePreview()
    updateRemoveButtons()
    setRemoveBadge(t('ui.bulk.remove.deleting'), 'busy')

    undoRedo.beginBatch(t('ui.bulk.remove.batchTitle', { p0: lesson }))
    let removed = 0
    let failed = 0
    let stopped = false

    try {
      for (const record of removeRecords) {
        if (removeStop.stop) {
          stopped = true
          appendRemoveLog({ label: t('ui.bulk.remove.stoppedLabel', { p0: lesson }), status: 'stopped', message: t('ui.bulk.remove.stoppedMessage'), at: Date.now() })
          break
        }
        const label = removeRecordLabel(record)
        try {
          await undoRedo.deleteAttendanceRecord(record)
          removed++
          appendRemoveLog({ label, status: 'removed', at: Date.now() })
        } catch (error) {
          failed++
          appendRemoveLog({
            label,
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
            at: Date.now(),
          })
        }
      }

      const detail = t('ui.bulk.remove.detail', { p0: removed, p1: failed, p2: stopped ? t('ui.common.stoppedSuffix') : '' })
      const committed = undoRedo.commitBatch({
        title: t('ui.bulk.remove.batchTitleCount', { p0: lesson, p1: removed }),
        detail,
      })
      toast({
        title: committed ? t('ui.bulk.remove.completedTitle') : t('ui.bulk.remove.noUndoTitle'),
        description: committed ? `${detail}${t('ui.common.undoBatchSuffix')}` : detail,
        variant: committed ? 'applied' : 'warning',
        duration: 7000,
      })
    } catch (error) {
      undoRedo.commitBatch({
        title: t('ui.bulk.remove.batchTitleCount', { p0: lesson, p1: undoRedo.batchCount }),
        detail: t('ui.bulk.attendance.errorEnded'),
      })
      toast({
        title: t('ui.bulk.remove.deleteErrorTitle'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'error',
      })
    } finally {
      removeRunning = false
      removeStop.stop = false
      const remaining = new Set(undoRedo.attendanceRecords.map((record) => record.id))
      removeRecords = removeRecords.filter((record) => remaining.has(record.id))
      renderRemovePreview()
      updateRemoveButtons()
    }
  }

  removeRefreshBtn.addEventListener('click', () => { void refreshRemoveRecords() })
  removeArmBtn.addEventListener('click', () => {
    if (removeArmBtn.disabled) return
    removeArmed = true
    renderRemovePreview()
    updateRemoveButtons()
    toast({
      title: t('ui.bulk.remove.armTitle'),
      description: t('ui.bulk.remove.armDesc'),
      variant: 'warning',
    })
  })
  removeRunBtn.addEventListener('click', () => { void executeRemoveAll() })
  removeStopBtn.addEventListener('click', () => {
    if (!removeRunning) return
    removeStop.stop = true
    setRemoveBadge(t('ui.common.stopping'), 'busy')
    toast({ title: t('ui.common.willStop'), description: t('ui.bulk.remove.stopDesc'), variant: 'warning' })
  })
  removeLessonInput.addEventListener('input', () => {
    removeArmed = false
    removeRecords = []
    renderRemovePreview()
    updateRemoveButtons()
  })

  const bulkMenu = backdrop.querySelector<HTMLElement>('[data-bulk-view="menu"]')!
  const bulkDetails = Array.from(backdrop.querySelectorAll<HTMLElement>('.bulk-detail[data-bulk-view]'))
  type BulkView = 'menu' | 'attendance' | 'evaluation' | 'exam-attendance' | 'exam-evaluation' | 'export' | 'remove' | 'remote'
  let currentBulkView: BulkView = 'menu'

  function updateBulkExamLabels(view: BulkView): void {
    const examAttendance = view === 'exam-attendance'
    const examEvaluation = view === 'exam-evaluation'

    const bulkTitle = bulkRoot.querySelector<HTMLElement>('[data-bulk-head-title]')
    const bulkSubtitle = bulkRoot.querySelector<HTMLElement>('[data-bulk-head-subtitle]')
    const bulkNote = bulkRoot.querySelector<HTMLElement>('[data-bulk-head-note]')
    if (bulkTitle) {
      bulkTitle.textContent = examAttendance
        ? t('ui.bulk.exam.title', { p0: t('ui.bulk.menu.examAttendance.title') })
        : t('ui.bulk.menu.attendance.title')
    }
    if (bulkSubtitle) {
      bulkSubtitle.textContent = examAttendance
        ? t('ui.bulk.exam.detailDesc', { p0: currentExamId() || '—' })
        : t('ui.bulk.attendance.subtitle')
    }
    if (bulkNote) {
      bulkNote.textContent = examAttendance
        ? t('ui.bulk.exam.attendanceWarning')
        : t('ui.bulk.attendance.note')
    }

    // Swap حصة → امتحان labels for the lesson-number field and mode toggle
    const bulkLessonLabel = bulkRoot.querySelector<HTMLElement>('[data-i18n="ui.common.lessonLabel"]')
    const bulkModeLabel = bulkRoot.querySelector<HTMLElement>('[data-i18n="ui.bulk.attendance.modeLabel"]')
    if (bulkLessonLabel) {
      bulkLessonLabel.textContent = examAttendance
        ? t('ui.bulk.exam.lessonLabel')
        : t('ui.common.lessonLabel')
    }
    if (bulkModeLabel) {
      bulkModeLabel.textContent = examAttendance
        ? t('ui.bulk.exam.modeLabel')
        : t('ui.bulk.attendance.modeLabel')
    }
    const evalTitle = evalRoot.querySelector<HTMLElement>('[data-eval-head-title]')
    const evalSubtitle = evalRoot.querySelector<HTMLElement>('[data-eval-head-subtitle]')
    const evalNote = evalRoot.querySelector<HTMLElement>('[data-eval-head-note]')
    if (evalTitle) {
      evalTitle.textContent = examEvaluation
        ? t('ui.bulk.exam.title', { p0: t('ui.bulk.menu.examEvaluation.title') })
        : t('ui.bulk.menu.evaluation.title')
    }
    if (evalSubtitle) {
      evalSubtitle.textContent = examEvaluation
        ? t('ui.bulk.exam.detailDesc', { p0: currentExamId() || '—' })
        : t('ui.bulk.eval.subtitle')
    }
    if (evalNote) {
      evalNote.textContent = examEvaluation
        ? t('ui.bulk.exam.note', { p0: currentExamId() || '—' })
        : [
          t('ui.bulk.eval.note1'), t('ui.bulk.eval.note2'), t('ui.bulk.eval.note3'),
          t('ui.bulk.eval.note4'), t('ui.bulk.eval.note5'), t('ui.bulk.eval.note6'),
          t('ui.bulk.eval.note7'), t('ui.bulk.eval.note8'), t('ui.bulk.eval.note9'),
        ].join('')
    }
  }

  function showBulkView(view: BulkView): void {
    bulkExamMode = view === 'exam-attendance'
    evalExamMode = view === 'exam-evaluation'
    currentBulkView = view
    // Exam actions reuse the attendance/evaluation panels; they have no
    // dedicated `data-bulk-view` node, so map them before toggling visibility.
    const panelView = view === 'exam-attendance'
      ? 'attendance'
      : view === 'exam-evaluation'
        ? 'evaluation'
        : view
    bulkMenu.hidden = panelView !== 'menu'
    for (const detail of bulkDetails) {
      detail.hidden = detail.dataset.bulkView !== panelView
    }
    updateBulkExamLabels(view)
    updateExamStagePanel()

    if (view === 'exam-attendance') {
      updateBulkInputPlaceholder()
      refreshBulkLesson()
      invalidateBulkAnalysis()
      updateBulkButtons()
    } else if (view === 'exam-evaluation') {
      invalidateEvalBulk()
      updateEvalBulkButtons()
    } else if (view === 'attendance') {
      refreshBulkLesson()
      invalidateBulkAnalysis()
      updateBulkButtons()
    } else if (view === 'export') {
      refreshAttendanceExport()
    } else if (view === 'evaluation') {
      invalidateEvalBulk()
      updateEvalBulkButtons()
    } else if (view === 'remove') {
      const lesson = currentLessonIdFromPage() || undoRedo.lessonId || ''
      if (!removeLessonInput.value.trim() && lesson) removeLessonInput.value = lesson
      void refreshRemoveRecords(true)
    }
  }
  const bulkMenuItems = Array.from(backdrop.querySelectorAll<HTMLButtonElement>('.bulk-menu-list .bulk-item'))
  const bulkModeHint = backdrop.querySelector<HTMLElement>('[data-bulk-mode-hint]')!

  /** Reflect the remote toggle and the current page in the action menu. */
  function renderBulkMenu(): void {
    bulkModeHint.hidden = false
    bulkModeHint.textContent = state.remoteBulk
      ? t('ui.bulk.menu.modeHint')
      : t('ui.bulk.menu.localHint')
    for (const item of bulkMenuItems) {
      const badge = item.querySelector<HTMLElement>('[data-bulk-availability]')!
      const kind = item.dataset.bulkKind
      let available: boolean
      let label: string
      if (state.remoteBulk) {
        // All four run actions can be driven from a target tab. Export and
        // remove read/write the current tab only, so they stay local.
        available = !!kind && isBulkRunKind(kind)
        label = available ? t('ui.bulk.menu.remoteBadge') : t('ui.bulk.menu.localOnly')
      } else {
        // Local mode: each action needs its own page open.
        available = kind
          ? bulkKindMatchesPath(kind, location.pathname)
          : bulkKindMatchesPath('attendance', location.pathname)
        label = available ? t('ui.bulk.menu.available') : t('ui.bulk.menu.wrongPage')
      }
      item.disabled = !available
      item.classList.toggle('is-unavailable', !available)
      badge.className = `feature-badge ${available ? 'on' : 'off'}`
      badge.textContent = label
    }
  }

  for (const btn of Array.from(backdrop.querySelectorAll<HTMLButtonElement>('[data-bulk-open]'))) {
    btn.addEventListener('click', () => {
      if (btn.disabled) return
      const view = btn.dataset.bulkOpen
      if (!view || view === 'remote') return
      if (state.remoteBulk && isBulkRunKind(view)) {
        openRemoteForKind(view)
        return
      }
      if (view === 'attendance' || view === 'evaluation' || view === 'exam-attendance'
        || view === 'exam-evaluation' || view === 'export' || view === 'remove') {
        showBulkView(view)
      }
    })
  }
  for (const btn of Array.from(backdrop.querySelectorAll<HTMLButtonElement>('[data-bulk-back]'))) {
    btn.addEventListener('click', () => showBulkView('menu'))
  }

  // ---- cross-tab remote bulk -----------------------------------------------
  // Remote mode is a toggle, not a menu action: each run action routes here
  // when it is on. Targets advertise the kinds their own page can execute, and
  // the target tab still runs its ordinary preview/arm/run pipeline locally.
  const remoteRoot = backdrop.querySelector<HTMLElement>('[data-remote-root]')!
  const remoteTargetIdInput = remoteRoot.querySelector<HTMLInputElement>('[data-remote-id]')!
  const remoteTargetNote = remoteRoot.querySelector<HTMLElement>('[data-remote-target-note]')!
  const remoteInput = remoteRoot.querySelector<HTMLTextAreaElement>('[data-remote-input]')!
  const remoteRefreshBtn = remoteRoot.querySelector<HTMLButtonElement>('[data-remote-refresh]')!
  const remotePrepareBtn = remoteRoot.querySelector<HTMLButtonElement>('[data-remote-prepare]')!
  const remoteArmBtn = remoteRoot.querySelector<HTMLButtonElement>('[data-remote-arm]')!
  const remoteRunBtn = remoteRoot.querySelector<HTMLButtonElement>('[data-remote-run]')!
  const remoteStopBtn = remoteRoot.querySelector<HTMLButtonElement>('[data-remote-stop]')!
  const remoteBadge = remoteRoot.querySelector<HTMLElement>('[data-remote-badge]')!
  const remoteStatus = remoteRoot.querySelector<HTMLElement>('[data-remote-status]')!
  const remoteKindNote = remoteRoot.querySelector<HTMLElement>('[data-remote-kind-note]')!

  let remoteBridge: RemoteBulkBridge | null = null
  let remoteTargets: RemoteTarget[] = []
  let remoteFlowKey = ''
  let remoteBusy = false
  let remotePrepared = false
  let remoteArmed = false
  let remoteLastRequest: RemoteRequest | null = null
  /** Set when the remote view was opened from a specific bulk action. */
  let remoteKind: BulkRunKind | null = null

  /**
   * A run can still be executing in the target tab after our request times out.
   * Keep this separate from remoteBusy so Stop stays reachable until the target
   * confirms a run result or a stop request succeeds.
   */
  let remoteRunActive = false
  let remoteRunContext: { to: string; kind: BulkRunKind; text: string } | null = null
  let remoteRunRequestId: string | null = null
  let remoteStopBusy = false
  /** Ignore a stale request result after a newer action (especially Stop). */
  let remoteRequestToken = 0

  function remoteSupportedKinds(): RemoteBulkKind[] {
    return supportedBulkKinds(location.pathname)
  }

  function selectedRemoteKind(): BulkRunKind | null {
    return remoteKind
  }

  /** The lesson ID in the URL, or the lesson the current page is showing. */
  function pageLessonId(): string {
    return new URLSearchParams(location.search).get('lesson_id')?.trim()
      || currentLessonIdFromPage() || ''
  }

  function examIdFromTargetPath(path: string): string {
    try {
      return examIdFromPath(new URL(path, location.href).pathname) ?? ''
    } catch {
      return ''
    }
  }

  function selectedRemoteTarget(): RemoteTarget | null {
    const kind = selectedRemoteKind()
    if (!kind) return null
    return remoteTargets.find((target) => remoteTargetMatches(target.path, kind, remoteTargetIdInput.value)) ?? null
  }

  function updateRemoteKindNote(): void {
    remoteKindNote.hidden = !remoteKind
    // Use the exact placeholders from the local panels, including every
    // documented input format, so remote mode shows the same guidance.
    const kind = selectedRemoteKind()
    remoteInput.placeholder = kind === 'evaluation' || kind === 'exam-evaluation'
      ? evalInput.placeholder || t('ui.bulk.eval.inputPlaceholder')
      : bulkCodesInput.placeholder || t('ui.bulk.attendance.inputPlaceholder')
  }

  /** Enter remote mode for one chosen action. */
  function openRemoteForKind(kind: BulkRunKind): void {
    remoteKind = kind
    remoteTargetIdInput.value = isExamBulkKind(kind) ? currentExamId() : pageLessonId()
    remoteInput.value = ''
    updateRemoteKindNote()
    showBulkView('remote')
    resetRemoteFlow()
    refreshRemoteTargets()
  }

  function remotePhaseLabel(phase: RemoteBulkPhase): string {
    if (phase === 'prepare') return t('ui.bulk.remote.prepare')
    if (phase === 'arm') return t('ui.bulk.remote.arm')
    if (phase === 'run') return t('ui.bulk.remote.run')
    return t('ui.bulk.remote.stop')
  }

  function setRemoteBadge(text: string, className: string): void {
    remoteBadge.textContent = text
    remoteBadge.className = `feature-badge ${className}`
  }

  function renderRemoteStatus(): void {
    if (!remoteLastRequest) {
      remoteStatus.textContent = t('ui.common.previewEmpty')
      return
    }
    const phase = remotePhaseLabel(remoteLastRequest.phase)
    if (remoteLastRequest.status === 'pending') {
      remoteStatus.textContent = t('ui.bulk.remote.sending', { p0: phase })
    } else if (remoteLastRequest.status === 'error') {
      remoteStatus.textContent = t('ui.bulk.remote.failed', { p0: remoteLastRequest.message || t('ui.common.error') })
    } else if (remoteLastRequest.preview) {
      remoteStatus.textContent = t('ui.bulk.remote.preview', {
        p0: remoteLastRequest.preview.ready,
        p1: remoteLastRequest.preview.invalid,
        p2: remoteLastRequest.preview.needsDecision,
      })
    } else {
      remoteStatus.textContent = t('ui.bulk.remote.done', { p0: phase })
    }
  }

  function updateRemoteButtons(): void {
    const kind = selectedRemoteKind()
    const target = selectedRemoteTarget()
    const valid = !!target && !!kind && remoteInputAllowed(kind, remoteInput.value)
    const locked = remoteBusy || remoteStopBusy || remoteRunActive
    // Never let an edit detach Stop from the request it is meant to stop.
    remoteInput.readOnly = locked
    remoteTargetIdInput.readOnly = locked
    remoteRefreshBtn.disabled = locked
    remotePrepareBtn.disabled = !valid || locked
    remoteArmBtn.disabled = !valid || locked || !remotePrepared
    remoteRunBtn.disabled = !valid || locked || !remoteArmed
    remoteStopBtn.disabled = !remoteRunActive || remoteStopBusy

    if (!remoteTargetIdInput.value.trim()) {
      remoteTargetNote.textContent = t('ui.bulk.remote.enterId')
    } else if (kind && !target) {
      remoteTargetNote.textContent = t('ui.bulk.remote.noTargetForKind')
    } else if (target) {
      remoteTargetNote.textContent = t('ui.bulk.remote.targetForId', { p0: target.path })
    } else {
      remoteTargetNote.textContent = t('ui.bulk.remote.noTargets')
    }

    if (remoteRunActive) setRemoteBadge(t('ui.common.running'), 'busy')
    else if (!target) {
      setRemoteBadge(remoteKind
        ? t('ui.bulk.remote.noTargetForKind')
        : t('ui.bulk.remote.noTargets'), 'off')
    }
    else if (remoteBusy) setRemoteBadge(t('ui.common.running'), 'busy')
    else if (remoteArmed) setRemoteBadge(t('ui.common.armed'), 'on')
    else if (remotePrepared) setRemoteBadge(t('ui.common.ready'), 'on')
    else setRemoteBadge(t('ui.common.unavailable'), 'off')
  }

  /** Clear a run that is deliberately being abandoned by a user action. */
  function abandonRemoteRun(): void {
    if (remoteBridge && remoteRunActive && remoteRunContext && !remoteStopBusy) {
      // Best effort: tell the target to stop before we forget the context. It
      // only presses its local Stop button and creates no new write path.
      const { to, kind, text } = remoteRunContext
      void remoteBridge.send({ to, kind, phase: 'stop', text }).catch(() => {})
    }
    // Invalidate any in-flight run/stop result so it cannot revive the old flow.
    remoteRequestToken++
    remoteRunActive = false
    remoteRunContext = null
    remoteRunRequestId = null
    remoteStopBusy = false
  }

  function resetRemoteFlow(): void {
    abandonRemoteRun()
    remotePrepared = false
    remoteArmed = false
    remoteLastRequest = null
    renderRemoteStatus()
    updateRemoteButtons()
  }

  function refreshRemoteTargets(): void {
    const advertised = remoteBridge?.targets() ?? []
    const kind = selectedRemoteKind()
    // The action kind already determines the page; only tabs that can execute
    // it are candidates. The lesson/exam ID then picks the exact target URL.
    remoteTargets = kind
      ? advertised.filter((target) => target.kinds.includes(kind))
      : advertised

    // Exam actions are targeted by the exam ID in the target URL. If only one
    // exam is advertised, fill it in so preview isn't blocked by an empty ID.
    if (kind && isExamBulkKind(kind) && !remoteTargetIdInput.value.trim()) {
      const ids = [...new Set(remoteTargets.map((target) => examIdFromTargetPath(target.path)).filter(Boolean))]
      if (ids.length === 1) remoteTargetIdInput.value = ids[0]
    }

    const nextKind = selectedRemoteKind()
    const target = selectedRemoteTarget()
    const flowKey = `${target?.id ?? ''}:${nextKind ?? ''}:${remoteTargetIdInput.value.trim()}`
    if (flowKey !== remoteFlowKey) {
      remoteFlowKey = flowKey
      // A target can expire while its run is still executing. Keep the run and
      // its Stop context intact; only clear the idle preview/arm state.
      if (!remoteRunActive) resetRemoteFlow()
    }
    updateRemoteButtons()
  }

  function remotePreview(kind: BulkRunKind): RemotePreview {
    if (kind === 'attendance' || kind === 'exam-attendance') {
      return {
        ready: executableEntries().length,
        invalid: bulkParsed?.invalid.length ?? 0,
        needsDecision: unresolvedNameRows().length,
      }
    }
    return {
      ready: evalExecutableRows().length,
      invalid: evalParsed?.invalid.length ?? 0,
      needsDecision: evalRows.filter((row) => evalNeedsDecision(row)).length,
    }
  }

  async function prepareRemoteTarget(request: RemoteRequest): Promise<RemoteRequest> {
    // Target-side bypass: showBulkView only switches the view; routing by the
    // remote toggle lives in the click handler, so this local switch is safe.
    if (request.kind === 'attendance' || request.kind === 'exam-attendance') {
      bulkCodesInput.value = request.text
      showBulkView(request.kind === 'exam-attendance' ? 'exam-attendance' : 'attendance')
      await analyzeBulkInput()
    } else {
      evalInput.value = request.text
      showBulkView(request.kind === 'exam-evaluation' ? 'exam-evaluation' : 'evaluation')
      analyzeEvaluationBulk()
    }
    const preview = remotePreview(request.kind)
    return {
      ...request,
      status: 'done',
      preview,
      message: t('ui.bulk.remote.preview', {
        p0: preview.ready,
        p1: preview.invalid,
        p2: preview.needsDecision,
      }),
    }
  }

  async function handleRemoteRequest(request: RemoteRequest): Promise<RemoteRequest> {
    const notReady = (): RemoteRequest => ({ ...request, status: 'error', message: t('ui.bulk.remote.notReady') })
    // Re-check the target's own page before touching any local bulk state.
    if (!isBulkRunKind(request.kind)
      || !supportedBulkKinds(location.pathname).includes(request.kind)) {
      return { ...request, status: 'error', message: t('ui.bulk.remote.wrongTarget') }
    }
    // Stop must work while a run is in flight, when the ready-to-arm guards are
    // deliberately false. It only presses the local Stop button; no write path.
    if (request.phase === 'stop') {
      if (request.kind === 'attendance' || request.kind === 'exam-attendance') {
        if (bulkRunning) bulkStopBtn.click()
      } else if (evalRunning) {
        evalStopBtn.click()
      }
      return { ...request, status: 'done', message: t('ui.bulk.remote.stopped') }
    }
    if (!remoteInputAllowed(request.kind, request.text)) {
      return { ...request, status: 'error', message: t('ui.bulk.exam.guard') }
    }
    if (request.phase === 'prepare') return prepareRemoteTarget(request)

    if (request.kind === 'attendance' || request.kind === 'exam-attendance') {
      const exam = request.kind === 'exam-attendance'
      if (bulkExamMode !== exam || bulkCodesInput.value !== request.text || !bulkParsed || !readyToArm()) return notReady()
      if (request.phase === 'arm') {
        if (!bulkArmed) bulkArmBtn.click()
        return bulkArmed ? { ...request, status: 'done' } : notReady()
      }
      if (request.phase === 'run') {
        if (!bulkArmed || bulkRunning) return notReady()
        await executeBulk()
        if (!bulkRan) return notReady()
        return bulkLogRows.some((row) => row.status === 'error')
          ? { ...request, status: 'error', message: t('ui.bulk.remote.runFailed') }
          : { ...request, status: 'done' }
      }
    } else {
      const exam = request.kind === 'exam-evaluation'
      if (evalExamMode !== exam || evalInput.value !== request.text || !evalParsed || !evalReadyToArm()) return notReady()
      if (request.phase === 'arm') {
        if (!evalArmed) evalArmBtn.click()
        return evalArmed ? { ...request, status: 'done' } : notReady()
      }
      if (request.phase === 'run') {
        if (!evalArmed || evalRunning) return notReady()
        await executeEvaluationBulk()
        if (!evalRan) return notReady()
        return evalLogRows.some((row) => row.status === 'error')
          ? { ...request, status: 'error', message: t('ui.bulk.remote.runFailed') }
          : { ...request, status: 'done' }
      }
    }
    return notReady()
  }

  async function sendRemotePhase(phase: RemoteBulkPhase): Promise<void> {
    if (!remoteBridge) return

    let to: string
    let kind: BulkRunKind
    let text: string
    if (phase === 'stop') {
      // Stop is tied to the run that was actually launched, even if the target
      // advertisement expired or the run request already timed out locally.
      if (!remoteRunActive || !remoteRunContext || remoteStopBusy) return
      ;({ to, kind, text } = remoteRunContext)
    } else {
      const target = selectedRemoteTarget()
      const selectedKind = selectedRemoteKind()
      if (!target) {
        toast({ title: t('ui.bulk.remote.chooseTarget'), variant: 'warning' })
        return
      }
      if (!selectedKind || !remoteInputAllowed(selectedKind, remoteInput.value)) {
        toast({ title: t('ui.bulk.remote.invalidInput'), variant: 'warning' })
        return
      }
      if (remoteBusy) return
      to = target.id
      kind = selectedKind
      text = remoteInput.value
    }

    const now = Date.now()
    const token = ++remoteRequestToken
    remoteLastRequest = {
      id: '',
      from: remoteBridge.selfId,
      to,
      kind,
      phase,
      text,
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    }
    if (phase === 'run') {
      remoteRunActive = true
      remoteRunContext = { to, kind, text }
      remoteRunRequestId = null
    }
    if (phase === 'stop') remoteStopBusy = true
    else remoteBusy = true
    renderRemoteStatus()
    updateRemoteButtons()

    try {
      const result = await remoteBridge.send({ to, kind, phase, text })
      // A Stop request supersedes the run result. Never overwrite its outcome.
      if (token !== remoteRequestToken) return
      remoteLastRequest = result
      if (result.status === 'done') {
        if (phase === 'prepare') {
          remotePrepared = true
          remoteArmed = false
        } else if (phase === 'arm') {
          remoteArmed = true
        } else if (phase === 'run' || phase === 'stop') {
          remotePrepared = false
          remoteArmed = false
          remoteRunActive = false
          remoteRunContext = null
          remoteRunRequestId = null
        }
      } else if (result.status === 'error') {
        // A timed-out run may still be executing in the target tab, so Stop
        // stays available; a real target rejection means nothing is running.
        const timedOut = Date.now() - now >= REQUEST_TIMEOUT_MS
          || result.message === REQUEST_TIMEOUT_MESSAGE
        if (phase === 'run') {
          if (timedOut) remoteRunRequestId = result.id
          else {
            remoteRunActive = false
            remoteRunContext = null
            remoteRunRequestId = null
          }
        }
        toast({
          title: t('ui.bulk.remote.failed', { p0: remotePhaseLabel(phase) }),
          description: result.message || t('ui.common.error'),
          variant: 'error',
        })
      }
    } catch (error) {
      if (token !== remoteRequestToken) return
      const message = error instanceof Error ? error.message : String(error)
      remoteLastRequest = {
        ...(remoteLastRequest ?? {
          id: '', from: remoteBridge.selfId, to, kind, phase, text,
          createdAt: now, updatedAt: now, status: 'error' as const,
        }),
        status: 'error',
        message,
      }
      toast({
        title: t('ui.bulk.remote.failed', { p0: remotePhaseLabel(phase) }),
        description: message,
        variant: 'error',
      })
    } finally {
      if (phase === 'stop') {
        // A failed Stop can be retried; a superseded one must not clear the
        // busy flag of a newer Stop request.
        if (token === remoteRequestToken) remoteStopBusy = false
      } else {
        remoteBusy = false
      }
      renderRemoteStatus()
      updateRemoteButtons()
    }
  }

  /** Consume a terminal target result that arrives after our local timeout. */
  function syncRemoteRunResult(): void {
    if (!remoteBridge || !remoteRunActive || !remoteRunRequestId || remoteStopBusy) return
    const current = remoteBridge.request(remoteRunRequestId)
    if (!current || current.phase !== 'run' || current.status === 'pending') return
    if (current.status === 'error' && current.message === REQUEST_TIMEOUT_MESSAGE) return
    remoteLastRequest = current
    remotePrepared = false
    remoteArmed = false
    remoteRunActive = false
    remoteRunContext = null
    remoteRunRequestId = null
    renderRemoteStatus()
  }

  remoteBridge = initRemoteBulk(remoteSupportedKinds)
  remoteBridge.onChanged(() => {
    syncRemoteRunResult()
    refreshRemoteTargets()
    renderRemoteStatus()
    updateRemoteButtons()
  })
  remoteBridge.onRequest((request) => handleRemoteRequest(request))
  refreshRemoteTargets()

  remoteRefreshBtn.addEventListener('click', () => {
    remoteBridge?.refresh()
    refreshRemoteTargets()
  })
  remotePrepareBtn.addEventListener('click', () => { void sendRemotePhase('prepare') })
  remoteArmBtn.addEventListener('click', () => { void sendRemotePhase('arm') })
  remoteRunBtn.addEventListener('click', () => { void sendRemotePhase('run') })
  remoteStopBtn.addEventListener('click', () => { void sendRemotePhase('stop') })
  remoteInput.addEventListener('input', () => {
    if (remoteInput.readOnly) {
      remoteInput.value = remoteLastRequest?.text ?? remoteInput.value
      return
    }
    resetRemoteFlow()
  })
  remoteTargetIdInput.addEventListener('input', () => {
    if (remoteTargetIdInput.readOnly) return
    resetRemoteFlow()
    refreshRemoteTargets()
  })
  let menuCommandIds: (string | number)[] = []
  function registerMenuCommands(): void {
    // Captions are localized at registration time, so a locale switch must
    // replace the existing commands rather than keep stale Arabic labels.
    for (const id of menuCommandIds) {
      try { GM_unregisterMenuCommand(id) } catch { /* manager lacks unregister support */ }
    }
    menuCommandIds = [
      GM_registerMenuCommand(t('ui.menu.notificationPreview'), () => {
        toast({
          title: t('ui.menu.toastAppliedTitle'),
          description: t('ui.menu.toastAppliedDesc'),
          variant: 'applied',
        })
      }),
      GM_registerMenuCommand(t('ui.menu.copyLastReport'), () => {
        void copyPlainText(
          bulkDiagnosticReport || t('ui.menu.noReportYet'),
          t('ui.bulk.attendance.reportCopiedTitle'),
          t('ui.bulk.attendance.reportCopiedDesc'),
        )
      }),
      GM_registerMenuCommand(t('ui.menu.diagnoseHomework'), () => {
        const report = diagnoseHomeworkButtons()
        console.info('[Tamperina homework diagnostic]\n' + report)
        void navigator.clipboard?.writeText(report).catch(() => {})
        toast({
          title: t('ui.menu.homeworkDiagnosticTitle'),
          description: t('ui.menu.homeworkDiagnosticDesc'),
          variant: 'info',
          duration: 7000,
        })
      }),
      GM_registerMenuCommand(t('ui.menu.undo'), () => void undoRedo.undo()),
      GM_registerMenuCommand(t('ui.menu.redo'), () => void undoRedo.redo()),
      GM_registerMenuCommand(t('ui.menu.toggleUndo'), () => undoRedo.setEnabled(!undoRedo.enabled)),
      GM_registerMenuCommand(t('ui.menu.undoDiagnostic'), () => {
        const info = undoRedo.debug()
        if (info) console.table(info.observed)
        toast({
          title: t('ui.menu.tamperinaDiagnosticTitle'),
          description: info
            ? t('ui.menu.diagnosticInfo', { p0: info.path, p1: info.historyCount, p2: info.gradeBaselineCount, p3: info.observed.length })
            : t('ui.menu.diagnosticUnavailable'),
          variant: 'info',
          duration: 9000,
        })
      }),
      GM_registerMenuCommand(t('ui.menu.openSettings'), () => openModal()),
      GM_registerMenuCommand(t('ui.menu.evalFind'), () => {
        if (!isEvaluationPage() || !isFeatureEnabled('evaluation-find')) return
        findBar.toggle()
      }),
      GM_registerMenuCommand(t('ui.menu.cancelClickThrough'), () => {
        state.clickThrough = false
        persist()
        render()
      }),
    ]
  }

  /** Re-render every surface that baked translations into generated markup. */
  function rerenderForLocale(): void {
    host.dir = state.locale === 'en' ? 'ltr' : 'rtl'
    applyTranslations(shadow)
    // Re-apply state-dependent labels (play/pause, lock/unlock, pin tooltip,
    // tab selection) that applyTranslations() resets to their generic form.
    render() // also refreshes the feature list via renderFeatureIfNeeded()
    renderBulkLog()
    renderBulkAnalysis() // also refreshes the resolve panel via renderBulkResolve()
    updateBulkButtons()
    updateBulkInputPlaceholder()
    refreshAttendanceExport()
    renderEvalLog()
    renderEvalResolve()
    renderEvalAnalysis()
    updateEvalBulkButtons()
    renderRemoveLog()
    renderRemovePreview()
    updateRemoveButtons()
    updateBulkExamLabels(currentBulkView)
    updateExamStagePanel()
    renderBulkMenu()
    updateRemoteKindNote()
    void applyWhatsappHold()
    refreshRemoteTargets()
    renderRemoteStatus()
    updateRemoteButtons()
    registerMenuCommands()
  }

  subscribeLocale(() => {
    state.locale = getLocale()
    rerenderForLocale()
  })

  // The shell state is one shared GM value, so a toggle flipped in another
  // tab would otherwise be overwritten by this tab's next persist(). Keep the
  // remote mode in step without pulling in unrelated per-tab UI state.
  try {
    GM_addValueChangeListener(SHELL_KEY, (_key, _oldValue, _newValue, remote) => {
      if (!remote) return
      const next = loadShell().remoteBulk
      if (next === state.remoteBulk) return
      state.remoteBulk = next
      const toggle = featureList.querySelector<HTMLButtonElement>('[data-feature-id="remote-bulk"]')
      if (toggle) {
        toggle.setAttribute('aria-checked', String(next))
        syncToggleCard(toggle, next)
      }
      if (currentBulkView !== 'menu') showBulkView('menu')
      resetRemoteFlow()
      renderBulkMenu()
    })
  } catch {
    // Managers without change listeners simply keep the previous behaviour.
  }

  registerMenuCommands()
  wirePagePanels()
  updateBulkExamLabels(currentBulkView)
  updateExamStagePanel()
  renderBulkMenu()
  updateRemoteKindNote()
  if (state.holdWhatsappUntilApproved) void applyWhatsappHold()

  render()
}
