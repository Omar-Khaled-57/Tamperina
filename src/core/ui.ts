import { GM_registerMenuCommand, unsafeWindow } from '$'
import rina from 'virtual:tamperina-rina'
import cairoFontCss from 'virtual:tamperina-fonts'
import shellStyle from '../ui/styles.css?style'
import { icons } from '../icons'
import { attachToaster, toast } from './toast'
import { getUndoRedoController, type UndoRedoController } from './undoRedo'
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
  currentLessonIdFromPage,
  detectScanForm,
  formatCandidate,
  parseBulkEntries,
  resolveNameEntry,
  runBulkAttendance,
  type BulkRowResult,
  type NameRow,
  type ParseEntriesResult,
  type PaymentMode,
  type PaymentStatus,
  type PaymentOverride,
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
  SIZE_MIN,
  SIZE_MAX,
  SIZE_STEP,
  type ShellState,
} from './storage'

const HOST_ID = 'tamperina-root'
const DRAG_THRESHOLD = 5
const HOTKEY_RESTORE = 'Alt+Shift+T'
let cairoFontReady = false
let toggleEffectsReady = false

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
`
  ;(document.head || document.documentElement).appendChild(style)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snapSize(value: number): number {
  return clamp(Math.round(value / SIZE_STEP) * SIZE_STEP, SIZE_MIN, SIZE_MAX)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] ?? char)
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

function isAttendancePage(): boolean {
  return location.pathname.replace(/\/$/, '') === '/attendance/scan'
}

function featureScopeLabel(): string {
  return location.pathname.replace(/\/$/, '') === '/evaluation'
    ? 'تقييم الحصة'
    : 'حضور الطلاب'
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

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

  const host = document.createElement('div')
  host.id = HOST_ID
  document.documentElement.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  attachToaster(shadow)
  shadow.appendChild(shellStyle.cloneNode(true))

  const shellEl = document.createElement('div')
  shellEl.className = 'shell'
  shellEl.innerHTML = `
    <div class="launcher" title="Tamperina" tabindex="0" role="button" aria-label="فتح تمبرينا">
      <div class="flip">
        <div class="spin">
          <img class="mascot" src="${rina.logo}" alt="Tamperina" draggable="false" />
        </div>
      </div>
      <div class="pill" role="toolbar" aria-label="أدوات تمبرينا">
        <button type="button" data-act="shrink" title="تصغير الحجم">${icons.shrink}</button>
        <button type="button" data-act="grow" title="تكبير الحجم">${icons.grow}</button>
        <span class="sep" aria-hidden="true"></span>
        <button type="button" data-act="mirror" title="عكس الصورة">${icons.flip}</button>
        <button type="button" data-act="pause" title="إيقاف الحركة">${icons.pause}</button>
        <span class="frames" role="group" aria-label="إطار الحركة" hidden>
          <button type="button" data-act="frame" data-frame="1" title="الإطار 1 — مائل لليمين (+10°)">F1</button>
          <button type="button" data-act="frame" data-frame="2" title="الإطار 2 — مائل لليسار (−10°)">F2</button>
          <button type="button" data-act="frame" data-frame="3" title="الوضع المستقيم (0°)">F3</button>
        </span>
        <button type="button" data-act="lock" title="تثبيت الموضع">${icons.lockOpen}</button>
        <button type="button" data-act="clickThrough" title="النقر من خلال">${icons.clickThrough}</button>
      </div>
    </div>
    <button type="button" class="pin" title="${HOTKEY_RESTORE} — استعادة تمبرينا">${icons.pin}</button>
  `
  shadow.appendChild(shellEl)

  const backdrop = document.createElement('div')
  backdrop.className = 'backdrop'
  backdrop.hidden = true
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="خيارات تمبرينا">
      <div class="modal-head">
        <div class="brand">
          <span class="brand-dot"></span>
          <span>
            <strong>تَمبــرينا</strong>
            <small>مساعدة المساعدين</small>
          </span>
        </div>
        <button type="button" class="icon-btn" data-close title="إغلاق">${icons.close}</button>
      </div>
      <div class="tabs" role="tablist">
        <span class="tab-indicator" aria-hidden="true"></span>
        <button type="button" class="tab" data-tab="toggles" role="tab">${icons.toggles} المفاتيح</button>
        <button type="button" class="tab" data-tab="bulk" role="tab">${icons.bulk} الجماعي</button>
      </div>
      <div class="panels">
        <div data-panel="toggles">
          <div data-feature-list class="feature-list"></div>
        </div>
        <div data-panel="bulk" hidden>
          <div class="bulk-menu" data-bulk-view="menu">
            <div class="bulk-menu-list">
              <button type="button" class="bulk-item" data-bulk-open="attendance">
                <span class="feature-icon">${icons.bulk}</span>
                <span class="bulk-item-text">
                  <strong>تسجيل حضور جماعي</strong>
                  <small>إدخال قائمة طلاب في صفحة الحضور مع معاينة وتسليح وتراجع دفعة واحدة</small>
                </span>
                <span class="feature-badge on">متاح</span>
              </button>

              <button type="button" class="bulk-item" data-bulk-open="evaluation">
                <span class="feature-icon">${icons.toggles}</span>
                <span class="bulk-item-text">
                  <strong>تقييم جماعي</strong>
                  <small>إدخال درجات امتحان/واجب لعدة طلاب في صفحة التقييم مع معاينة وتسليح وتراجع دفعة واحدة</small>
                </span>
                <span class="feature-badge on">متاح</span>
              </button>

              <button type="button" class="bulk-item" data-bulk-open="export">
                <span class="feature-icon">${icons.download}</span>
                <span class="bulk-item-text">
                  <strong>تصدير أكواد الحضور</strong>
                  <small>الطلاب الحاضرون في الحصة: الكود والاسم — نسخ أو تنزيل ملف txt</small>
                </span>
                <span class="feature-badge on">متاح</span>
              </button>
            </div>
          </div>

          <div class="bulk-detail" data-bulk-view="attendance" hidden>
            <button type="button" class="bulk-back" data-bulk-back>→ كل الإجراءات الجماعية</button>
            <div class="bulk-card" data-bulk-root>
              <div class="bulk-head">
                <span class="feature-icon">${icons.bulk}</span>
                <span class="feature-titles">
                  <strong>تسجيل حضور جماعي</strong>
                  <small>إدخال عبر نموذج الحضور (أكواد أو أسماء)</small>
                </span>
                <span class="feature-badge off" data-bulk-state-badge>جاهز</span>
              </div>

              <p class="bulk-note">
                اكتب كل طالب في سطر مستقل: كود الطالب أو اسمه. إذا تعذّر العثور على الاسم أو كان غامضًا/مشتركًا، ستظهر لك خيارات: اختيار الطالب الصحيح، تعديل الاسم، أو تجاهله لإدخاله يدويًا.
              </p>

              <div class="bulk-grid">
                <label class="bulk-field">
                  <span>رقم الحصة (الحالية افتراضيًا)</span>
                  <input type="text" inputmode="numeric" class="bulk-input" data-bulk-lesson placeholder="مثال: 293" />
                </label>
                <div class="bulk-field">
                  <span>نوع الحصة</span>
                  <div class="bulk-mode-toggle" data-bulk-mode-toggle role="group" aria-label="نوع الحصة">
                    <button type="button" class="bulk-mode-btn active" data-mode="center" aria-pressed="true">${icons.center}<span>سنتر</span></button>
                    <button type="button" class="bulk-mode-btn" data-mode="school" aria-pressed="false">${icons.school}<span>مدرسة</span></button>
                  </div>
                </div>
              </div>

              <label class="bulk-field">
                <span>قائمة الطلاب (كود أو اسم في كل سطر)</span>
                <textarea class="bulk-textarea" data-bulk-codes rows="7" placeholder="2349&#10;أحمد محمد&#10;2351"></textarea>
              </label>

              <div class="bulk-actions">
                <button type="button" class="action-btn" data-bulk-preview>${icons.toggles}<span>معاينة وتحليل</span></button>
                <button type="button" class="action-btn" data-bulk-arm disabled>${icons.lock}<span>تسليح التنفيذ</span></button>
                <button type="button" class="action-btn bulk-run" data-bulk-run disabled>${icons.play}<span>تنفيذ</span></button>
                <button type="button" class="action-btn bulk-stop" data-bulk-stop disabled>${icons.pause}<span>إيقاف</span></button>
              </div>

              <div class="bulk-preview" data-bulk-preview-box>لم تتم المعاينة بعد.</div>
              <div class="bulk-resolve" data-bulk-resolve hidden></div>

              <div class="history-head">
                ${icons.history}
                <strong>سجل التنفيذ</strong>
                <small data-bulk-log-count>0</small>
              </div>
              <div class="bulk-log" data-bulk-log>
                <div class="history-empty">لا يوجد تنفيذ بعد.</div>
              </div>

              <p class="feature-note">${icons.shieldAlert}
                يتم الإرسال طالبًا بطالب عبر نموذج الصفحة نفسه. التراجع بعد اكتمال الدفعة يلغي كل السجلات المُنشأة في خطوة واحدة. إذا اختلف رقم الحصة عن الحصة المفتوحة، يجب فتح الرابط الصحيح أولًا.
              </p>
            </div>
          </div>

          <div class="bulk-detail" data-bulk-view="export" hidden>
            <button type="button" class="bulk-back" data-bulk-back>→ كل الإجراءات الجماعية</button>
            <div class="bulk-card" data-export-root>
              <div class="bulk-head">
                <span class="feature-icon">${icons.download}</span>
                <span class="feature-titles">
                  <strong>تصدير أكواد الحضور</strong>
                  <small>قائمة الحاضرين في الحصة الحالية</small>
                </span>
                <span class="feature-badge off" data-export-count>0 طالب</span>
              </div>

              <p class="bulk-note">
                كل سطر في الصيغة: كود الطالب، الاسم. الكود هو المعرّف المستخدم في تسجيل الحضور الجماعي. يمكن نسخ القائمة أو تنزيلها كملف نصي.
              </p>

              <div class="bulk-grid">
                <label class="bulk-field">
                  <span>رقم الحصة (الحالية افتراضيًا)</span>
                  <input type="text" inputmode="numeric" class="bulk-input" data-export-lesson placeholder="مثال: 293" />
                </label>
                <div class="bulk-field">
                  <span>السجلات المحفوظة</span>
                  <div class="bulk-mode-toggle" data-export-summary>
                    <span class="bulk-export-summary" data-export-summary-text>—</span>
                  </div>
                </div>
              </div>

              <div class="bulk-actions export-actions">
                <button type="button" class="action-btn" data-export-refresh>${icons.refresh}<span>تحديث القائمة</span></button>
                <button type="button" class="action-btn" data-export-copy>${icons.copy}<span>نسخ</span></button>
                <button type="button" class="action-btn bulk-run" data-export-download>${icons.download}<span>تنزيل txt</span></button>
              </div>

              <label class="bulk-field">
                <span>النتيجة (كود الطالب, الاسم)</span>
                <textarea class="bulk-textarea bulk-export-text" data-export-text rows="10" placeholder="2349, أحمد محمد"></textarea>
              </label>

              <p class="feature-note" data-export-hint>${icons.shieldAlert}
                تُبنى القائمة من سجلات الحضور التي رصدها Tamperina في هذه الجلسة. إذا كانت فارغة، افتح صفحة الحضور وانتظر تحميل القائمة ثم اضغط تحديث.
              </p>
            </div>
          </div>

          <div class="bulk-detail" data-bulk-view="evaluation" hidden>
            <button type="button" class="bulk-back" data-bulk-back>→ كل الإجراءات الجماعية</button>
            <div class="bulk-card" data-eval-bulk-root>
              <div class="bulk-head">
                <span class="feature-icon">${icons.toggles}</span>
                <span class="feature-titles">
                  <strong>تقييم جماعي</strong>
                  <small>درجات امتحان وواجب (أكواد أو أسماء)</small>
                </span>
                <span class="feature-badge off" data-eval-badge>جاهز</span>
              </div>

              <p class="bulk-note">
                كل سطر: <strong>المعرّف، القيمة</strong> أو <strong>المعرّف، قيمة، قيمة</strong>. المعرّف كود الطالب أو اسمه. <strong>رقم</strong> (مثل 9.5) = درجة امتحان، <strong>نص تقدير</strong> (مثل امتياز/جيد جدًا/مقبول) = درجة واجب. الترتيب مرن عند اختلاف النوع؛ إن وُجد رقمان معًا فستُطلب منك تحديد أيهما الامتحان وأيهما الواجب. إن أُرسلت قيمة واحدة فقط، تُترك الأخرى على الوضع الافتراضي للصفحة.
              </p>

              <label class="bulk-field">
                <span>قائمة التقييم (سطر لكل طالب)</span>
                <textarea class="bulk-textarea" data-eval-input rows="7" placeholder="2017, 9.5, امتياز&#10;أحمد محمد, جيد جدًا&#10;2018, 8"></textarea>
              </label>

              <div class="bulk-actions">
                <button type="button" class="action-btn" data-eval-preview>${icons.toggles}<span>معاينة وتحليل</span></button>
                <button type="button" class="action-btn" data-eval-arm disabled>${icons.lock}<span>تسليح التنفيذ</span></button>
                <button type="button" class="action-btn bulk-run" data-eval-run disabled>${icons.play}<span>تنفيذ</span></button>
                <button type="button" class="action-btn bulk-stop" data-eval-stop disabled>${icons.pause}<span>إيقاف</span></button>
              </div>

              <div class="bulk-preview" data-eval-preview-box>لم تتم المعاينة بعد.</div>
              <div class="bulk-resolve" data-eval-resolve hidden></div>

              <div class="history-head">
                ${icons.history}
                <strong>سجل التنفيذ</strong>
                <small data-eval-log-count>0</small>
              </div>
              <div class="bulk-log" data-eval-log>
                <div class="history-empty">لا يوجد تنفيذ بعد.</div>
              </div>

              <p class="feature-note">${icons.shieldAlert}
                يعمل على صفحة التقييم المحمّلة حاليًا ويطابق الطلاب من صفوف الجدول. التراجع بعد التنفيذ يلغي تغييرات الدفعة في خطوة واحدة (يتطلب تفعيل التراجع). الحفظ يعتمد على سلوك الصفحة وقد يحتاج تأكيدًا حيًا.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
  shadow.appendChild(backdrop)

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

  const state: ShellState = loadShell()

  function persist(): void {
    saveShell(state)
  }

  const undoRedo = getUndoRedoController()
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
    ].join('~')
  }

  function evaluationTogglesHtml(): string {
    const onPage = isEvaluationPage()
    const cards = [
      {
        id: 'student-select' as const,
        icon: icons.userCheck,
        title: 'اختيار الطالب والاختصارات',
        desc: 'انقر على صف الطالب لاختياره، ثم حدد التقدير بحرف أو اكتب درجة الامتحان بالأرقام والنقطة. الحروف تعمل باللوحتين العربية والإنجليزية.',
        note: '؟ / h → امتياز · ج / [ → جيد جدا · ح / p → جيد · م / l → مقبول · ض / q → ضعيف · ن / k → الواجب ناقص',
      },
      {
        id: 'evaluation-find' as const,
        icon: icons.search,
        title: 'شريط البحث في التقييم',
        desc: 'Ctrl+Alt+F يفتح شريط بحث في أسفل الصفحة يبحث في كل صفوف الطلاب. كتابة رقم مكوّن من ٤ خانات تحدد الطالب تلقائيًا.',
        note: 'Enter / Shift+Enter للتنقل بين النتائج، وEsc للإغلاق.',
      },
      {
        id: 'homework-buttons' as const,
        icon: icons.graduationCap,
        title: 'أزرار تقييم الواجب',
        desc: 'أزرار ملوّنة متوهجة بدل قائمة الواجب. الضغط على الزر يختار الطالب ويحدّث التقدير، وقراءة النتيجة تتم عبر نموذج الصفحة نفسه.',
        note: 'تعمل معها نفس اختصارات التقدير عند اختيار طالب.',
      },
    ]

    return cards.map((card) => {
      const enabled = isFeatureEnabled(card.id)
      const badge = !onPage
        ? { text: 'غير متاح', className: 'off' }
        : enabled
          ? { text: 'مفعّل', className: 'on' }
          : { text: 'متوقف', className: 'off' }
      return `
        <section class="feature-card">
          <header class="feature-head">
            <span class="feature-icon">${card.icon}</span>
            <span class="feature-titles">
              <strong>${card.title}</strong>
              <small>${onPage ? 'تقييم الحصة' : 'تقييم الحصة فقط'}</small>
            </span>
            <span class="feature-badge ${badge.className}">${badge.text}</span>
            <button type="button" class="switch" data-feature-id="${card.id}" role="switch"
              aria-checked="${enabled}" aria-label="تشغيل أو إيقاف ${card.title}" ${onPage ? '' : 'disabled'}><span></span></button>
          </header>
          <p class="feature-desc">${card.desc}</p>
          <p class="feature-note">${icons.keyboard} ${card.note}</p>
        </section>
      `
    }).join('')
  }

  function renderFeature(controller: UndoRedoController): void {
    ensureToggleEffectsStyle()
    const centerState = localStorage.getItem('tamperina_center_modal') === 'true'
    const barcodeHidden = localStorage.getItem('tamperina_barcode_hidden') === 'true'

    document.documentElement.classList.toggle('centered-payment-modal', centerState)
    document.documentElement.classList.toggle('barcode-hidden', barcodeHidden)

    const generalTogglesHtml = `
      <section class="feature-card">
        <header class="feature-head">
          <span class="feature-icon">${icons.center}</span>
          <span class="feature-titles"><strong>مركِز نافذة الدفع</strong></span>
          <button type="button" class="switch" data-feature-id="center-modal" role="switch" aria-checked="${centerState}" aria-label="تمركُز نافذة الدفع"><span></span></button>
        </header>
      </section>
      <section class="feature-card">
        <header class="feature-head">
          <span class="feature-icon">${icons.barcode}</span>
          <span class="feature-titles"><strong>إخفاء الباركود</strong></span>
          <button type="button" class="switch" data-feature-id="hide-barcode" role="switch" aria-checked="${barcodeHidden}" aria-label="إخفاء أيقونة الباركود"><span></span></button>
        </header>
      </section>
    `

    if (!controller.supported) {
      featureList.innerHTML = `
        ${generalTogglesHtml}
        ${evaluationTogglesHtml()}
        <section class="feature-card">
          <header class="feature-head">
            <span class="feature-icon">${icons.undo}</span>
            <span class="feature-titles">
              <strong>التراجع وإعادة التنفيذ</strong>
              <small>غير متاح في هذه الصفحة</small>
            </span>
            <span class="feature-badge off">غير متاح</span>
            <button type="button" class="switch" data-feature-toggle role="switch"
              aria-checked="${controller.enabled}" aria-label="تشغيل أو إيقاف التراجع" disabled><span></span></button>
          </header>
          <p class="feature-desc">
            يعمل هذا المفتاح في صفحتي الحضور والتقييم فقط.
          </p>
        </section>
      `
      return
    }

    const badge = controller.busy
      ? { text: 'جارٍ التنفيذ', className: 'busy' }
      : controller.enabled
        ? { text: 'مفعّل', className: 'on' }
        : { text: 'متوقف', className: 'off' }

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
      : `<div class="history-empty">لا توجد عمليات مسجلة في هذه الصفحة بعد.</div>`

    featureList.innerHTML = `
      ${generalTogglesHtml}
      ${evaluationTogglesHtml()}
      <section class="feature-card">
        <header class="feature-head">
          <span class="feature-icon">${icons.undo}</span>
          <span class="feature-titles">
            <strong>التراجع وإعادة التنفيذ</strong>
            <small>${featureScopeLabel()}</small>
          </span>
          <span class="feature-badge ${badge.className}">${badge.text}</span>
          <button type="button" class="switch" data-feature-toggle role="switch"
            aria-checked="${controller.enabled}" aria-label="تشغيل أو إيقاف التراجع"
            ${controller.busy ? 'disabled' : ''}><span></span></button>
        </header>

        <p class="feature-desc">
          يسجّل تمبرينا عمليات الحضور التي تنفذها، ويتيح إلغاءها أو إعادتها بضغطة مفتاح.
        </p>

        <div class="feature-actions">
          <button type="button" class="action-btn" data-undo
            ${!controller.enabled || !controller.canUndo || controller.busy ? 'disabled' : ''}>
            ${icons.undo}<span>تراجع</span><kbd>Ctrl+Z</kbd>
          </button>
          <button type="button" class="action-btn" data-redo
            ${!controller.enabled || !controller.canRedo || controller.busy ? 'disabled' : ''}>
            ${icons.redo}<span>إعادة</span><kbd>Ctrl+Y</kbd>
          </button>
        </div>

        <div class="history-head">
          ${icons.history}
          <strong>السجل</strong>
          <small>${controller.history.length} عملية</small>
        </div>
        ${historyHtml}

        <p class="feature-note">${icons.shieldAlert}
          يُحفظ السجل في جلسة المتصفح (sessionStorage): يبقى بعد تحديث الصفحة أو الانتقال بين صفحات المنصة، ويُمسح عند إغلاق التبويب أو المتصفح. مفتاح التشغيل هو السماح بتنفيذ التراجع. في صفحة الحضور تعمل الاختصارات حتى أثناء كتابة حقل البحث.
        </p>
      </section>
    `
  }

  function renderFeatureIfNeeded(): void {
    const signature = featureStateSignature(undoRedo)
    if (signature === featureSignature) return
    featureSignature = signature
    renderFeature(undoRedo)
  }

  undoRedo.subscribe(renderFeatureIfNeeded)
  window.addEventListener('popstate', renderFeatureIfNeeded)

  function render(): void {
    shellEl.style.left = `${state.x}%`
    shellEl.style.top = `${state.y}%`
    shellEl.style.setProperty('--size', `${state.size}px`)
    flip.classList.toggle('mirrored', state.mirrored)
    spin.classList.toggle('paused', state.paused)
    spin.classList.toggle('frame-1', state.frame === 1)
    spin.classList.toggle('frame-2', state.frame === 2)
    spin.classList.toggle('frame-3', state.frame === 3)
    shellEl.classList.toggle('clickthrough', state.clickThrough)
    frames.hidden = !state.paused

    for (const btn of pillButtons) {
      const act = btn.dataset.act
      const active = (act === 'mirror' && state.mirrored)
        || (act === 'pause' && state.paused)
        || (act === 'lock' && state.locked)
        || (act === 'clickThrough' && state.clickThrough)
        || (act === 'frame' && Number(btn.dataset.frame) === state.frame)
      btn.classList.toggle('active', active)
      btn.setAttribute('aria-pressed', String(active))
    }

    const pauseBtn = pill.querySelector<HTMLButtonElement>('[data-act="pause"]')!
    pauseBtn.innerHTML = state.paused ? icons.play : icons.pause
    pauseBtn.title = state.paused ? 'تشغيل الحركة' : 'إيقاف الحركة'

    const lockBtn = pill.querySelector<HTMLButtonElement>('[data-act="lock"]')!
    lockBtn.innerHTML = state.locked ? icons.lock : icons.lockOpen
    lockBtn.title = state.locked ? 'فتح الموضع' : 'تثبيت الموضع'

    for (const tab of tabButtons) {
      tab.classList.toggle('active', tab.dataset.tab === state.activeTab)
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
      case 'clickThrough': state.clickThrough = !state.clickThrough; break
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
    state.x = clamp(startX + (dx / window.innerWidth) * 100, 4, 96)
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
      state.activeTab = tab.dataset.tab === 'bulk' ? 'bulk' : 'toggles'
      persist()
      render()
    })
  }

  featureList.addEventListener('click', (event) => {
    const btn = (event.target as Element).closest<HTMLButtonElement>('[data-feature-toggle], [data-undo], [data-redo], [data-feature-id]')
    if (!btn || btn.disabled) return
    event.stopPropagation()
    if (btn.hasAttribute('data-feature-toggle')) {
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
      const storageKey = featureId === 'center-modal'
        ? 'tamperina_center_modal'
        : featureId === 'hide-barcode'
          ? 'tamperina_barcode_hidden'
          : `tamperina_${featureId}`
      const current = localStorage.getItem(storageKey) === 'true'
      const newState = !current
      localStorage.setItem(storageKey, String(newState))
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
        && (isAttendancePage() || !isEditableTarget(event.target))) {
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
      && !isEditableTarget(event.target)
      && !(event.target as Element | null)?.closest?.('button, a, [role="button"]')) {
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
  const bulkLog = bulkRoot.querySelector<HTMLElement>('[data-bulk-log]')!
  const bulkLogCount = bulkRoot.querySelector<HTMLElement>('[data-bulk-log-count]')!
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

  let bulkParsed: ParseEntriesResult | null = null
  let bulkNameRows: NameRow[] = []
  let bulkArmed = false
  let bulkRunning = false
  let bulkResolving = false
  let bulkStop = { stop: false }
  let bulkLessonTouched = false
  let bulkLogRows: BulkRowResult[] = []
  let bulkAnalysisToken = 0
  let bulkPayMode: PaymentMode = 'center'
  // Walk-in registration preview (names with no matching code)
  let walkInPreviewOpen = false
  const walkInAmounts = new Map<string, number>()
  // Map: uppercase code → override (for school mode)
  const bulkPayOverrides = new Map<string, PaymentOverride>()

  function bulkSupported(): boolean {
    return isAttendancePage()
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
      ['default', 'افتراضي الحصة'],
      ['paid', 'كامل'],
      ['partial', 'جزئي'],
      ['discounted', 'مخفض/مجاني'],
      ['forgotten', 'نسي/مؤجل'],
    ] as const).map(([val, lbl]) =>
      `<option value="${val}" ${status === val ? 'selected' : ''}>${lbl}</option>`
    ).join('')
    return `<div class="bulk-inline-pay" data-inline-pay-code="${escapeBulk(key)}">
      <label class="bulk-inline-pay-field">
        <span>الدفع</span>
        <select class="bulk-pay-select" data-inline-pay-status="${escapeBulk(key)}">${selectOpts}</select>
      </label>
      <label class="bulk-inline-pay-field" ${needsAmount ? '' : 'hidden'} data-inline-pay-amount-wrap="${escapeBulk(key)}">
        <span>المبلغ</span>
        <input type="number" class="bulk-pay-amount" data-inline-pay-amount="${escapeBulk(key)}"
          placeholder="المبلغ" min="0" step="0.01" value="${amount != null ? escapeBulk(String(amount)) : ''}" />
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

  function renderBulkLog(): void {
    bulkLogCount.textContent = String(bulkLogRows.length)
    if (!bulkLogRows.length) {
      bulkLog.innerHTML = `<div class="history-empty">لا يوجد تنفيذ بعد.</div>`
      return
    }
    bulkLog.innerHTML = bulkLogRows.slice().reverse().map((row) => {
      const statusLabel: Record<BulkRowResult['status'], string> = {
        created: 'تم التسجيل',
        duplicate: 'موجود بالفعل',
        'skipped-known': 'متخطى (مسجّل)',
        timeout: 'انتهت المهلة',
        error: 'خطأ',
        stopped: 'متوقف',
      }
      const cls = row.status === 'created' ? 'ok'
        : row.status === 'duplicate' || row.status === 'skipped-known' ? 'warn'
        : 'err'
      const label = row.label ? `${escapeBulk(row.label)} · ` : ''
      const detail = row.recordId ? ` · #${escapeBulk(row.recordId)}` : ''
      const msg = row.message ? ` — ${escapeBulk(row.message)}` : ''
      return `<div class="bulk-log-item ${cls}">
        <span class="bulk-log-code" title="${escapeBulk(label)}${escapeBulk(row.code)}">${escapeBulk(row.code)}</span>
        <span class="bulk-log-status">${label}${statusLabel[row.status]}${detail}${msg}</span>
        <span class="bulk-log-time">${formatTime(row.at)}</span>
      </div>`
    }).join('')
  }

  function appendBulkRow(row: BulkRowResult): void {
    bulkLogRows.push(row)
    renderBulkLog()
  }

  function disarmBulk(reason?: string): void {
    bulkArmed = false
    if (reason) setBulkBadge(reason, 'off')
  }

  function allExecutableEntries(): Array<{ code: string, label?: string }> {
    if (!bulkParsed) return []
    const result: Array<{ code: string, label?: string }> = []
    for (const item of bulkParsed.codes) result.push({ code: item.code, label: item.raw })
    for (const row of bulkNameRows) {
      if (row.status === 'dropped') continue
      if (row.status === 'resolved' && row.code) {
        result.push({ code: row.code.toUpperCase(), label: row.studentName ?? row.query })
      }
    }
    return result
  }

  /** Same student can appear as a code and as a resolved name — submit them once. */
  function executableEntries(): Array<{ code: string, label?: string }> {
    const seen = new Set<string>()
    return allExecutableEntries().filter((entry) => {
      const code = entry.code.toUpperCase()
      if (seen.has(code)) return false
      seen.add(code)
      return true
    })
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

  function waitForWalkInState(stateEl: HTMLElement, timeoutMs = 12000): Promise<string> {
    const initial = (stateEl.textContent || '').trim()
    if (initial && !/جار|جرى|جاري|loading|processing/i.test(initial)) {
      return Promise.resolve(initial)
    }
    return new Promise((resolve) => {
      let done = false
      const finish = (text: string): void => {
        if (done) return
        done = true
        observer.disconnect()
        window.clearTimeout(timer)
        resolve(text)
      }
      const read = (): string => (stateEl.textContent || '').trim()
      const observer = new MutationObserver(() => {
        const text = read()
        if (text && !/جار|جرى|جاري|loading|processing/i.test(text)) finish(text)
      })
      observer.observe(stateEl, { childList: true, subtree: true, characterData: true })
      const timer = window.setTimeout(() => finish(read() || 'انتهى الإرسال — راجع الصفحة.'), timeoutMs)
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
      toast({ title: 'النموذج غير موجود', description: 'افتح لوحة «طلاب جدد بدون كارت» في صفحة الحضور أولًا.', variant: 'warning' })
      return
    }
    if (!ensureWalkInFormVisible(form)) {
      toast({ title: 'اللوحة مخفية', description: 'افتح لوحة «طلاب جدد بدون كارت» يدويًا ثم حاول مجددًا.', variant: 'warning' })
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
      toast({ title: 'تعذّر تجهيز النموذج', description: 'لم يتمكن تمبرينا من إضافة عدد الصفوف المطلوب.', variant: 'warning' })
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
      toast({ title: 'تعذّر الإرسال', description: 'زر «تسجيل الطلاب والتحصيل» غير موجود.', variant: 'warning' })
      return
    }
    submitBtn.click()
    const stateText = await waitForWalkInState(stateEl)

    const failed = /خطأ|فشل|تعذّر|تعذر|غير صالح|لم يتم|لم تُسجّل|لم تسجل|error|failed/i.test(stateText)
    if (failed) {
      toast({ title: 'تعذّر تسجيل الطلاب الجدد', description: stateText, variant: 'error', duration: 9000 })
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
        label: 'طالب جديد بدون كارت',
        status: 'created',
        message: stateText,
        at: now,
      })
    }
    walkInPreviewOpen = false
    bulkArmed = false
    renderBulkAnalysis()
    toast({
      title: 'تم تسجيل الطلاب الجدد',
      description: `${rows.length} طالب — ${stateText}. لا يمكن التراجع عنها، وقد استُبعدت من دفعة الحضور.`,
      variant: 'applied',
      duration: 9000,
    })
  }

  function readyToArm(): boolean {
    if (!bulkParsed) return false
    if (bulkResolving) return false
    const exec = executableEntries()
    if (!exec.length) return false
    if (unresolvedNameRows().length) return false
    return true
  }

  function renderBulkResolve(): void {
    if (bulkParsed && bulkPayMode === 'school') seedPaymentOverridesFromParsed()

    const nameRows = bulkNameRows
    // Ignored rows deliberately remain at the top with the unresolved ones so
    // "نسخ" still includes them (e.g. ignore all, then copy to handle manually).
    const undecided = pendingNameRows()
    const decidedNames = nameRows.filter((row) =>
      row.status === 'resolved' || row.status === 'walk-in')
    const codeItems = (bulkPayMode === 'school' && bulkParsed) ? bulkParsed.codes : []
    if (!nameRows.length && !codeItems.length) {
      bulkResolveBox.hidden = true
      bulkResolveBox.innerHTML = ''
      return
    }

    const renderNameRow = (row: NameRow): string => {
      const statusText: Record<NameRow['status'], string> = {
        ready: 'جاهز',
        resolved: row.studentName ? `تم التعرف: ${row.studentName}${row.code ? ` (${row.code})` : ''}` : 'تم التعرف',
        ambiguous: 'الاسم غامض أو مشترك — اختر الطالب الصحيح',
        'not-found': 'لم يتم العثور على الاسم',
        'too-many': 'نتائج كثيرة جدًا',
        dropped: 'تم التجاهل — ستدخله يدويًا',
        'walk-in': row.message ? `تم تسجيله طالبًا جديدًا — ${row.message}` : 'تم تسجيله طالبًا جديدًا بدون كارت',
        loading: 'جارٍ البحث…',
        error: 'تعذّر البحث',
      }
      const cls = row.status === 'resolved' || row.status === 'walk-in' ? 'ok'
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
              ${chosen ? '<span class="bulk-choice-mark">✓ المُختار — سيُسجَّل في الحضور</span>' : ''}
              <span>${escapeBulk(c.name || 'طالب')}</span>
            </span>
            <small>${escapeBulk(c.code || 'بدون كود')}</small>
          </button>`
        }
        if (row.status === 'resolved') {
          const chosen = list.filter(isChosen)
          const others = list.filter((c) => !isChosen(c))
          if (chosen.length) {
            choicesHtml += `<div class="bulk-resolve-chosen-note">الطالب المُختار الذي سيُسجَّل:</div>
              <div class="bulk-resolve-choices chosen-group">${chosen.map(choiceButton).join('')}</div>`
          }
          if (others.length) {
            choicesHtml += `<div class="bulk-resolve-chosen-note muted">نتائج أخرى — غير مختارة (اضغط لتبديل الاختيار):</div>
              <div class="bulk-resolve-choices other-group">${others.map(choiceButton).join('')}</div>`
          }
        } else {
          choicesHtml = `<div class="bulk-resolve-choices">${list.map(choiceButton).join('')}</div>`
        }
        if (row.candidates.length > 12) {
          choicesHtml += `<div class="bulk-note-inline">+${row.candidates.length - 12} نتائج أخرى</div>`
        }
      }

      const editHtml = row.status === 'dropped' || row.status === 'walk-in' ? '' : `<div class="bulk-inline-edit" ${row.status === 'resolved' ? 'hidden' : ''}>
          <input type="text" class="bulk-input" data-resolve-edit="${escapeBulk(row.key)}" value="${escapeBulk(row.query)}" placeholder="عدّل الاسم ثم أعد البحث" />
          <button type="button" class="bulk-mini-btn" data-resolve-action="research" data-key="${escapeBulk(row.key)}">إعادة بحث</button>
        </div>`

      const actions = row.status === 'dropped' || row.status === 'walk-in'
        ? `<div class="bulk-resolve-actions"><button type="button" class="bulk-mini-btn" data-resolve-action="undrop" data-key="${escapeBulk(row.key)}">استرجاع</button></div>`
        : `<div class="bulk-resolve-actions">
            ${row.status === 'resolved' ? `<button type="button" class="bulk-mini-btn" data-resolve-action="change" data-key="${escapeBulk(row.key)}">تغيير</button>` : ''}
            <button type="button" class="bulk-mini-btn" data-resolve-action="drop" data-key="${escapeBulk(row.key)}">تجاهل (يدويًا)</button>
          </div>`

      const reason = row.message && row.status !== 'resolved' ? `<div class="bulk-resolve-reason">${escapeBulk(row.message)}</div>` : ''
      const pay = (row.status === 'resolved' && row.code) ? renderInlinePaymentControls(row.code) : ''

      return `<div class="bulk-resolve-item ${cls}" data-resolve-key="${escapeBulk(row.key)}">
        <div class="bulk-resolve-head">
          <span class="bulk-resolve-name">${escapeBulk(row.raw)}</span>
          <span class="feature-badge ${row.status === 'resolved' ? 'on' : row.status === 'dropped' ? 'off' : 'busy'}">${escapeBulk(statusText[row.status])}</span>
        </div>
        ${reason}
        ${choicesHtml}
        ${row.status === 'loading' ? '' : editHtml}
        ${row.status === 'loading' ? '' : actions}
        ${pay}
      </div>`
    }

    let html = ''

    if (undecided.length) {
      const undecidedText = undecided.map((row) => row.raw || row.query).join('\n')
      html += `<div class="bulk-undecided-section">
        <div class="bulk-undecided-head">
          <div class="bulk-undecided-title">
            <strong>طلاب غير محلولين / مُتجاهَلين</strong>
            <span class="feature-badge busy">${undecided.length}</span>
          </div>
          <div class="bulk-resolve-actions">
            <button type="button" class="bulk-mini-btn" data-bulk-copy-undecided data-copy-text="${escapeBulk(undecidedText)}">نسخ</button>
            <button type="button" class="bulk-mini-btn" data-resolve-action="drop-all">تجاهل الكل</button>
            <button type="button" class="bulk-mini-btn" data-walkin-toggle aria-expanded="${walkInPreviewOpen}">تسجيل طلاب جدد بدون كارت</button>
          </div>
        </div>
        <div class="bulk-note-inline">التجاهل يُبقي الاسم هنا ويُخرجه فقط من دفعة الحضور — يمكنك نسخ القائمة كاملة للتعامل معها يدويًا، أو تسجيل الأسماء كطلاب جدد عبر نموذج الصفحة.</div>
        <div class="bulk-walkin-panel" data-walkin-panel ${walkInPreviewOpen ? '' : 'hidden'}>
          <div class="bulk-warn">سيتم إنشاء طلاب جدد وتسجيل التحصيل في حصة المدرسة عبر نموذج الصفحة. هذه التسجيلات <strong>لا يمكن التراجع عنها</strong>، وستُستبعد من دفعة الحضور الحالية. المبلغ الافتراضي 45 ويمكن تعديله لكل طالب.</div>
          <div class="bulk-walkin-rows">
            ${undecided.map((row) => `<div class="bulk-walkin-row">
              <span title="${escapeBulk(row.raw)}">${escapeBulk(row.query || row.raw)}</span>
              <input type="number" class="bulk-input" inputmode="decimal" min="0" max="999999.99" step="0.01"
                data-walkin-amount-key="${escapeBulk(row.key)}" value="${formatWalkInAmount(walkInAmountFor(row))}"
                aria-label="المبلغ المدفوع لـ ${escapeBulk(row.query || row.raw)}" />
            </div>`).join('')}
          </div>
          <div class="bulk-resolve-actions">
            <button type="button" class="bulk-mini-btn" data-walkin-confirm>تسجيل الطلاب والتحصيل</button>
            <button type="button" class="bulk-mini-btn" data-walkin-cancel>إلغاء</button>
          </div>
        </div>
        ${undecided.map(renderNameRow).join('')}
      </div>`
    }

    if (codeItems.length) {
      html += `<div class="bulk-resolve-group">`
      html += codeItems.map((item) => {
        const pay = renderInlinePaymentControls(item.code)
        const paymentNote = item.payment
          ? `<div class="bulk-note-inline">من الإدخال: ${escapeBulk(item.payment.status === 'paid' ? 'كامل' : item.payment.status === 'partial' ? 'جزئي' : item.payment.status === 'discounted' ? 'مخفض/مجاني' : 'نسي الفلوس')}${item.payment.amountPaid != null ? ` — ${escapeBulk(String(item.payment.amountPaid))}` : ''}</div>`
          : ''
        return `<div class="bulk-resolve-item ok" data-code-item="${escapeBulk(item.code)}">
          <div class="bulk-resolve-head">
            <span class="bulk-resolve-name" dir="ltr">${escapeBulk(item.raw || item.code)}</span>
            <span class="feature-badge on">${escapeBulk(item.code)}</span>
          </div>
          ${paymentNote}
          ${pay}
        </div>`
      }).join('')
      html += `</div>`
    }

    if (decidedNames.length) {
      html += `<div class="bulk-resolve-group">${decidedNames.map(renderNameRow).join('')}</div>`
    }

    bulkResolveBox.hidden = false
    bulkResolveBox.innerHTML = html
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

    if (!supported) {
      setBulkBadge('خارج صفحة الحضور', 'off')
    } else if (bulkRunning) {
      setBulkBadge('جارٍ التنفيذ', 'busy')
    } else if (bulkResolving) {
      setBulkBadge('جارٍ التحليل', 'busy')
    } else if (bulkArmed) {
      setBulkBadge('مسلّح', 'on')
    } else if (unresolvedNameRows().length) {
      setBulkBadge('يتطلب قرارًا', 'busy')
    } else {
      setBulkBadge('جاهز', 'off')
    }
  }

  function refreshBulkLesson(force = false): void {
    if (bulkLessonTouched && !force) return
    const lessonId = currentLessonIdFromPage()
    if (lessonId) bulkLessonInput.value = String(lessonId)
  }

  function renderBulkAnalysisSummary(): void {
    if (!bulkParsed) {
      bulkPreviewBox.textContent = 'لم تتم المعاينة بعد.'
      return
    }

    if (!bulkSupported()) {
      bulkPreviewBox.innerHTML = `<div class="bulk-warn">افتح صفحة <code>/attendance/scan</code> أولًا.</div>`
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

    const parts: string[] = []
    parts.push(`<div class="bulk-preview-grid">
      <div><strong>الحصة المستهدفة</strong><span>${escapeHtml(lessonId ?? 'غير محددة')}</span></div>
      <div><strong>الحصة المفتوحة</strong><span>${escapeHtml(pageLessonId ?? 'غير معروفة')}</span></div>
      <div><strong>حقل الإدخال</strong><span dir="ltr">${escapeHtml(scan?.inputSelector ?? 'غير معروف')}</span></div>
      <div><strong>أكواد مباشرة</strong><span>${bulkParsed.codes.length}</span></div>
      <div><strong>أسماء (تم التعرف)</strong><span>${resolvedNames}/${bulkParsed.names.length}</span></div>
      <div><strong>تحتاج قرارًا</strong><span>${unresolved.length}</span></div>
      <div><strong>تم تجاهلها</strong><span>${dropped}</span></div>
      <div><strong>سُجّلت كطلاب جدد</strong><span>${walkInCount}</span></div>
      <div><strong>جاهزة للإرسال</strong><span>${exec.length}</span></div>
      <div><strong>مكررة</strong><span>${bulkParsed.duplicates.length + duplicateEntryCount()}</span></div>
      <div><strong>نوع الحصة</strong><span>${bulkPayMode === 'school' ? 'مدرسة' : 'سنتر'}</span></div>
      <div><strong>غير صالحة</strong><span>${bulkParsed.invalid.length}</span></div>
    </div>`)

    if (!scan) {
      parts.push(`<div class="bulk-warn">تعذّر العثور على نموذج الحضور أو حقل الإدخال.</div>`)
    }
    if (pageLessonId && lessonId && String(lessonId) !== String(pageLessonId)) {
      parts.push(`<div class="bulk-warn">رقم الحصة المدخل (${escapeHtml(lessonId)}) يختلف عن الحصة المفتوحة (${escapeHtml(pageLessonId)}). افتح الحصة المطلوبة أولًا قبل التنفيذ.</div>`)
    }
    if (bulkParsed.invalid.length) {
      parts.push(`<div class="bulk-warn">قيم غير صالحة سيتم تجاهلها: ${bulkParsed.invalid.slice(0, 12).map(escapeHtml).join('، ')}${bulkParsed.invalid.length > 12 ? '…' : ''}</div>`)
    }
    if (bulkParsed.duplicates.length) {
      parts.push(`<div class="bulk-note-inline">أكواد مكررة أُزيلت: ${bulkParsed.duplicates.slice(0, 12).map(escapeHtml).join('، ')}${bulkParsed.duplicates.length > 12 ? '…' : ''}</div>`)
    }
    if (unresolved.length) {
      parts.push(`<div class="bulk-warn">يوجد ${unresolved.length} اسم يحتاج قرارًا (اختيار/تعديل/تجاهل) قبل التسليح.</div>`)
    }
    if (!undoRedo.enabled) {
      parts.push(`<div class="bulk-warn">ميزة التراجع متوقفة؛ فعّلها أولًا ليتم تسجيل الدفعة كتراجع واحد.</div>`)
    }
    if (!exec.length && !bulkResolving) {
      parts.push(`<div class="bulk-warn">لا توجد عناصر جاهزة للإرسال.</div>`)
    }
    if (duplicateEntryCount()) {
      parts.push(`<div class="bulk-note-inline">تم توحيد ${duplicateEntryCount()} طالب ظهر أكثر من مرة (كود + اسم مثلًا) — سيُرسل مرة واحدة.</div>`)
    }
    parts.push(bulkPayMode === 'school'
      ? `<div class="bulk-note-inline">وضع المدرسة: يُرسل الدفع فقط لمن له بيان دفع صريح. بدون بيان يُترك الحضور على إعداد الحصة الافتراضي في المنصة. الصيغ: كود/اسم [، مبلغ] [، الحالة].</div>`
      : `<div class="bulk-note-inline">وضع السنتر: يُستخدم نموذج المسح كما هو، وأي بيانات دفع في النص تُتجاهل. الأسماء تُطابق ضمن طلاب الحصة المفتوحة.</div>`)

    bulkPreviewBox.innerHTML = parts.join('')
  }

  function renderBulkAnalysis(): void {
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
    bulkArmed = false
    bulkPayOverrides.clear()
    bulkPreviewBox.textContent = 'تم تعديل البيانات — أعد المعاينة والتحليل قبل التنفيذ.'
    bulkResolveBox.hidden = true
    bulkResolveBox.innerHTML = ''
    updateBulkButtons()
  }

  async function analyzeBulkInput(): Promise<void> {
    if (!bulkSupported()) {
      bulkParsed = null
      bulkNameRows = []
      renderBulkAnalysis()
      disarmBulk('غير متاح')
      return
    }

    const token = ++bulkAnalysisToken
    const lessonId = bulkLessonInput.value.trim() || currentLessonIdFromPage() || ''
    bulkParsed = parseBulkEntries(bulkCodesInput.value)
    bulkNameRows = bulkParsed.names.map((entry) => ({
      kind: 'name',
      key: entry.key,
      raw: entry.raw,
      query: entry.query,
      status: lessonId ? 'loading' : 'error',
      candidates: [],
      message: lessonId ? 'جارٍ البحث…' : 'حدد رقم الحصة أولًا.',
      payment: entry.payment,
    }))
    bulkArmed = false
    bulkPayOverrides.clear()
    seedPaymentOverridesFromParsed()
    bulkResolving = bulkNameRows.length > 0 && !!lessonId
    renderBulkAnalysis()

    if (!lessonId) {
      bulkResolving = false
      renderBulkAnalysis()
      return
    }

    for (let i = 0; i < bulkNameRows.length; i++) {
      if (token !== bulkAnalysisToken) return
      const current = bulkNameRows[i]
      const resolved = await resolveNameEntry(current, lessonId)
      if (token !== bulkAnalysisToken) return
      // Preserve pending payment info from original name row
      bulkNameRows[i] = { ...resolved, payment: current.payment }
      if (bulkNameRows[i].payment && bulkNameRows[i].status === 'resolved' && bulkNameRows[i].code) {
        const code = bulkNameRows[i].code!.toUpperCase()
        if (!bulkPayOverrides.has(code)) {
          bulkPayOverrides.set(code, {
            studentCode: code,
            status: bulkNameRows[i].payment!.status,
            amountPaid: bulkNameRows[i].payment!.amountPaid,
          })
        }
      }
      renderBulkAnalysis()
    }

    if (token !== bulkAnalysisToken) return
    bulkResolving = false
    renderBulkAnalysis()
  }

  async function reResolveNameRow(key: string, nextQuery: string): Promise<void> {
    const lessonId = bulkLessonInput.value.trim() || currentLessonIdFromPage() || ''
    if (!lessonId) return
    const index = bulkNameRows.findIndex((row) => row.key === key)
    if (index < 0) return
    const token = ++bulkAnalysisToken
    bulkArmed = false
    bulkNameRows[index] = { ...bulkNameRows[index], query: nextQuery.trim() || bulkNameRows[index].query, status: 'loading', message: 'جارٍ البحث…' }
    renderBulkAnalysis()
    const payment = bulkNameRows[index].payment
    const resolved = await resolveNameEntry(bulkNameRows[index], lessonId)
    if (token !== bulkAnalysisToken) return
    bulkNameRows[index] = { ...resolved, payment }
    if (payment && bulkNameRows[index].status === 'resolved' && bulkNameRows[index].code) {
      const code = bulkNameRows[index].code!.toUpperCase()
      if (!bulkPayOverrides.has(code)) {
        bulkPayOverrides.set(code, { studentCode: code, status: payment.status, amountPaid: payment.amountPaid })
      }
    }
    renderBulkAnalysis()
  }

  async function executeBulk(): Promise<void> {
    if (bulkRunning || !bulkArmed || !bulkParsed) return
    if (!bulkSupported()) return

    const scan = detectScanForm()
    if (!scan) {
      toast({ title: 'تعذّر التنفيذ', description: 'لم يُعثر على نموذج الحضور.', variant: 'error' })
      return
    }

    const targetLesson = bulkLessonInput.value.trim() || currentLessonIdFromPage() || ''
    const pageLesson = scan.lessonId ?? currentLessonIdFromPage() ?? ''
    if (targetLesson && pageLesson && String(targetLesson) !== String(pageLesson)) {
      toast({
        title: 'الحصة غير متطابقة',
        description: `افتح الحصة رقم ${targetLesson} أولًا ثم أعد المحاولة.`,
        variant: 'warning',
        duration: 7000,
      })
      return
    }

    if (unresolvedNameRows().length) {
      toast({ title: 'يوجد أسماء غير محلولة', description: 'اختر الطالب الصحيح أو عدّل الاسم أو تجاهله.', variant: 'warning' })
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
          title: 'مبلغ غير مكتمل',
          description: `أدخل المبلغ المدفوع للحالات الجزئية/المخفضة (كود ${missingAmount.studentCode}).`,
          variant: 'warning',
        })
        return
      }
    }

    if (!undoRedo.enabled) {
      toast({ title: 'فعّل التراجع أولًا', description: 'لا يمكن تسجيل دفعة قابلة للإلغاء والتراجع معطل.', variant: 'warning' })
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
    renderBulkLog()
    disarmBulk()
    updateBulkButtons()

    undoRedo.beginBatch('تسجيل حضور جماعي')
    try {
      const summary = await runBulkAttendance({
        entries,
        signal: bulkStop,
        onRow: appendBulkRow,
        paymentMode: bulkPayMode,
        paymentOverrides,
        lessonId,
      })

      const recordedBeforeCommit = undoRedo.batchCount
      const committed = undoRedo.commitBatch({
        title: `تسجيل حضور جماعي (${summary.created})`,
        detail: `تم ${summary.created} · موجود ${summary.duplicates} · متخطى ${summary.skipped} · فشل ${summary.failed}${summary.stopped ? ' · متوقف' : ''}`,
      })

      if (!committed && summary.created > 0) {
        toast({
          title: 'اكتمل التنفيذ بدون سجل تراجع',
          description: `لم يُسجَّل أي إجراء قابل للإلغاء (أُكّد ${summary.created} تسجيل، لكن السجل لم يحتوِ على إجراءات). استخدم تشخيص التراجع لعرض الطلبات المرصودة.`,
          variant: 'warning',
          duration: 9000,
        })
        console.warn('[Tamperina] bulk batch had no recorded actions', {
          created: summary.created,
          recordedBeforeCommit,
          debug: undoRedo.debug(),
        })
      } else if (summary.created > 0) {
        toast({
          title: 'اكتمل التسجيل الجماعي',
          description: `تم تسجيل ${summary.created} طالب. يمكن التراجع عن الدفعة كاملة بـ Ctrl+Z.`,
          variant: 'applied',
          duration: 7000,
        })
      } else if (summary.stopped && summary.failed > 0) {
        toast({
          title: 'توقف التنفيذ',
          description: 'تحقق من السجل لمعرفة السبب.',
          variant: 'warning',
        })
      } else {
        toast({
          title: 'لا توجد سجلات جديدة',
          description: 'جميع العناصر كانت مسجلة أو تم تخطيها.',
          variant: 'info',
        })
      }

      renderBulkAnalysisSummary()
    } catch (error) {
      undoRedo.commitBatch({
        title: `تسجيل حضور جماعي (${undoRedo.batchCount})`,
        detail: 'انتهى التنفيذ بخطأ',
      })
      toast({
        title: 'حدث خطأ أثناء التنفيذ',
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
  bulkArmBtn.addEventListener('click', () => {
    if (!readyToArm()) {
      void analyzeBulkInput()
      return
    }
    bulkArmed = true
    setBulkBadge('مسلّح', 'on')
    updateBulkButtons()
    toast({
      title: 'التنفيذ مسلّح',
      description: 'اضغط تنفيذ للبدء. أي تعديل على البيانات سيلغي التسليح.',
      variant: 'warning',
    })
  })
  bulkRunBtn.addEventListener('click', () => { void executeBulk() })
  bulkStopBtn.addEventListener('click', () => {
    if (!bulkRunning) return
    bulkStop.stop = true
    setBulkBadge('جارٍ الإيقاف', 'busy')
    toast({ title: 'سيتم الإيقاف', description: 'سيتوقف التنفيذ بعد الطالب الحالي.', variant: 'warning' })
  })

  bulkCodesInput.addEventListener('input', invalidateBulkAnalysis)
  bulkLessonInput.addEventListener('input', () => { bulkLessonTouched = true; invalidateBulkAnalysis() })

  exportRefreshBtn.addEventListener('click', refreshAttendanceExport)
  exportCopyBtn.addEventListener('click', () => { void copyAttendanceExport() })
  exportDownloadBtn.addEventListener('click', downloadAttendanceExport)
  exportLessonInput.addEventListener('input', refreshAttendanceExport)

  function updateBulkInputPlaceholder(): void {
    if (bulkPayMode === 'school') {
      bulkCodesInput.placeholder = [
        'كود أو اسم [، مبلغ] [، حالة] (, أو ،) — مبلغ بلا حالة = جزئي، بدونه = افتراضي الحصة',
        'الحالات: كامل | جزئي | مخفض/مجاني | نسي/مؤجل',
        '2017, 45, كامل',
        '2016, 10, مخفض',
        '2015, مخفض, 10',
        'أحمد محمد, 0, نسي',
        '2018, 30',
        '2019',
        'أحمد محمد',
      ].join('\n')
    } else {
      bulkCodesInput.placeholder = 'كود أو اسم في كل سطر (الدفع يُتجاهل هنا):\n2349\nأحمد محمد\n2351'
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
        'تم النسخ',
        'تم نسخ قائمة الطلاب (بما فيها المتجاهَلون).',
      )
      return
    }

    const btn = (event.target as Element).closest<HTMLButtonElement>('[data-resolve-action]')
    if (!btn) return
    const action = btn.dataset.resolveAction

    if (action === 'drop-all') {
      let changed = false
      bulkNameRows = bulkNameRows.map((row) => {
        if (row.status === 'resolved' || row.status === 'dropped' || row.status === 'walk-in') return row
        changed = true
        return { ...row, status: 'dropped' as const, message: 'تم التجاهل — سيتم إدخاله يدويًا.' }
      })
      if (changed) {
        bulkArmed = false
        renderBulkAnalysis()
      }
      return
    }

    const key = btn.dataset.key || ''
    const index = bulkNameRows.findIndex((row) => row.key === key)
    if (index < 0) return

    if (action === 'choose') {
      const code = (btn.dataset.code || '').toUpperCase()
      const name = btn.dataset.name || ''
      if (!code) {
        toast({ title: 'لا يوجد كود', description: 'لا يمكن اختيار طالب بدون كود صالح.', variant: 'warning' })
        return
      }
      bulkNameRows[index] = {
        ...bulkNameRows[index],
        status: 'resolved',
        code,
        studentName: name,
        message: `تم الاختيار: ${name}${code ? ` (${code})` : ''}`,
      }
      bulkArmed = false
      renderBulkAnalysis()
      return
    }

    if (action === 'drop') {
      bulkNameRows[index] = { ...bulkNameRows[index], status: 'dropped', message: 'تم التجاهل — سيتم إدخاله يدويًا.' }
      bulkArmed = false
      renderBulkAnalysis()
      return
    }

    if (action === 'undrop' || action === 'change') {
      const nextStatus = bulkNameRows[index].candidates.length ? 'ambiguous' : 'not-found'
      bulkNameRows[index] = {
        ...bulkNameRows[index],
        status: nextStatus,
        code: undefined,
        studentName: undefined,
        message: undefined,
      }
      bulkArmed = false
      renderBulkAnalysis()
      return
    }

    if (action === 'research') {
      const edit = bulkResolveBox.querySelector<HTMLInputElement>(`[data-resolve-edit="${CSS.escape(key)}"]`)
      const nextQuery = edit?.value.trim() || bulkNameRows[index].query
      void reResolveNameRow(key, nextQuery)
    }
  })

  // Prefill lesson and keep bulk controls in sync with undoRedo state.
  refreshBulkLesson()
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
      toast({ title: 'تعذّر النسخ', description: 'انسخ النص يدويًا من مربع النص.', variant: 'warning' })
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
    exportCount.textContent = `${count} طالب`
    exportCount.classList.toggle('off', count === 0)
    exportCount.classList.toggle('on', count > 0)
    exportSummary.textContent = lesson ? `حصة ${lesson} · ${total} سجل محفوظ` : `${total} سجل محفوظ`
  }

  async function copyAttendanceExport(): Promise<void> {
    const text = exportTextarea.value.trim()
    if (!text) {
      toast({ title: 'لا توجد قائمة', description: 'لا توجد سجلات حضور لتصديرها.', variant: 'warning' })
      return
    }
    await copyPlainText(text, 'تم النسخ', 'تم نسخ قائمة الحاضرين (الكود والاسم).')
  }

  function downloadAttendanceExport(): void {
    const text = exportTextarea.value.trim()
    if (!text) {
      toast({ title: 'لا توجد قائمة', description: 'لا توجد سجلات حضور لتصديرها.', variant: 'warning' })
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
      toast({ title: 'تم التنزيل', description: filename, variant: 'applied' })
    } catch {
      toast({ title: 'تعذّر التنزيل', description: 'انسخ القائمة يدويًا من مربع النص.', variant: 'warning' })
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

  let evalParsed: ParseEvalResult | null = null
  let evalRows: EvalWorkRow[] = []
  let evalArmed = false
  let evalRunning = false
  let evalStop = { stop: false }
  let evalLogRows: EvalRowResult[] = []
  let evalAnalysisToken = 0

  function evalSupported(): boolean {
    return isEvaluationPage()
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

  function renderEvalLog(): void {
    evalLogCount.textContent = String(evalLogRows.length)
    if (!evalLogRows.length) {
      evalLog.innerHTML = `<div class="history-empty">لا يوجد تنفيذ بعد.</div>`
      return
    }
    const statusLabel: Record<EvalRowStatus, string> = {
      applied: 'تم التطبيق',
      partial: 'تم جزئيًا',
      'not-found': 'غير موجود',
      'missing-field': 'حقل مفقود',
      invalid: 'غير صالح',
      error: 'خطأ',
      stopped: 'متوقف',
      skipped: 'متخطى',
    }
    evalLog.innerHTML = evalLogRows.slice().reverse().map((row) => {
      const cls = row.status === 'applied' ? 'ok'
        : row.status === 'partial' ? 'warn'
        : row.status === 'stopped' || row.status === 'skipped' ? 'warn'
        : 'err'
      const msg = row.message ? ` — ${escapeHtml(row.message)}` : ''
      return `<div class="bulk-log-item ${cls}">
        <span class="bulk-log-code" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span>
        <span class="bulk-log-status">${statusLabel[row.status]}${msg}</span>
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
    if (evalRunning) return false
    if (!evalExecutableRows().length) return false
    if (evalRows.some((row) => evalNeedsDecision(row))) return false
    return true
  }

  function formatEvalValues(values: EvalValues | null): string {
    if (!values) return '—'
    const parts: string[] = []
    if (values.exam != null) parts.push(`امتحان: ${values.exam}`)
    if (values.homework != null) parts.push(`واجب: ${values.homework}`)
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
      const statusText = row.identityStatus === 'dropped' ? 'تم التجاهل'
        : row.ambiguousNumbers && !row.numberMap ? 'رقمان — اختر: أيهما الامتحان وأيهما الواجب؟'
        : identityOk
          ? `${formatEvalLabel(row.code, row.studentName, row.identifier)} — ${formatEvalValues(eff)}`
          : row.identityStatus === 'ambiguous' ? 'الاسم غامض — اختر الطالب الصحيح'
          : row.identityStatus === 'not-found' ? 'لم يُعثر على الطالب في صفحة التقييم'
          : row.identityStatus === 'too-many' ? 'نتائج كثيرة جدًا'
          : row.identityStatus === 'error' ? 'تعذّر التحليل'
          : row.message || 'يحتاج قرارًا'

      const badgeCls = identityOk && !(row.ambiguousNumbers && !row.numberMap) ? 'on'
        : row.identityStatus === 'dropped' ? 'off'
        : 'busy'

      let choicesHtml = ''
      if (row.identityStatus !== 'dropped' && row.candidates.length) {
        const list = row.candidates.slice(0, 12)
        choicesHtml = `<div class="bulk-resolve-choices">${list.map((c) => {
          const chosen = identityOk && row.code && c.code === row.code
          return `<button type="button" class="bulk-choice ${chosen ? 'selected' : ''}"
            data-eval-action="choose" data-key="${escapeHtml(row.key)}"
            data-code="${escapeHtml(c.code)}" data-name="${escapeHtml(c.name)}">
            <span>${escapeHtml(c.name || 'طالب')}</span>
            <small dir="ltr">${escapeHtml(c.code || 'بدون كود')}</small>
          </button>`
        }).join('')}${row.candidates.length > 12 ? `<div class="bulk-note-inline">+${row.candidates.length - 12} نتائج أخرى</div>` : ''}</div>`
      }

      let numberChoiceHtml = ''
      if (row.ambiguousNumbers && row.numberTokens) {
        const [a, b] = row.numberTokens
        numberChoiceHtml = `<div class="bulk-note-inline">رقمان (${escapeHtml(a)}، ${escapeHtml(b)}) — حدّد الترتيب:</div>
          <div class="bulk-resolve-actions">
            <button type="button" class="bulk-mini-btn ${row.numberMap === 'exam-homework' ? 'active' : ''}" data-eval-action="map" data-key="${escapeHtml(row.key)}" data-map="exam-homework">الأول امتحان (${escapeHtml(a)}) · الثاني واجب (${escapeHtml(b)})</button>
            <button type="button" class="bulk-mini-btn ${row.numberMap === 'homework-exam' ? 'active' : ''}" data-eval-action="map" data-key="${escapeHtml(row.key)}" data-map="homework-exam">الأول واجب (${escapeHtml(a)}) · الثاني امتحان (${escapeHtml(b)})</button>
          </div>`
      }

      const showEdit = row.identityStatus !== 'dropped'
      const editHtml = showEdit ? `<div class="bulk-inline-edit" ${(identityOk && !(row.ambiguousNumbers && !row.numberMap)) ? 'hidden' : ''}>
          <input type="text" class="bulk-input" data-eval-edit="${escapeHtml(row.key)}" value="${escapeHtml(row.query)}" placeholder="عدّل المعرّف ثم أعد المطابقة" />
          <button type="button" class="bulk-mini-btn" data-eval-action="rematch" data-key="${escapeHtml(row.key)}">إعادة مطابقة</button>
        </div>` : ''

      const actions = row.identityStatus === 'dropped'
        ? `<div class="bulk-resolve-actions"><button type="button" class="bulk-mini-btn" data-eval-action="undrop" data-key="${escapeHtml(row.key)}">استرجاع</button></div>`
        : `<div class="bulk-resolve-actions">
            ${identityOk ? `<button type="button" class="bulk-mini-btn" data-eval-action="change" data-key="${escapeHtml(row.key)}">تغيير الطالب</button>` : ''}
            <button type="button" class="bulk-mini-btn" data-eval-action="drop" data-key="${escapeHtml(row.key)}">تجاهل</button>
          </div>`

      const reason = row.message && !identityOk ? `<div class="bulk-resolve-reason">${escapeHtml(row.message)}</div>` : ''
      const valuesNote = (identityOk && eff) ? `<div class="bulk-note-inline">القيم: ${escapeHtml(formatEvalValues(eff))}</div>` : ''

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
            <strong>عناصر تحتاج قرارًا</strong>
            <span class="feature-badge busy">${undecided.length}</span>
          </div>
          <div class="bulk-resolve-actions">
            <button type="button" class="bulk-mini-btn" data-eval-action="drop-all-unresolved">تجاهل غير المحلولين</button>
          </div>
        </div>
        <div class="bulk-note-inline">حلّ غموض الطالب/الأرقام أو تجاهل العنصر للمتابعة بالباقي.</div>
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
      evalPreviewBox.textContent = 'لم تتم المعاينة بعد.'
      evalResolveBox.hidden = true
      evalResolveBox.innerHTML = ''
      updateEvalBulkButtons()
      return
    }
    if (!evalSupported()) {
      evalPreviewBox.innerHTML = `<div class="bulk-warn">افتح صفحة <code>/evaluation</code> التي تحتوي جدول الطلاب أولًا.</div>`
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
      <div><strong>أسطر صالحة</strong><span>${evalParsed.entries.length}</span></div>
      <div><strong>جاهزة للتنفيذ</strong><span>${exec.length}</span></div>
      <div><strong>تحتاج قرارًا</strong><span>${needs}</span></div>
      <div><strong>أرقام غامضة</strong><span>${numbersAmb}</span></div>
      <div><strong>متجاهَلة</strong><span>${dropped}</span></div>
      <div><strong>غير صالحة</strong><span>${evalParsed.invalid.length}</span></div>
      <div><strong>مكررة</strong><span>${evalParsed.duplicates.length}</span></div>
    </div>`)
    if (!evalParsed.entries.length) parts.push(`<div class="bulk-warn">لا توجد أسطر صالحة للتحليل.</div>`)
    if (evalParsed.invalid.length) parts.push(`<div class="bulk-warn">أسطر غير صالحة سيتم تجاهلها: ${evalParsed.invalid.slice(0, 8).map(escapeHtml).join('، ')}${evalParsed.invalid.length > 8 ? '…' : ''}</div>`)
    if (numbersAmb) parts.push(`<div class="bulk-warn">يوجد ${numbersAmb} سطر برقمين — اختر أيهما الامتحان وأيهما الواجب.</div>`)
    if (needs) parts.push(`<div class="bulk-warn">يوجد ${needs} عنصر يحتاج قرارًا (مطابقة طالب/تحديد أرقام/تجاهل) قبل التسليح.</div>`)
    if (!undoRedo.enabled) parts.push(`<div class="bulk-warn">ميزة التراجع متوقفة؛ فعّلها لتسجيل الدفعة كتراجع واحد.</div>`)
    if (!exec.length && evalParsed.entries.length) parts.push(`<div class="bulk-warn">لا توجد عناصر جاهزة للتنفيذ.</div>`)
    parts.push(`<div class="bulk-note-inline">مطابقة الطلاب تتم من صفوف جدول التقييم المحمّلة في الصفحة الحالية. القيم غير المذكورة تُترك على الوضع الافتراضي للصفحة. الحفظ يعتمد على سلوك الصفحة (قد يكون تلقائيًا عند التغيير).</div>`)
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

    if (!supported) setEvalBadge('خارج صفحة التقييم', 'off')
    else if (evalRunning) setEvalBadge('جارٍ التنفيذ', 'busy')
    else if (evalArmed) setEvalBadge('مسلّح', 'on')
    else if (evalRows.some((row) => evalNeedsDecision(row))) setEvalBadge('يتطلب قرارًا', 'busy')
    else setEvalBadge('جاهز', 'off')
  }

  function analyzeEvaluationBulk(): void {
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
    evalPreviewBox.textContent = 'تم تعديل البيانات — أعد المعاينة والتحليل قبل التنفيذ.'
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
    if (evalRunning || !evalArmed || !evalParsed) return
    if (!evalSupported()) {
      toast({ title: 'خارج صفحة التقييم', description: 'افتح صفحة التقييم أولًا.', variant: 'warning' })
      return
    }
    if (evalRows.some((row) => evalNeedsDecision(row))) {
      toast({ title: 'يوجد عناصر تحتاج قرارًا', description: 'حلّ الغموض أو تجاهل العناصر قبل التنفيذ.', variant: 'warning' })
      return
    }
    const entries = evalExecutableRows()
    if (!entries.length) return
    if (!undoRedo.enabled) {
      toast({ title: 'فعّل التراجع أولًا', description: 'لا يمكن تسجيل دفعة قابلة للإلغاء مع تعطيل التراجع.', variant: 'warning' })
      return
    }

    evalRunning = true
    evalStop = { stop: false }
    evalLogRows = []
    renderEvalLog()
    evalArmed = false
    updateEvalBulkButtons()

    undoRedo.beginBatch('تقييم جماعي')
    let applied = 0
    let partial = 0
    let failed = 0
    let skipped = 0
    let stopped = false

    try {
      for (const item of entries) {
        if (evalStop.stop) {
          stopped = true
          appendEvalLog({ key: item.key, label: formatEvalLabel(item.code, item.studentName, item.identifier), status: 'stopped', message: 'تم الإيقاف', at: Date.now() })
          break
        }
        const values = evalEffectiveValues(item)
        const label = formatEvalLabel(item.code, item.studentName, item.identifier)
        if (!item.code || !values) {
          skipped++
          appendEvalLog({ key: item.key, label, status: 'skipped', message: 'بيانات غير مكتملة', at: Date.now() })
          continue
        }
        const row = findRowForCode(item.code)
        if (!row) {
          failed++
          appendEvalLog({ key: item.key, label, status: 'not-found', message: 'الصف غير موجود في الجدول الحالي', at: Date.now() })
          continue
        }
        try {
          const res = await applyEvaluationToRow(row, values)
          const at = Date.now()
          if (res.status === 'applied') applied++
          else if (res.status === 'partial') partial++
          else if (res.status === 'skipped') skipped++
          else failed++
          appendEvalLog({ key: item.key, label, status: res.status, message: res.message, at })
          // allow page to react/save between rows (best-effort)
          await new Promise((r) => window.setTimeout(r, 120))
        } catch (err) {
          failed++
          appendEvalLog({ key: item.key, label, status: 'error', message: err instanceof Error ? err.message : String(err), at: Date.now() })
        }
      }

      const detail = `تم ${applied} · جزئي ${partial} · فشل ${failed} · متخطى ${skipped}${stopped ? ' · متوقف' : ''}`
      const committed = undoRedo.commitBatch({
        title: `تقييم جماعي (${applied + partial})`,
        detail,
      })

      if ((applied + partial) > 0 && !committed) {
        toast({
          title: 'اكتمل التنفيذ بدون سجل تراجع',
          description: 'لم تُرصد إجراءات قابلة للإلغاء. قد يكون الحفظ يتطلب إجراءً يدويًا في الصفحة (تحقق حيًا).',
          variant: 'warning',
          duration: 8000,
        })
      } else if (applied + partial > 0) {
        toast({
          title: 'اكتمل التقييم الجماعي',
          description: `${detail}. يمكن التراجع عن الدفعة بـ Ctrl+Z.`,
          variant: 'applied',
          duration: 7000,
        })
      } else {
        toast({ title: 'لا توجد تغييرات مطبقة', description: detail, variant: 'info' })
      }
    } catch (error) {
      undoRedo.commitBatch({ title: `تقييم جماعي (${undoRedo.batchCount})`, detail: 'انتهى التنفيذ بخطأ' })
      toast({ title: 'حدث خطأ أثناء التنفيذ', description: error instanceof Error ? error.message : String(error), variant: 'error' })
    } finally {
      evalRunning = false
      evalStop.stop = false
      renderEvalAnalysis()
    }
  }

  evalPreviewBtn.addEventListener('click', analyzeEvaluationBulk)
  evalArmBtn.addEventListener('click', () => {
    if (!evalReadyToArm()) { analyzeEvaluationBulk(); return }
    evalArmed = true
    setEvalBadge('مسلّح', 'on')
    updateEvalBulkButtons()
    toast({ title: 'التنفيذ مسلّح', description: 'اضغط تنفيذ للبدء. أي تعديل سيلغي التسليح.', variant: 'warning' })
  })
  evalRunBtn.addEventListener('click', () => { void executeEvaluationBulk() })
  evalStopBtn.addEventListener('click', () => {
    if (!evalRunning) return
    evalStop.stop = true
    setEvalBadge('جارٍ الإيقاف', 'busy')
    toast({ title: 'سيتم الإيقاف', description: 'سيتوقف التنفيذ بعد الطالب الحالي.', variant: 'warning' })
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
        return { ...row, identityStatus: 'dropped' as const, message: 'تم التجاهل' }
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
        toast({ title: 'لا يوجد كود', description: 'لا يمكن اختيار طالب بدون كود صالح.', variant: 'warning' })
        return
      }
      evalRows[index] = { ...evalRows[index], identityStatus: 'resolved', code, studentName: name, message: `تم الاختيار: ${name}` }
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
      evalRows[index] = { ...evalRows[index], identityStatus: 'dropped', message: 'تم التجاهل' }
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

  const bulkMenu = backdrop.querySelector<HTMLElement>('[data-bulk-view="menu"]')!
  const bulkDetails = Array.from(backdrop.querySelectorAll<HTMLElement>('.bulk-detail[data-bulk-view]'))
  function showBulkView(view: 'menu' | 'attendance' | 'evaluation' | 'export'): void {
    bulkMenu.hidden = view !== 'menu'
    for (const detail of bulkDetails) {
      detail.hidden = detail.dataset.bulkView !== view
    }
    if (view === 'attendance') {
      refreshBulkLesson()
      updateBulkButtons()
    } else if (view === 'export') {
      refreshAttendanceExport()
    } else if (view === 'evaluation') {
      updateEvalBulkButtons()
    }
  }
  for (const btn of Array.from(backdrop.querySelectorAll<HTMLButtonElement>('[data-bulk-open]'))) {
    btn.addEventListener('click', () => {
      const view = btn.dataset.bulkOpen
      if (view === 'attendance' || view === 'evaluation' || view === 'export') showBulkView(view)
    })
  }
  for (const btn of Array.from(backdrop.querySelectorAll<HTMLButtonElement>('[data-bulk-back]'))) {
    btn.addEventListener('click', () => showBulkView('menu'))
  }

  GM_registerMenuCommand('Tamperina — معاينة الإشعار', () => {
    toast({
      title: 'تم التطبيق',
      description: 'معاينة لإشعار تمبرينا باستخدام ملصق applied',
      variant: 'applied',
    })
  })
  GM_registerMenuCommand('Tamperina — تشخيص أزرار الواجب', () => {
    const report = diagnoseHomeworkButtons()
    console.info('[Tamperina homework diagnostic]\n' + report)
    void navigator.clipboard?.writeText(report).catch(() => {})
    toast({
      title: 'تشخيص أزرار الواجب',
      description: 'تم نسخ التقرير — الصقه هنا، وراجع console (F12) إن لزم.',
      variant: 'info',
      duration: 7000,
    })
  })
  GM_registerMenuCommand('Tamperina — تراجع (Ctrl+Z)', () => void undoRedo.undo())
  GM_registerMenuCommand('Tamperina — إعادة (Ctrl+Y)', () => void undoRedo.redo())
  GM_registerMenuCommand('Tamperina — تشغيل/إيقاف التراجع', () => undoRedo.setEnabled(!undoRedo.enabled))
  GM_registerMenuCommand('Tamperina — تشخيص التراجع', () => {
    const readDebug = (unsafeWindow as unknown as Record<string, unknown>)
      .__tamperinaUndoRedoDebug as (() => ReturnType<UndoRedoController['debug']>) | undefined
    const info = readDebug?.()
    if (info) console.table(info.observed)
    toast({
      title: 'تشخيص تمبرينا',
      description: info
        ? `الصفحة ${info.path} · السجل ${info.historyCount} · أساس التقييم ${info.gradeBaselineCount} · طلبات ${info.observed.length}`
        : 'معلومات التشخيص غير متاحة في هذه النافذة.',
      variant: 'info',
      duration: 9000,
    })
  })
  GM_registerMenuCommand('Tamperina — فتح الإعدادات', () => openModal())
  GM_registerMenuCommand('Tamperina — بحث التقييم (Ctrl+Alt+F)', () => {
    if (!isEvaluationPage() || !isFeatureEnabled('evaluation-find')) return
    findBar.toggle()
  })
  GM_registerMenuCommand('Tamperina — إلغاء النقر من خلال', () => {
    state.clickThrough = false
    persist()
    render()
  })

  render()
}
