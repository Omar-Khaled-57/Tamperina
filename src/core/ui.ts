import { GM_registerMenuCommand, unsafeWindow } from '$'
import rina from 'virtual:tamperina-rina'
import cairoFontCss from 'virtual:tamperina-fonts'
import shellStyle from '../ui/styles.css?style'
import { icons } from '../icons'
import { attachToaster, toast } from './toast'
import { getUndoRedoController, type UndoRedoController } from './undoRedo'
import {
  buildPreview,
  currentLessonIdFromPage,
  detectScanForm,
  parseBulkCodes,
  runBulkAttendance,
  type BulkPreview,
  type BulkRowResult,
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
const FONT_STYLE_ID = 'tamperina-font-face'
const DRAG_THRESHOLD = 5
const HOTKEY_RESTORE = 'Alt+Shift+T'

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

/** Chrome/Firefox ignore @font-face rules scoped to a Shadow DOM stylesheet. */
function ensureCairoFont(): void {
  if (document.getElementById(FONT_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = FONT_STYLE_ID
  style.textContent = cairoFontCss
  const target = document.head ?? document.documentElement
  if (!target) {
    document.addEventListener('DOMContentLoaded', ensureCairoFont, { once: true })
    return
  }
  target.appendChild(style)
}

export function mountShell(): void {
  ensureCairoFont()
  if (document.getElementById(HOST_ID)) return

  const host = document.createElement('div')
  host.id = HOST_ID
  document.documentElement.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  attachToaster(shadow)
  const fontStyle = document.createElement('style')
  fontStyle.textContent = cairoFontCss
  shadow.appendChild(fontStyle)
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
          <div class="bulk-card" data-bulk-root>
            <div class="bulk-head">
              <span class="feature-icon">${icons.bulk}</span>
              <span class="feature-titles">
                <strong>تسجيل حضور جماعي</strong>
                <small>إدخال أكواد عبر نموذج الحضور</small>
              </span>
              <span class="feature-badge off" data-bulk-state-badge>جاهز</span>
            </div>

            <p class="bulk-note">
              الصق الأكواد فقط (كود واحد في كل سطر). لا تُكتب الأسماء. تنسيق مقترح للذكاء الاصطناعي: «استخرج أكواد الطلاب فقط، كودًا واحدًا في كل سطر بالأرقام اللاتينية بدون أسماء أو شرح».
            </p>

            <div class="bulk-grid">
              <label class="bulk-field">
                <span>رقم الحصة (الحالية افتراضيًا)</span>
                <input type="text" inputmode="numeric" class="bulk-input" data-bulk-lesson placeholder="مثال: 293" />
              </label>
            </div>

            <label class="bulk-field">
              <span>قائمة الأكواد</span>
              <textarea class="bulk-textarea" data-bulk-codes rows="7" placeholder="2349&#10;2350&#10;2351"></textarea>
            </label>

            <div class="bulk-actions">
              <button type="button" class="action-btn" data-bulk-preview>${icons.toggles}<span>معاينة</span></button>
              <button type="button" class="action-btn" data-bulk-arm disabled>${icons.lock}<span>تسليح التنفيذ</span></button>
              <button type="button" class="action-btn bulk-run" data-bulk-run disabled>${icons.play}<span>تنفيذ</span></button>
              <button type="button" class="action-btn bulk-stop" data-bulk-stop disabled>${icons.pause}<span>إيقاف</span></button>
            </div>

            <div class="bulk-preview" data-bulk-preview-box>لم تتم المعاينة بعد.</div>

            <div class="history-head">
              ${icons.history}
              <strong>سجل التنفيذ</strong>
              <small data-bulk-log-count>0</small>
            </div>
            <div class="bulk-log" data-bulk-log>
              <div class="history-empty">لا يوجد تنفيذ بعد.</div>
            </div>

            <p class="feature-note">${icons.shieldAlert}
              يتم الإرسال كودًا بكود عبر نموذج الصفحة نفسه. التراجع بعد اكتمال الدفعة يلغي كل السجلات المُنشأة في خطوة واحدة. إذا اختلف رقم الحصة عن الحصة المفتوحة، يجب فتح الرابط الصحيح أولًا.
            </p>
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
      featureList.innerHTML = `
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
    const btn = (event.target as Element).closest<HTMLButtonElement>('[data-feature-toggle], [data-undo], [data-redo]')
    if (!btn || btn.disabled) return
    event.stopPropagation()
    if (btn.hasAttribute('data-feature-toggle')) {
      undoRedo.setEnabled(!undoRedo.enabled)
    } else if (btn.hasAttribute('data-undo')) {
      void undoRedo.undo()
    } else {
      void undoRedo.redo()
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
  const bulkLog = bulkRoot.querySelector<HTMLElement>('[data-bulk-log]')!
  const bulkLogCount = bulkRoot.querySelector<HTMLElement>('[data-bulk-log-count]')!
  const bulkBadge = bulkRoot.querySelector<HTMLElement>('[data-bulk-state-badge]')!

  let bulkPreviewData: BulkPreview | null = null
  let bulkArmed = false
  let bulkRunning = false
  let bulkStop = { stop: false }
  let bulkLessonTouched = false
  let bulkLogRows: BulkRowResult[] = []

  function bulkSupported(): boolean {
    return isAttendancePage()
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
      const detail = row.recordId ? ` · #${escapeBulk(row.recordId)}` : ''
      const msg = row.message ? ` — ${escapeBulk(row.message)}` : ''
      return `<div class="bulk-log-item ${cls}">
        <span class="bulk-log-code">${escapeBulk(row.code)}</span>
        <span class="bulk-log-status">${statusLabel[row.status]}${detail}${msg}</span>
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
    if (reason) {
      setBulkBadge(reason, 'off')
    }
  }

  function updateBulkButtons(): void {
    const supported = bulkSupported()
    const canPreview = supported && !bulkRunning
    const canArm = supported && !bulkRunning && !!bulkPreviewData && bulkPreviewData.toSubmit.length >= 0
      && (bulkPreviewData.parse.codes.length > 0)
    const canRun = supported && !bulkRunning && bulkArmed && !!bulkPreviewData
      && bulkPreviewData.parse.codes.length > 0 && undoRedo.enabled

    bulkPreviewBtn.disabled = !canPreview
    bulkArmBtn.disabled = !canArm
    bulkRunBtn.disabled = !canRun
    bulkStopBtn.disabled = !bulkRunning

    if (!supported) {
      setBulkBadge('خارج صفحة الحضور', 'off')
    } else if (bulkRunning) {
      setBulkBadge('جارٍ التنفيذ', 'busy')
    } else if (bulkArmed) {
      setBulkBadge('مسلّح', 'on')
    } else {
      setBulkBadge('جاهز', 'off')
    }
  }

  function refreshBulkLesson(force = false): void {
    if (bulkLessonTouched && !force) return
    const lessonId = currentLessonIdFromPage()
    if (lessonId) bulkLessonInput.value = String(lessonId)
  }

  function showBulkPreview(): void {
    if (!bulkSupported()) {
      bulkPreviewData = null
      bulkPreviewBox.innerHTML = `<div class="bulk-warn">افتح صفحة <code>/attendance/scan</code> أولًا.</div>`
      disarmBulk('غير متاح')
      updateBulkButtons()
      return
    }

    const lessonId = bulkLessonInput.value.trim() || currentLessonIdFromPage() || null
    const preview = buildPreview(bulkCodesInput.value, lessonId)
    bulkPreviewData = preview
    bulkArmed = false

    const scan = detectScanForm()
    if (!scan) {
      bulkPreviewBox.innerHTML = `<div class="bulk-warn">تعذّر العثور على نموذج الحضور (<code>#scanForm</code>) أو حقل الإدخال. تأكد أنك في صفحة مسح الحضور الصحيحة.</div>`
      updateBulkButtons()
      return
    }

    const p = preview.parse
    const parts: string[] = []
    parts.push(`<div class="bulk-preview-grid">
      <div><strong>الحصة المستهدفة</strong><span>${escapeHtml(preview.lessonId ?? 'غير محددة')}</span></div>
      <div><strong>الحصة المفتوحة</strong><span>${escapeHtml(preview.pageLessonId ?? scan.lessonId ?? 'غير معروفة')}</span></div>
      <div><strong>حقل الإدخال</strong><span dir="ltr">${escapeHtml(scan.inputSelector)}</span></div>
      <div><strong>أكواد صالحة</strong><span>${p.codes.length}</span></div>
      <div><strong>مكررة (أزيلت)</strong><span>${p.duplicates.length}</span></div>
      <div><strong>غير صالحة (تُتجاهل)</strong><span>${p.invalid.length}</span></div>
      <div><strong>مسجّلة مسبقًا</strong><span>${preview.alreadyPresent.length}</span></div>
      <div><strong>ستُرسَل</strong><span>${preview.toSubmit.length}</span></div>
    </div>`)

    if (preview.pageLessonId && preview.lessonId && String(preview.lessonId) !== String(preview.pageLessonId)) {
      parts.push(`<div class="bulk-warn">رقم الحصة المدخل (${escapeHtml(preview.lessonId)}) يختلف عن الحصة المفتوحة (${escapeHtml(preview.pageLessonId)}). افتح الحصة المطلوبة أولًا قبل التنفيذ.</div>`)
    }

    if (p.invalid.length) {
      parts.push(`<div class="bulk-warn">قيم غير صالحة سيتم تجاهلها: ${p.invalid.slice(0, 12).map(escapeHtml).join('، ')}${p.invalid.length > 12 ? '…' : ''}</div>`)
    }
    if (preview.alreadyPresent.length) {
      parts.push(`<div class="bulk-note-inline">أكواد مسجّلة مسبقًا (ستُتخطى): ${preview.alreadyPresent.slice(0, 12).map(escapeHtml).join('، ')}${preview.alreadyPresent.length > 12 ? '…' : ''}</div>`)
    }
    if (!p.codes.length) {
      parts.push(`<div class="bulk-warn">لا توجد أكواد صالحة.</div>`)
    }
    if (!undoRedo.enabled) {
      parts.push(`<div class="bulk-warn">ميزة التراجع متوقفة؛ فعّلها أولًا ليتم تسجيل الدفعة كتراجع واحد.</div>`)
    }
    parts.push(`<div class="bulk-note-inline">بدون بيان دفع، قد يُسجَّل الحضور كدفع مؤجل إذا كانت الحصة بتحصيل (سلوك المنصة).</div>`)

    bulkPreviewBox.innerHTML = parts.join('')
    updateBulkButtons()
  }

  function invalidateBulkPreview(): void {
    if (bulkRunning) return
    bulkPreviewData = null
    bulkArmed = false
    bulkPreviewBox.textContent = 'تم تعديل البيانات — أعد المعاينة قبل التنفيذ.'
    updateBulkButtons()
  }

  async function executeBulk(): Promise<void> {
    if (bulkRunning || !bulkArmed || !bulkPreviewData) return
    if (!bulkSupported()) return

    const scan = detectScanForm()
    if (!scan) {
      toast({ title: 'تعذّر التنفيذ', description: 'لم يُعثر على نموذج الحضور.', variant: 'error' })
      return
    }

    const targetLesson = bulkLessonInput.value.trim() || bulkPreviewData.lessonId || ''
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

    const codes = bulkPreviewData.parse.codes
    if (!codes.length) return
    if (!undoRedo.enabled) {
      toast({ title: 'فعّل التراجع أولًا', description: 'لا يمكن تسجيل دفعة قابلة للإلغاء والتراجع معطل.', variant: 'warning' })
      return
    }

    bulkRunning = true
    bulkStop = { stop: false }
    bulkLogRows = []
    renderBulkLog()
    disarmBulk()
    updateBulkButtons()

    undoRedo.beginBatch('تسجيل حضور جماعي')
    try {
      const summary = await runBulkAttendance({
        codes,
        signal: bulkStop,
        onRow: appendBulkRow,
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
          description: 'جميع الأكواد كانت مسجلة أو تم تخطيها.',
          variant: 'info',
        })
      }

      // Refresh preview so "already present" reflects new state.
      bulkPreviewData = buildPreview(bulkCodesInput.value, bulkLessonInput.value.trim() || null)
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
      updateBulkButtons()
    }
  }

  bulkPreviewBtn.addEventListener('click', () => {
    refreshBulkLesson()
    showBulkPreview()
  })
  bulkArmBtn.addEventListener('click', () => {
    if (!bulkPreviewData || !bulkPreviewData.parse.codes.length) {
      showBulkPreview()
      return
    }
    bulkArmed = true
    setBulkBadge('مسلّح', 'on')
    updateBulkButtons()
    toast({
      title: 'التنفيذ مسلّح',
      description: 'اضغط تنفيذ للبدء. أي تعديل على الأكواد أو الحصة سيلغي التسليح.',
      variant: 'warning',
    })
  })
  bulkRunBtn.addEventListener('click', () => { void executeBulk() })
  bulkStopBtn.addEventListener('click', () => {
    if (!bulkRunning) return
    bulkStop.stop = true
    setBulkBadge('جارٍ الإيقاف', 'busy')
    toast({ title: 'سيتم الإيقاف', description: 'سيتوقف التنفيذ بعد الكود الحالي.', variant: 'warning' })
  })

  bulkCodesInput.addEventListener('input', () => { bulkLessonTouched = bulkLessonTouched; invalidateBulkPreview() })
  bulkLessonInput.addEventListener('input', () => { bulkLessonTouched = true; invalidateBulkPreview() })

  // Prefill lesson and keep bulk controls in sync with undoRedo state.
  refreshBulkLesson()
  updateBulkButtons()
  undoRedo.subscribe(() => {
    refreshBulkLesson()
    updateBulkButtons()
  })

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
