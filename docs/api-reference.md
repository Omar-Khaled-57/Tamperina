# <img src="../public/rina/keyboard.png" width="88" align="center" /> API Reference

Internal API surface of the userscript. These are not public browser APIs — they are the contracts between Tamperina's modules, useful when extending the script or writing tests. Architecture and rationale live in [Architecture](architecture.md).

---

## `src/main.ts`

| Export | Signature | Notes |
|---|---|---|
| — | module side effects | `safeInit('undo/redo', initUndoRedo)`, `safeInit('evaluation tools', initEvaluationTools)`, then `mountShell()` on DOM ready. Errors are logged as `[Tamperina] <label> failed to initialize`. |

---

## `src/core/storage.ts`

| Export | Type / value |
|---|---|
| `SIZE_MIN`, `SIZE_MAX`, `SIZE_STEP`, `SIZE_DEFAULT` | `64`, `240`, `12`, `120` |
| `SHELL_KEY` | `'tamperina.shell.v1'` |
| `Frame` | `1 \| 2 \| 3` |
| `ShellState` | `{ x, y, size, mirrored, paused, frame, locked, clickThrough, activeTab: 'toggles' \| 'bulk', locale: 'ar' \| 'en', examAttendanceStage, holdWhatsappUntilApproved, remoteBulk }` |
| `loadShell()` | `ShellState` — strict field-by-field validation, legacy `examAttendanceCleanup` migration |
| `saveShell(state)` | `void` — `GM_setValue(SHELL_KEY, JSON.stringify(state))`, ignores failures |

Defaults: `x: 92`, `y: 88`, `size: 120`, `mirrored: false`, `paused: false`, `frame: 1`, `locked: false`, `clickThrough: false`, `activeTab: 'toggles'`, `locale: 'ar'`, `examAttendanceStage: false`, `holdWhatsappUntilApproved: false`, `remoteBulk: false`.

---

## `src/core/features.ts`

| Export | Type |
|---|---|
| `Feature` | `{ id: string; label: string; description?: string; defaultEnabled: boolean }` |
| `registeredFeatures` | `Feature[]` — generic declarations for `undo-redo` and `bulk-attendance` |
| `registerFeature(feature)` | `void` |

The visible Toggles cards are built separately in `renderFeature()` in `src/core/ui.ts`.

---

## `src/core/undoRedo.ts`

### Exported types

```ts
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface HttpCommand {
  method: HttpMethod
  url: string
  body?: unknown
  headers?: Record<string, string>
}

interface LiveRecord {
  id: string
  name?: string
  username?: string
  studentCode?: string
  lessonId?: string | null
  source?: string
}

type AttendanceEvent = { type: 'add' | 'remove' | 'duplicate'; record: LiveRecord }

type SerializedAction = SerializedActionBase & (
  | { kind: 'attendance-add'; record: LiveRecord; headers?: Record<string, string> }
  | { kind: 'attendance-remove'; record: LiveRecord; headers?: Record<string, string> }
  | { kind: 'grade'; command: HttpCommand; before: GradeSnapshot; after: GradeSnapshot }
  | { kind: 'batch'; title: string; detail: string; actions: SerializedAction[] }
)

interface HistoryAction {
  id: string
  title: string
  detail: string
  at: number
  undo(): Promise<HistoryAction>
  redo(): Promise<HistoryAction>
  warning?: string
  readonly serialized: SerializedAction
}
```

### Controller

```ts
interface UndoRedoController {
  readonly version: string                       // 'v3'
  readonly supported: boolean
  enabled: boolean
  readonly busy: boolean
  readonly batching: boolean
  readonly batchCount: number
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly history: HistoryAction[]              // newest first
  readonly knownRecordCodes: Set<string>
  knownRecordCodesForLesson(lessonId: string | number): Set<string>
  readonly attendanceRecords: LiveRecord[]
  readonly lessonId: string | null
  setEnabled(enabled: boolean): void
  undo(): Promise<HistoryAction | null>
  redo(): Promise<HistoryAction | null>
  beginBatch(title: string): void
  commitBatch(info?: { title?: string; detail?: string }): HistoryAction | null
  ensureAttendanceRecorded(record: LiveRecord, headers?: Record<string, string>): void
  refreshAttendanceLesson(lessonId: string | number): Promise<void>
  deleteAttendanceRecord(record: LiveRecord, headers?: Record<string, string>): Promise<boolean>
  captureGradeBaseline(row: Element): void
  subscribe(handler: () => void): () => void
  onAttendance(handler: (event: AttendanceEvent) => void): () => void
  debug(): UndoRedoDebug
}
```

`initUndoRedo(): UndoRedoController` creates or reuses the controller on `(unsafeWindow ?? window)[__tamperinaUndoRedoController_v3]`; `getUndoRedoController()` returns the current one.

| Constant | Value |
|---|---|
| `ENABLED_KEY` | `'tamperina.feature.undoRedo.enabled.v1'` |
| `CONTROLLER_VERSION` | `'v3'` |
| `CONTROLLER_KEY` | `'__tamperinaUndoRedoController_v3'` |
| `HOOKS_KEY` | `'__tamperinaUndoRedoHooks_v3'` |
| `SESSION_KEY` | `'tamperina.undoRedo.session.v1'` |
| `SUPPORTED_PATHS` | `'/attendance/scan'`, `'/evaluation'` (+ exam pages) |
| `EXAM_PAGE_RE` | `/^\/comprehensive-exams\/\d+$/` |
| `EXAM_CHECKIN_RE` | `/^\/comprehensive-exams\/\d+\/check-in$/` |
| `GRADE_ROWS_SELECTOR` | `'.evaluation-table tbody tr, [data-grade-row]'` |
| `ACTION_KINDS` | `attendance-add`, `attendance-remove`, `grade`, `batch` |
| `GRADE_BODY_KEYS` | `exam_score`, `score`, `grade`, `evaluation`, `estimation`, `degree`, `mark`, `result` |
| Replay header allow-list | `x-csrf-token`, `x-xsrf-token`, `x-requested-with`, `content-type` |
| Debug ring size | 20 observations |

`recordFromAttendanceResponse(raw, fallback)` normalizes a response envelope into a `LiveRecord | null`.

`debug()` returns `{ version, path, supported, enabled, batching, batchCount, canUndo, canRedo, historyCount, gradeBaselineCount, hasTouchedGradeRow, observed: [{ at, method, path, keys, grade, reason? }] }`.

---

## `src/core/evaluation.ts`

| Export | Signature / type |
|---|---|
| `EvaluationFeatureId` | `'student-select' \| 'evaluation-find' \| 'homework-buttons'` |
| `GradeKey` | `'امتياز' \| 'جيد جدا' \| 'جيد' \| 'مقبول' \| 'ضعيف' \| 'الواجب ناقص'` |
| `initEvaluationTools()` | `void` — idempotent; installs click-to-select, styles, grade listeners, popstate reset, MutationObserver |
| `isFeatureEnabled(id)` | `boolean` — `localStorage['tamperina_' + id]`, `null` → `true`; `homework-buttons` always `false` in v0.0.22 |
| `setFeatureEnabled(id, enabled)` | `void` — persists and notifies |
| `subscribeFeatures(listener)` / `subscribeSelection(listener)` / `subscribeRows(listener)` | unsubscribe functions |
| `evaluationRows()` | `HTMLTableRowElement[]` — `.evaluation-table tbody tr, tr[data-grade-row]` |
| `rowCode(row)` / `rowName(row)` / `rowLabel(row)` | `string` |
| `normalizeDigits(value)` / `normalizeLabel(value)` | `string` — digit, tatweel, RLM/LRM, alef/ya folding |
| `selectRow(row, options?)` | `void` — options `{ silent?: boolean }`; commits pending typing |
| `getSelectedRow()` | row element or `null` (only if still connected) |
| `gradeForKey(event)` | `GradeKey \| null` |
| `handleSelectedRowKey(event, row)` | `boolean` — true when consumed |
| `commitExamTyping()` | `void` — dispatch `change` when the typed value is still present |
| `setExamScore(row, value)` / `setSelectValue(select, value)` | `void` — capture baseline, set value, dispatch `input` + `change` |
| `homeworkSelect(row)` / `mainGradeSelect(row)` | `HTMLSelectElement \| null` |
| `hasHomeworkLabel(select)` / `hasHomeworkOnlyOption()` | `boolean` |
| `diagnoseHomeworkButtons()` | `string` — copyable diagnostic report |
| `featureStateSignature()` | `string` — used by the shell's render signature |

Constants: `FEATURE_IDS`, `SELECTED_CLASS = 'tamperina-selected'`, `HOMEWORK_WRAPPER_CLASS = 'tamperina-grade-buttons'`, `HIDDEN_SELECT_CLASS = 'tamperina-homework-select-hidden'`, `STYLE_ID = 'tamperina-evaluation-styles'`, typing debounce **400ms**, row notification debounce **50ms**.

---

## `src/core/findBar.ts`

```ts
interface FindBar {
  toggle(open?: boolean): void
  isOpen(): boolean
  destroy(): void
}
function mountFindBar(shadow: ShadowRoot): FindBar
```

Behavior: mounts `.find-bar` into the shadow root, `Enter`/`Shift+Enter` navigation, `Aa` case toggle, `Esc` close, four-digit `maybeAutoSelect()` (independent of the selection toggle), `handOffToStudent()` on exact-code Enter. Highlights use `CSS.highlights` with names `tamperina-find` / `tamperina-find-current`, with `.tamperina-find-hit` / `.tamperina-find-current` class fallback. Injected style id: `tamperina-find-highlight-style`.

---

## `src/core/bulkAttendance.ts`

### Core types

```ts
type PaymentMode = 'center' | 'school'
type PaymentStatus = 'paid' | 'partial' | 'discounted' | 'forgotten'

interface PaymentOverride {
  studentCode: string
  status: PaymentStatus
  amountPaid?: number
  note?: string
}

interface ParsedCode { kind: 'code'; key: string; raw: string; code: string; payment?: ParsedEntryPayment }
interface ParsedName { kind: 'name'; key: string; raw: string; query: string; payment?: ParsedEntryPayment }

interface ParseEntriesResult {
  codes: ParsedCode[]
  names: ParsedName[]
  duplicates: string[]
  invalid: string[]
  totalTokens: number
}

type ResolveStatus =
  | 'ready' | 'resolved' | 'ambiguous' | 'not-found' | 'too-many'
  | 'dropped' | 'walk-in' | 'loading' | 'error'

interface NameRow {
  kind: 'name'; key: string; raw: string; query: string
  status: ResolveStatus
  code?: string; studentName?: string
  candidates: StudentCandidate[]
  message?: string
  payment?: ParsedEntryPayment
}

type BulkRowStatus = 'created' | 'duplicate' | 'skipped-known' | 'timeout' | 'error' | 'stopped'

interface BulkRowDebug {
  request?: { path: string; payload: Record<string, unknown> }
  response?: { status: number; statusText: string; contentType: string; body: string }
  observer?: string
  note?: string
}

interface BulkRowResult { code: string; label?: string; status: BulkRowStatus; message?: string; recordId?: string; at: number; debug?: BulkRowDebug }

interface ExamCheckinOptions {
  paymentStatus?: 'paid' | 'exempt' | 'deferred'
  amountPaid?: string
  paymentNote?: string
  source?: 'manual' | 'scanner' | 'camera' | 'image'
}

interface BulkRunSummary {
  rows: BulkRowResult[]
  created: number; duplicates: number; skipped: number; failed: number; stopped: boolean
  context: BulkRunContext
}
```

### Functions

| Export | Role |
|---|---|
| `normalizeStudentCode(value)` | Normalize digits, trim, uppercase. |
| `parseBulkEntries(text)` | Parse pasted lines into codes, names, duplicates, invalid. |
| `parseInlinePayment(segments)` | Parse `identifier, amount, status` variants. |
| `detectScanForm(preferExam?)` | Find `#examScan` / `#scanForm` / `form[action*="attendance"]` with lesson id, students URL and input selector. |
| `currentLessonIdFromPage()` | Lesson id from undo controller → form → URL. |
| `fetchStudentsPage(query, lessonId)` / `searchStudents(query, lessonId)` | Roster search with code fallback. |
| `resolveNameEntry(row, lessonId)` | Resolve a name row to `ready` / `resolved` / `ambiguous` / `not-found` / `too-many` / `error`. |
| `runBulkAttendance(options)` | Execute a run; options include `paymentMode`, `target: 'standard' \| 'exam'`, `timeoutMs`, `lessonId`, `paymentOverrides`, `signal: { stop }`, `onRow`. |
| `submitSchoolAttendance(code, lessonId, override)` | Direct `POST /attendance` (CSRF from `meta[name="csrf-token"]`). |
| `applyExamCheckinOptions(form, options)` | Set payment fields and pin `source` on `#examScan`. |
| `formatBulkDiagnosticReport(summary, entries)` | Copyable diagnostic text. |

Constants: `CODE_RE = /^[A-Z0-9_-]{3,80}$/`, default timeout **10,000ms**, school concurrency **5**, observer fallback wait **1,200ms**, diagnostic body capture **2,000 chars**. Payment word maps are documented in [Feature Reference](feature-reference.md#payment-grammar).

---

## `src/core/bulkEvaluation.ts`

| Export | Role |
|---|---|
| `parseEvaluationEntries(text)` | `ParseEvalResult` — entries, invalid, duplicates, totalLines; `#` comments skipped; keys `e-<n>`. |
| `collectPageCandidates()` | Map current evaluation/exam rows to `{ code, name }`. |
| `matchIdentifier(identifier)` | `ready` / `ambiguous` / `too-many` / `not-found` with candidates. |
| `findRowForCode(code)` | Row element for a normalized code. |
| `applyEvaluationToRow(row, values)` | Apply exam/homework values through page controls; returns a status and message. |
| `formatEvalResultSummary(summary)` | Copyable result text. |

Types: `EvalValues { exam?, homework? }`, `ParsedEvalLine`, `ParseEvalResult`, `EvalResolveStatus`, `EvalRowStatus` (`applied`, `partial`, `not-found`, `missing-field`, `invalid`, `error`, `stopped`, `skipped`), `EvalRunSummary`. Known grade texts: the six Arabic grade keys.

---

## `src/core/pageGuards.ts`

| Export | Type / behavior |
|---|---|
| `BULK_RUN_KINDS` | `['attendance', 'evaluation', 'exam-attendance', 'exam-evaluation'] as const` |
| `BulkRunKind` | Union of the above |
| `isBulkRunKind(kind)` | Type guard |
| `normalizePath(pathname)` | Strip one trailing slash |
| `bulkLocalPath(kind)` | `/attendance/scan`, `/evaluation`, `/comprehensive-exams/<id>` |
| `bulkKindMatchesPath(kind, pathname)` | Whether the kind can run on this page |
| `supportedBulkKinds(pathname)` | All kinds that match |
| `remoteTargetMatches(targetPath, kind, targetId)` | Validate path + lesson/exam id |
| `remoteInputAllowed(kind, text)` | Source-side input validation (delegates to exam guards) |

---

## `src/core/examGuards.ts`

| Export | Behavior |
|---|---|
| `COMPREHENSIVE_EXAMS_PREFIX` | `'/comprehensive-exams/'` |
| `examIdFromPath(pathname)` | `/^\/comprehensive-exams\/(\d+)$/` → id or `null` |
| `isComprehensiveExamsPath(pathname)` | Prefix check |
| `isExamPagePath(pathname)` | Numeric exam detail page |
| `examPagePath(examId)` | `'/comprehensive-exams/<id>'` |
| `isExamBulkKind(kind)` | `exam-attendance` / `exam-evaluation` |
| `examTargetAllowed(kind, text)` | Exam input validation via the bulk parsers |
| `examEvalCodesAllowed(codes)` | At least one non-empty code |

---

## `src/core/remoteBulk.ts` / `remoteProtocol.ts`

```ts
type RemoteBulkPhase = 'prepare' | 'arm' | 'run' | 'stop'
type RemoteRequestStatus = 'pending' | 'done' | 'error'

interface RemoteTarget { id: string; kinds: RemoteBulkKind[]; path: string; seenAt: number }
interface RemotePreview { ready: number; invalid: number; needsDecision: number }
interface RemoteRequest {
  id: string; from: string; to: string
  kind: RemoteBulkKind; phase: RemoteBulkPhase
  text: string; createdAt: number; updatedAt: number
  status: RemoteRequestStatus; message?: string; preview?: RemotePreview
}

interface RemoteBulkBridge {
  readonly selfId: string
  targets(): RemoteTarget[]
  request(id: string): RemoteRequest | null
  send(req: Omit<RemoteRequest, 'id' | 'from' | 'createdAt' | 'updatedAt' | 'status'>): Promise<RemoteRequest>
  onRequest(handler: (request: RemoteRequest) => Promise<RemoteRequest> | RemoteRequest): () => void
  onChanged(handler: () => void): () => void
  respond(id: string, patch: Partial<Pick<RemoteRequest, 'status' | 'message' | 'preview'>>): void
  refresh(): void
  dispose(): void
}

function initRemoteBulk(getKinds: () => RemoteBulkKind[]): RemoteBulkBridge
function parseBridgeState(raw: unknown): BridgeState   // { tabs, requests }
```

| Constant | Value |
|---|---|
| `BRIDGE_KEY` | `'tamperina.remoteBulk.v1'` |
| `TAB_TTL_MS` | `15_000` |
| `HEARTBEAT_MS` | `5_000` |
| `REQUEST_TIMEOUT_MS` | `60_000` |
| `REQUEST_TIMEOUT_MESSAGE` | `'Timed out waiting for the target tab'` |
| `MAX_TEXT` | `100_000` |
| `MAX_MESSAGE` | `1_000` |

---

## `src/core/i18n.ts`

| Export | Type / behavior |
|---|---|
| `Locale` | `'ar' \| 'en'` |
| `DEFAULT_LOCALE` | `'ar'` |
| `Message` | `{ ar: string; en: string }` |
| `MessageKey` | `keyof typeof catalog` (549 keys at this baseline) |
| `getLocale()` / `setLocale(locale)` / `subscribeLocale(listener)` | Locale state |
| `listSeparator()` | `', '` (en) or `'، '` (ar) |
| `interpolate(text, vars?)` | Replace `{{name}}` placeholders |
| `t(key, vars?)` | Translate; unknown key returns the key |
| `applyTranslations(root)` | Handle `data-i18n`, `data-i18n-title`, `data-i18n-aria`, `data-i18n-placeholder` |

---

## `src/core/toast.ts`

```ts
type ToastVariant = 'applied' | 'undo' | 'redo' | 'error' | 'warning' | 'info'
interface ToastAction { label: string; onClick(): void }
interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number      // default 5000
  action?: ToastAction
}
function toast(options: ToastOptions): void
function attachToaster(shadow: ShadowRoot): void
```

`toast()` is a no-op until `attachToaster()` replaces its implementation. Max 3 visible; dismiss animation 180ms.

---

## `src/ui/*`

| Module | Export | Notes |
|---|---|---|
| `dom.ts` | `escapeHtml(value)` | Escapes `& < > " '`. |
| `keyShield.ts` | `isEditableTarget(target)`, `isGlobalShortcutKey(event)`, `installKeyShield(hostId)` | Shadow-DOM keyboard retargeting; installed at import time in `ui.ts`. |
| `pagePanels.ts` | `HOLD_PANEL_ID`, `ensurePagePanel(id)`, `ensureHoldPanel()`, `setPagePanelText(panel, title, detail, action)`, `placeHoldNotice(panel, pathname)` | Host-page notice helpers. |
| `examStageTable.ts` | `ExamStageRowView`, `ExamStageLabels`, `ExamStageReviewOptions`, `renderExamStageTable(rows, labels)`, `renderExamStageFields(row, labels, options?)`, `renderExamStageReview(rows, labels, options)` | Pure markup; no platform writes. Fields: `enabled`, `code`, `paymentStatus`, `amountPaid`, `paymentNote`, `source`. |

`src/icons.ts` exports an `icons` object of inline SVGs (Lucide): `flip`, `pause`, `play`, `lock`, `lockOpen`, `clickThrough`, `pin`, `shrink`, `grow`, `toggles`, `bulk`, `undo`, `redo`, `history`, `shieldAlert`, `close`, `center`, `school`, `payment`, `barcode`, `search`, `chevronUp`, `chevronDown`, `userCheck`, `graduationCap`, `keyboard`, `copy`, `download`, `refresh`, `trash`.

---

## Network endpoints used

| Endpoint | Method | Purpose |
|---|---|---|
| `/attendance` | POST | Add attendance (center scan form or direct school mode); replay of removed adds. |
| `/attendance/:id` | DELETE | Remove attendance; undo of an add. |
| `/attendance/live?lesson_id=` | GET | Cache lesson records for undo/export/remove. |
| `/evaluation` `/comprehensive-exams/:id` | observed writes | Grade writes inferred from request bodies; replayed at the original URL. |
| `/comprehensive-exams/:id/check-in` | POST | Exam check-in — observed only, never replayed. |
| `/whatsapp/status` | GET | Read worker sending state. |
| `/whatsapp/worker/start` `/whatsapp/worker/stop` | POST | Start/stop the platform's WhatsApp worker (CSRF required). |
| Lesson students URL (from form data attributes, e.g. `/api/students`) | GET | Roster search with `lesson_id`, `q`, `limit=100`. |

---

## DOM selector registry

| Purpose | Selectors |
|---|---|
| Host | `#tamperina-root` (shadow root) |
| Grade rows | `.evaluation-table tbody tr`, `[data-grade-row]`, `tr[data-grade-row]` |
| Selected row class | `.tamperina-selected` |
| Scan forms | `#examScan`, `#scanForm`, `form[action*="attendance"]` |
| Exam students input | `input#examStudent`, `input[name="student"]` |
| Score input | `input[name="exam_score"]`, `input[name="score"]` |
| Payment modal | `.modal`, `.modal-dialog`, `[class*="payment-modal"]`, `dialog[open]`, `.swal2-popup` |
| Barcode elements | id/class/data-attribute/title/aria-label matches |
| WhatsApp notice | `#tamperina-whatsapp-hold`, `.work-panel[data-work-panel="attendance"] section.station`, `section.station`, `form#examScan` |
| Walk-in form | `#walkInForm`, `#walkInRows`, `#addWalkInRow`, `#walkInState`, `[data-walkin-name]`, `[data-walkin-amount]` |
| Exam stage fields | `[data-exam-stage-row]`, `[data-exam-stage-field]`, `[data-exam-stage-add]`, `[data-exam-stage-remove]` |
| CSRF token | `meta[name="csrf-token"]` |
