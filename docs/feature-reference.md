# <img src="../public/rina/note.png" width="88" align="center" /> Feature Reference

An exhaustive, lookup-friendly reference for everything Tamperina exposes: toggles, shortcuts, bulk actions, input grammars, diagnostics, menu commands and toasts. For step-by-step instructions, read the [User Guide](user-guide.md) first.

---

## Toggles at a glance

All toggles live in the **المفاتيح** (Toggles) tab. "Default" is the state on a fresh install.

| UI label (Arabic) | UI label (English) | Default | Page scope | Persistence |
|---|---|---|---|---|
| التراجع وإعادة التنفيذ | Undo / Redo | On | Everywhere (writes recorded on supported pages) | `GM_setValue` — `tamperina.feature.undoRedo.enabled.v1` |
| مركِز نافذة الدفع | Center modal | Off | Everywhere | `localStorage` — `tamperina_center_modal` |
| إخفاء الباركود | Hide barcode | Off | Everywhere | `localStorage` — `tamperina_barcode_hidden` |
| اختيار الطالب والاختصارات | Student select + hotkeys | On | `/evaluation` | `localStorage` — `tamperina_student-select` |
| شريط البحث في التقييم | Evaluation find bar | On | `/evaluation` | `localStorage` — `tamperina_evaluation-find` |
| أزرار تقييم الواجب | Homework buttons | Off (hard-disabled) | `/evaluation` | `localStorage` — `tamperina_homework-buttons`; `isFeatureEnabled()` always returns `false` in v0.0.22 |
| لوحة حضور الامتحان القابلة للتعديل | Editable exam attendance stage | Off | Everywhere (table shown on `/comprehensive-exams/<id>`) | `GM_setValue` — field `examAttendanceStage` in `tamperina.shell.v1` |
| إيقاف رسائل واتساب حتى الموافقة | Hold WhatsApp until approved | Off | Everywhere (notice on `/comprehensive-exams/*`) | `GM_setValue` — field `holdWhatsappUntilApproved` in `tamperina.shell.v1`, plus ownership marker `tamperina.whatsapp.heldByTamperina.v1` |
| الأوامر الجماعية عن بُعد | Remote bulk actions | Off | Everywhere | `GM_setValue` — field `remoteBulk` in `tamperina.shell.v1`, mirrored into `tamperina.remoteBulk.v1` |
| الوضع الإنجليزي | English mode | Off (Arabic) | Everywhere | `GM_setValue` — field `locale` in `tamperina.shell.v1` |

> Page-gated evaluation switches are disabled outside `/evaluation` but **remember** their state. Turning one off clears its side effects immediately: selection is cleared, or the find bar is closed.

---

## Shortcut matrix

| Shortcut | Gate | Effect |
|---|---|---|
| `Alt+Shift+T` | None | Open modal; if click-through is active, restore the mascot instead. |
| `Ctrl+Z` / `⌘+Z` | Undo enabled, not already busy or batching, and (attendance page, inside Tamperina, or not typing) | Undo one action or batch. Toasts `Undone` / `Undid: <title>`. |
| `Ctrl+Y`, `Ctrl+Shift+Z`, `⌘+Y`, `⌘+Shift+Z` | Same as undo | Redo. Toasts `Redone` / `Redid: <title>`. |
| `Ctrl+Alt+F` | `/evaluation`, find switch on | Toggle find bar. Ignored with Meta held. |
| `Esc` | Global | Close find bar → close modal → clear selected row, in that order. |
| `?`, `؟`, `h`, `H`, `ا` (or `KeyH`) | `/evaluation`, row selected, `student-select` on, find bar closed, no modifier, not typing | Set grade **امتياز**. |
| `ج`, `[`, `{` (or `KeyJ`, `BracketLeft`) | Same | Set grade **جيد جدا**. |
| `ح`, `p`, `P` (or `KeyP`) | Same | Set grade **جيد**. |
| `م`, `l`, `L` (or `KeyL`) | Same | Set grade **مقبول**. |
| `ض`, `q`, `Q` (or `KeyQ`) | Same | Set grade **ضعيف**. |
| `ن`, `k`, `K` (or `KeyK`) | Same | Set grade **الواجب ناقص**. |
| `0-9`, `٠-٩`, `۰-۹`, `.` | Same | Append to typed exam score; one dot only. |
| `Backspace` | Same, while typing | Remove last score character. |
| `Enter` | Same, while typing | Commit the score immediately (otherwise 400ms debounce). |
| `Enter` | Find bar focused, 4-digit query with exact code | Select that student, close the bar, hand focus back to the page. |
| `Shift+Enter` / `Enter` | Find bar focused | Previous / next match (wraps). |
| `−` / `+` on hover pill | Anywhere | Resize mascot by 12px. |
| Mouse wheel on mascot | Anywhere | Resize by the larger scroll axis, snapped to steps. |

The key shield explicitly lets `Escape`, `Alt+Shift+T`, `Ctrl+Alt+F`, and `Ctrl/Cmd+Z|Y` through to document handlers; all other keystrokes originating in Tamperina's shadow inputs are retargeted so the host page sees a real editable field.

---

## Bulk actions

### Run kinds and owning pages

| Kind | Local page | Local path | Undoable | Remote-capable |
|---|---|---|---|---|
| `attendance` | Attendance scan | `/attendance/scan` | Yes (batch) | Yes |
| `evaluation` | Evaluation | `/evaluation` | Yes (batch) | Yes |
| `exam-attendance` | Exam detail | `/comprehensive-exams/<id>` | No | Yes |
| `exam-evaluation` | Exam detail | `/comprehensive-exams/<id>` | Yes | Yes |

`export` and `remove` are local-only actions on `/attendance/scan` and are not run kinds.

### Shared safety gates

| Gate | Rule |
|---|---|
| Preview | Parsing must produce at least one executable entry; exam input must pass its guard. |
| Resolution | No name/identity row may remain in `ambiguous`, `not-found`, `too-many` or `numbers-ambiguous`. |
| Arm | Preview done, not running, staged exam rows present when the stage is visible, and no unresolved rows. **Explicit button press required.** |
| Run | Armed **and** Undo/Redo enabled **and** a scan form present **and** lesson/exam id matching the page. |
| Stop | Takes effect between students/rows; the source tab keeps Stop available after a remote timeout. |
| Batch | One `beginBatch()` / `commitBatch()` per run; partial failures become a warning, not a silent loss. |

Changing a staged field, lesson id, payment override, or input after preview disarms the run.

### Attendance parser

| Aspect | Rule |
|---|---|
| Line splitting | `/\r?\n/` — one student per line. |
| Field separators | `,`, Arabic comma `،`, `;`, Arabic semicolon `؛`. |
| Code format | `/^[A-Z0-9_-]{3,80}$/` after digit normalization and uppercasing. |
| Names | Arabic-only lines without payment are treated as a whole name; otherwise names are searched in the lesson roster. |
| Digits | Arabic-Indic `٠-٩` and Persian `۰-۹` normalized to ASCII. |
| Duplicates / invalid | Reported separately; invalid tokens are never sent. |
| Search | Query with `limit=100`; if no results and the query is code-like, fall back to the lesson roster and match the code exactly. ≥100 results is "too many". |
| Auto-select | One exact match, or one candidate, or exactly two candidates with one 4-digit code. Otherwise the row needs a decision. |

#### Payment grammar

| Input | Meaning |
|---|---|
| `code` / `name` | No payment data sent; the platform lesson default applies. |
| `code, 45, كامل` | Paid, amount 45. |
| `code, 10, مخفض` | Discounted, amount 10. |
| `code, مخفض, 10` | Amount and status may be swapped. |
| `code, 30` | Bare number means **partial**, amount 30. |
| `code, مؤجل` | Status only; no amount is sent. |

| Accepted status word | Internal status |
|---|---|
| `كامل`, `مدفوع`, `paid`, `full` | `paid` |
| `جزئي`, `partial` | `partial` |
| `مخفض`, `مخفض/مجاني`, `مجاني`, `discounted`, `free` | `discounted` |
| `نسي`, `نسي الفلوس`, `مؤجل`, `دفع مؤجل`, `متأخر`, `forgot`, `forgotten`, `deferred` | `forgotten` |

Inline preview overrides use `default | paid | partial | discounted | forgotten`; `default` removes the override. `partial` and `discounted` require an amount (`min=0`, `step=0.01`).

### Evaluation parser

| Aspect | Rule |
|---|---|
| Line format | `identifier, value[, value]`, split on `,`, `،`, tab and backslash. |
| Identifier | Code or name; `#` lines and blanks are skipped. |
| One number | Exam score. |
| One grade text | Homework grade (one of the six known Arabic grade keys). |
| Number + grade | Assigned by type, order flexible. |
| Two numbers | `numbers-ambiguous` — you must map them to `exam` / `homework`. |
| Too many fields / unknown value / no value | Invalid line, reported in the preview. |
| Matching | Exact code → exact name → partial name (1 ready, 2–12 choose, >12 too many). |

### Exam check-in stage fields

| Field | Values | Default for a new row |
|---|---|---|
| Include | checkbox | checked |
| Student code | text (digits normalized) | empty |
| Payment status | `paid`, `exempt`, `deferred` | `paid` |
| Amount | text/decimal | `0.00` |
| Payment note | text | empty |
| Check-in source | `manual`, `scanner`, `camera`, `image` | `manual` |

### Export and remove

| Action | Page | Details |
|---|---|---|
| Export | `/attendance/scan` | `CODE, Name` lines from cached lesson records, deduped, uppercased, Arabic-sorted; copy or download `attendance-ids-<lesson>-<date>.txt` (UTF-8 BOM). |
| Remove | `/attendance/scan` | Refresh live lesson list → preview 20 records (+ count) → arm → run → one undoable batch. |

---

## Diagnostics and logs

| Feature | Where | Contents |
|---|---|---|
| Undo diagnostic | Tampermonkey menu; console `console.table` | Last 20 observed writes: time, method, path, body keys, grade flag, skip reason. Reasons: `exam-checkin`, `no-matching-row`, `no-form-snapshot`, `no-saved-baseline`, `unchanged-from-saved`, `save-not-confirmed`, `no-grade-fields`, `recorded`. |
| Attendance diagnostic | Bulk panel + console `[Tamperina] bulk attendance diagnostic` + Tampermonkey menu | Per-row payload, HTTP status/text/content-type/body, observer result, exception stack, never-attempted lines, run context. |
| Homework diagnostic | Tampermonkey menu; clipboard + console | Page, enabled flag, row count, select names/ids/labels/hidden state/options for the first three rows. |
| Last report | `sessionStorage` `tamperina.bulk.lastRun.v1` | Last attendance report, rows, input, lesson, mode, payment overrides; validated on load. |
| Execution log | Bulk panel | One line per row with status, hoverable raw diagnostic JSON, `HTTP <status>` inline on failures. |

---

## Menu commands

| Command (Arabic default) | Command (English mode) | Action |
|---|---|---|
| Tamperina — معاينة الإشعار | Toast preview | Shows a sample applied toast. |
| Tamperina — نسخ تقرير آخر دفعة حضور | Copy last attendance batch report | Copies the last diagnostic report. |
| Tamperina — تشخيص أزرار الواجب | Diagnose homework buttons | Copies homework detection report. |
| Tamperina — تراجع (Ctrl+Z) | Undo (Ctrl+Z) | Undo. |
| Tamperina — إعادة (Ctrl+Y) | Redo (Ctrl+Y) | Redo. |
| Tamperina — تشغيل/إيقاف التراجع | Toggle undo | Toggle the undo controller. |
| Tamperina — تشخيص التراجع | Undo diagnostic | Print observed writes. |
| Tamperina — فتح الإعدادات | Open settings | Open modal. |
| Tamperina — بحث التقييم (Ctrl+Alt+F) | Evaluation find (Ctrl+Alt+F) | Toggle find bar. |
| Tamperina — إلغاء النقر من خلال | Cancel click-through | Restore mascot. |

Commands are unregistered and re-registered on locale change so captions follow the active language.

---

## Toasts

| Variant | Sticker key | Typical use |
|---|---|---|
| `applied` | `applied` → `logo` fallback | Success, default variant |
| `undo` | `undo` → `applied` fallback | Undo result |
| `redo` | `redo` → `applied` fallback | Redo result |
| `error` | `error` → `applied` fallback | Failed request or action |
| `warning` | `warning` → `applied` fallback | Partial success, warning |
| `info` | `info` → `applied` fallback | Selection, informational messages |

Maximum three visible; the oldest is dismissed when a fourth arrives. Optional action buttons dismiss the toast after running their handler.

---

## Mascot state reference

| State | Persistence | Values |
|---|---|---|
| Position `x`, `y` | `tamperina.shell.v1` | Percent of viewport; drag clamps to x `[4,96]`, y `[5,95]`; stored clamp `[0,100]`. |
| Size | Same | 64–240px, snapped to 12px, default 120. |
| `mirrored`, `paused`, `locked`, `clickThrough` | Same | Booleans. |
| `frame` | Same | `1` (+10°), `2` (−10°), `3` (upright); only used while paused. |
| `activeTab` | Same | `toggles` or `bulk`. |
| `locale` | Same | `ar` or `en`. |
| Host id | DOM | `#tamperina-root`, open shadow root. |
| Restore hotkey | — | `Alt+Shift+T`. |
