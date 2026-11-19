import { GM_registerMenuCommand, unsafeWindow } from '$'
import rina from 'virtual:tamperina-rina'
import cairoFontCss from 'virtual:tamperina-fonts'
import shellStyle from '../ui/styles.css?style'
import { icons } from '../icons'
import { attachToaster, toast } from './toast'
import { getUndoRedoController, type UndoRedoController } from './undoRedo'
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
                  <small>إجراءات تقييم جماعية — سيتم تحديدها بعد التقاط سير العمل</small>
                </span>
                <span class="feature-badge off">قريبًا</span>
              </button>

              <div class="bulk-item is-soon" aria-disabled="true">
                <span class="feature-icon">${icons.history}</span>
                <span class="bulk-item-text">
                  <strong>إجراء جماعي آخر</strong>
                  <small>مساحة لإجراءات جماعية إضافية سيتم تصميمها لاحقًا</small>
                </span>
                <span class="feature-badge off">قريبًا</span>
              </div>
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

          <div class="bulk-detail" data-bulk-view="evaluation" hidden>
            <button type="button" class="bulk-back" data-bulk-back>→ كل الإجراءات الجماعية</button>
            <div class="empty">
              ${icons.toggles}
              <strong>التقييم الجماعي — قريبًا</strong>
              <p>سيُضاف بعد تحديد الإجراءات المطلوبة (درجات، عبارات جاهزة، أو غيرها) والتقاط سير العمل الفعلي في صفحة التقييم.</p>
              <span class="locked-note">${icons.lock} قيد التجهيز</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
  shadow.appendChild(backdrop)

  const launcher = shellEl.querySelector<HTMLElement>('.launcher')!
  const flip = shellEl.querySelector<HTMLElement>('.flip')!
  const spin = shellEl.querySelector<HTMLElement>('.spin')!
  const pill = shellEl.querySelector<HTMLElement>('.pill')!
  const frames = shellEl.querySelector<HTMLElement>('.frames')!
  const pin = shellEl.querySelector<HTMLButtonElement>('.pin')!
  const closeBtn = backdrop.querySelector<HTMLButtonElement>('[data-close]')!
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
    ].join('~')
  }

  function renderFeature(controller: UndoRedoController): void {
    if (!controller.supported) {
      const centerState = localStorage.getItem('tamperina_center_modal') === 'true'
      const barcodeHidden = localStorage.getItem('tamperina_barcode_hidden') === 'true'

      document.documentElement.classList.toggle('centered-payment-modal', centerState)
      document.documentElement.classList.toggle('barcode-hidden', barcodeHidden)

      featureList.innerHTML = `
        <section class="feature-card">
          <header class="feature-head">
            <span class="feature-icon">${icons.center}</span>
            <span class="feature-titles"><strong>مركز نافذة الدفع</strong></span>
            <button type="button" class="switch" data-feature-id="center-modal" role="switch" aria-checked="${centerState}" aria-label="تمركز نافذة الدفع"><span></span></button>
          </header>
        </section>
        <section class="feature-card">
          <header class="feature-head">
            <span class="feature-icon">${icons.barcode}</span>
            <span class="feature-titles"><strong>إخفاء الباركود</strong></span>
            <button type="button" class="switch" data-feature-id="hide-barcode" role="switch" aria-checked="${barcodeHidden}" aria-label="إخفاء أيقونة الباركود"><span></span></button>
          </header>
        </section>
        <div class="empty">
          ${icons.undo}
          <strong>التراجع غير متاح هنا</strong>
          <p>يعمل هذا المفتاح في صفحتي الحضور والتقييم فقط.</p>
        </div>
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
          السجل مؤقت لهذه الصفحة فقط، ولا يُحفظ بعد تحديثها. مفتاح التشغيل هو السماح بتنفيذ التراجع. في صفحة الحضور تعمل الاختصارات حتى أثناء كتابة حقل البحث.
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
    for (const panel of panels) {
      panel.hidden = panel.dataset.panel !== state.activeTab
    }

    renderFeatureIfNeeded()
  }

  function openModal(): void {
    backdrop.hidden = false
    closeBtn.focus()
  }

  function closeModal(): void {
    backdrop.hidden = true
    launcher.focus()
  }

  function toggleModal(): void {
    if (backdrop.hidden) openModal()
    else closeModal()
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
      undoRedo.setEnabled(!undoRedo.enabled)
    } else if (btn.hasAttribute('data-undo')) {
      void undoRedo.undo()
    } else if (btn.hasAttribute('data-redo')) {
      void undoRedo.redo()
    } else if (btn.hasAttribute('data-feature-id')) {
      const featureId = btn.dataset.featureId
      const storageKey = `tamperina_${featureId}`
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

  document.addEventListener('keydown', (event) => {
    if (!event.defaultPrevented && (event.ctrlKey || event.metaKey) && !event.altKey) {
      const redoShortcut = event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey)
      const undoShortcut = event.code === 'KeyZ' && !event.shiftKey
      if ((undoShortcut || redoShortcut)
        && undoRedo.supported
        && undoRedo.enabled
        && (isAttendancePage() || !isEditableTarget(event.target))) {
        event.preventDefault()
        if (redoShortcut) void undoRedo.redo()
        else void undoRedo.undo()
        return
      }
    }

    if (event.key === 'Escape' && !backdrop.hidden) {
      closeModal()
      return
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

  /** Seed/keep payment overrides for known entries (school mode). */
  function seedPaymentOverridesFromParsed(): void {
    if (!bulkParsed) return
    // Seed from direct codes
    for (const item of bulkParsed.codes) {
      const code = item.code.toUpperCase()
      if (item.payment && !bulkPayOverrides.has(code)) {
        bulkPayOverrides.set(code, {
          studentCode: code,
          status: item.payment.status,
          amountPaid: item.payment.amountPaid,
        })
      } else if (!bulkPayOverrides.has(code)) {
        bulkPayOverrides.set(code, { studentCode: code, status: 'paid' })
      }
    }
    // Seed from resolved names
    for (const row of bulkNameRows) {
      if (row.status !== 'resolved' || !row.code) continue
      const code = row.code.toUpperCase()
      if (row.payment && !bulkPayOverrides.has(code)) {
        bulkPayOverrides.set(code, {
          studentCode: code,
          status: row.payment.status,
          amountPaid: row.payment.amountPaid,
        })
      } else if (!bulkPayOverrides.has(code)) {
        bulkPayOverrides.set(code, { studentCode: code, status: 'paid' })
      }
    }
  }

  function renderInlinePaymentControls(code: string): string {
    if (bulkPayMode !== 'school') return ''
    const key = code.toUpperCase()
    const override = bulkPayOverrides.get(key) ?? { studentCode: key, status: 'paid' as PaymentStatus }
    const status = override.status
    const amount = override.amountPaid
    const needsAmount = status === 'partial' || status === 'discounted'
    const selectOpts = ([
      ['paid', 'كامل'],
      ['partial', 'جزئي'],
      ['discounted', 'مخفض/مجاني'],
      ['forgotten', 'نسي الفلوس'],
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

  function executableEntries(): Array<{ code: string, label?: string }> {
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

  function unresolvedNameRows(): NameRow[] {
    return bulkNameRows.filter((row) =>
      row.status !== 'resolved' && row.status !== 'dropped')
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
    const codeItems = (bulkPayMode === 'school' && bulkParsed) ? bulkParsed.codes : []
    if (!nameRows.length && !codeItems.length) {
      bulkResolveBox.hidden = true
      bulkResolveBox.innerHTML = ''
      return
    }

    let html = ''

    if (codeItems.length) {
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
    }

    html += nameRows.map((row) => {
      const statusText: Record<NameRow['status'], string> = {
        ready: 'جاهز',
        resolved: row.studentName ? `تم التعرف: ${row.studentName}${row.code ? ` (${row.code})` : ''}` : 'تم التعرف',
        ambiguous: 'الاسم غامض أو مشترك — اختر الطالب الصحيح',
        'not-found': 'لم يتم العثور على الاسم',
        'too-many': 'نتائج كثيرة جدًا',
        dropped: 'تم التجاهل — ستدخله يدويًا',
        loading: 'جارٍ البحث…',
        error: 'تعذّر البحث',
      }
      const cls = row.status === 'resolved' ? 'ok'
        : row.status === 'dropped' ? 'drop'
        : row.status === 'loading' ? ''
        : (row.status === 'ready' ? 'ok' : '')

      let choicesHtml = ''
      if ((row.status === 'ambiguous' || row.status === 'not-found' || row.status === 'too-many' || row.status === 'error' || row.status === 'resolved')
        && row.candidates.length) {
        const list = row.candidates.slice(0, 12)
        choicesHtml = `<div class="bulk-resolve-choices">${list.map((c) => `
          <button type="button" class="bulk-choice ${row.code === c.code && row.status === 'resolved' ? 'selected' : ''}"
            data-resolve-action="choose" data-key="${escapeBulk(row.key)}"
            data-id="${escapeBulk(c.id)}" data-code="${escapeBulk(c.code)}" data-name="${escapeBulk(c.name)}">
            <span>${escapeBulk(c.name || 'طالب')}</span>
            <small>${escapeBulk(c.code || 'بدون كود')}</small>
          </button>`).join('')}${row.candidates.length > 12 ? `<div class="bulk-note-inline">+${row.candidates.length - 12} نتائج أخرى</div>` : ''}</div>`
      }

      const editHtml = row.status === 'dropped' ? '' : `<div class="bulk-inline-edit" ${row.status === 'resolved' ? 'hidden' : ''}>
          <input type="text" class="bulk-input" data-resolve-edit="${escapeBulk(row.key)}" value="${escapeBulk(row.query)}" placeholder="عدّل الاسم ثم أعد البحث" />
          <button type="button" class="bulk-mini-btn" data-resolve-action="research" data-key="${escapeBulk(row.key)}">إعادة بحث</button>
        </div>`

      const actions = row.status === 'dropped'
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
    }).join('')

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
      <div><strong>جاهزة للإرسال</strong><span>${exec.length}</span></div>
      <div><strong>مكررة</strong><span>${bulkParsed.duplicates.length}</span></div>
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
    parts.push(`<div class="bulk-note-inline">يتم مطابقة الأسماء ضمن طلاب الحصة المفتوحة. بدون بيان دفع قد يُسجَّل الحضور كدفع مؤجل إذا كانت الحصة بتحصيل (سلوك المنصة).</div>`)

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

    if (bulkPayMode === 'school') {
      const missingAmount = Array.from(bulkPayOverrides.values()).find(
        (o) => (o.status === 'partial' || o.status === 'discounted') && (o.amountPaid == null || Number.isNaN(o.amountPaid)),
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

    const entries = executableEntries()
    if (!entries.length) return
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

      const committed = undoRedo.commitBatch({
        title: `تسجيل حضور جماعي (${summary.created})`,
        detail: `تم ${summary.created} · موجود ${summary.duplicates} · متخطى ${summary.skipped} · فشل ${summary.failed}${summary.stopped ? ' · متوقف' : ''}`,
      })

      if (!committed && summary.created > 0) {
        toast({
          title: 'اكتمل التنفيذ بدون سجل تراجع',
          description: 'لم يتم تسجيل الدفعة في سجل التراجع.',
          variant: 'warning',
          duration: 7000,
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

  function updateBulkInputPlaceholder(): void {
    if (bulkPayMode === 'school') {
      bulkCodesInput.placeholder = '2017, 45, كامل\n2016, 10, مخفض\nأحمد محمد, 0, نسي الفلوس'
    } else {
      bulkCodesInput.placeholder = '2349\nأحمد محمد\n2351'
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
      const newStatus = statusEl.value as PaymentStatus
      const existing = bulkPayOverrides.get(code) ?? { studentCode: code, status: 'paid' }
      existing.status = newStatus
      if (newStatus !== 'partial' && newStatus !== 'discounted') {
        delete existing.amountPaid
      }
      bulkPayOverrides.set(code, existing)
      const wrap = bulkResolveBox.querySelector<HTMLElement>(`[data-inline-pay-amount-wrap="${CSS.escape(code)}"]`)
      const amountInput = bulkResolveBox.querySelector<HTMLInputElement>(`[data-inline-pay-amount="${CSS.escape(code)}"]`)
      if (wrap) wrap.hidden = !(newStatus === 'partial' || newStatus === 'discounted')
      if (amountInput && !(newStatus === 'partial' || newStatus === 'discounted')) amountInput.value = ''
      if (amountInput && (newStatus === 'partial' || newStatus === 'discounted')) amountInput.focus()
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
    const btn = (event.target as Element).closest<HTMLButtonElement>('[data-resolve-action]')
    if (!btn) return
    const key = btn.dataset.key || ''
    const action = btn.dataset.resolveAction
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
  })

  const bulkMenu = backdrop.querySelector<HTMLElement>('[data-bulk-view="menu"]')!
  const bulkDetails = Array.from(backdrop.querySelectorAll<HTMLElement>('.bulk-detail[data-bulk-view]'))
  function showBulkView(view: 'menu' | 'attendance' | 'evaluation'): void {
    bulkMenu.hidden = view !== 'menu'
    for (const detail of bulkDetails) {
      detail.hidden = detail.dataset.bulkView !== view
    }
    if (view === 'attendance') {
      refreshBulkLesson()
      updateBulkButtons()
    }
  }
  for (const btn of Array.from(backdrop.querySelectorAll<HTMLButtonElement>('[data-bulk-open]'))) {
    btn.addEventListener('click', () => {
      const view = btn.dataset.bulkOpen
      if (view === 'attendance' || view === 'evaluation') showBulkView(view)
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
  GM_registerMenuCommand('Tamperina — إلغاء النقر من خلال', () => {
    state.clickThrough = false
    persist()
    render()
  })

  render()
}
