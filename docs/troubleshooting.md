# <img src="../public/rina/bug-fixed.png" width="88" align="center" /> Troubleshooting

Tamperina ships diagnostics for the cases that are hard to see from the page alone. This playbook starts with the fastest check for each symptom and explains what the result means.

---

## <img src="../public/rina/note.png" width="70" align="center" /> First, collect evidence

| Command / control | What it gives you |
|---|---|
| Tampermonkey → **Tamperina — تشخيص التراجع** (Undo diagnostic) | Console table of the last 20 observed write requests with skip reasons. |
| Bulk panel → **تقرير التشخيص** → **نسخ التقرير** | Full attendance run report: payloads, HTTP responses, observer results, never-attempted lines. |
| Bulk panel → **نسخ الأكواد الفاشلة** | Just the failed codes for a clean retry. |
| Tampermonkey → **Tamperina — نسخ تقرير آخر دفعة حضور** | Last report even after the panel was closed (kept in `sessionStorage`). |
| Browser console | `[Tamperina] bulk attendance diagnostic` and `[Tamperina homework diagnostic]` output. |
| Tampermonkey → **Tamperina — تشخيص أزرار الواجب** | Detected homework selects, labels and options. |

When reporting a bug, paste the relevant report plus the Tamperina version (`node scripts/read-version.mjs dist/tamperina.user.js`) and the page URL **with student names/codes removed**.

---

## <img src="../public/rina/note.png" width="70" align="center" /> Undo / redo

### A grade change was not recorded

Run the undo diagnostic and match the `reason` column:

| Reason | Meaning | What to do |
|---|---|---|
| `exam-checkin` | Check-in POST observed by design; no undo action exists. | Expected — exam check-ins are not undoable. |
| `no-matching-row` | The write's student id/code did not match a visible grade row. | Make sure the student row is loaded; reload the page and retry. |
| `no-form-snapshot` | No grade form/controls were captured for the row. | Reload so baseline sync runs; check for a changed platform layout. |
| `no-saved-baseline` | No pre-change snapshot existed. | Interact with the row once (focus/click) before grading, or reload. |
| `unchanged-from-saved` | Values already equal the saved baseline. | Nothing to undo; expected. |
| `save-not-confirmed` | The response reported `success`, `ok` or `deleted` as false. | Check the platform response; the write itself may have failed. |
| `no-grade-fields` | Request body did not look like a grade write. | Expected for unrelated POSTs after a grade edit; no action recorded. |
| `recorded` | Action was recorded. | If undo still fails, check the next section. |

### Shortcuts do nothing

- Confirm **التراجع وإعادة التنفيذ** is on (toggle or menu command).
- Undo/redo is disabled while a batch is open (`batching`) or while a replay is in progress (`busy`).
- On pages other than `/attendance/scan`, shortcuts are suppressed while you type in a normal field by design. Inside Tamperina's own inputs they work.
- History lives in `sessionStorage`: it survives reloads and in-platform navigation but **not** closing the tab or browser. Opening a brand-new tab starts empty.
- Production and DEV builds share one controller; if you disabled one via a legacy key, reload both tabs.

### Undo reports partial success

A batch undo can complete some rows and fail others. The toast shows a warning like `Completed N of M — failed: …`. Failed actions remain in history; fix the underlying issue (for example a record already deleted manually) and retry.

---

## <img src="../public/rina/bug-fixed.png" width="70" align="center" /> Bulk attendance

### The run stopped short

Open **تقرير التشخيص**. It separates three cases:

1. **Never attempted** — input lines the loop never reached. This is a genuine early stop: check the Stop button, lesson mismatch, missing scan form, or three consecutive timeouts in center mode.
2. **Problem rows** — attempted but rejected. Look at the raw response body; Laravel `errors` fields and `HTTP <status>` are captured here. A `duplicate`/`already registered` response is reported per row but does not stop the run.
3. **Already registered / skipped** — codes known for the *selected lesson only*. Codes reused in another year group are not skipped.

A missing observer event is logged, not fatal: in school mode the POST response is used to build the undoable snapshot; in center mode the row may be marked `timeout` with `submittedNoUndo` if neither route can produce a record.

### Names show as ambiguous or not found

- Codes are safest. Arabic-Indic and Persian digits are normalized, so `٣٧٦٦` equals `3766`.
- Name search first queries with `limit=100`; if nothing is found and the text is code-like, it falls back to the lesson roster. ≥100 results becomes "too many" — add more of the name.
- When exactly one candidate matches, Tamperina auto-selects it and marks it **✓ المُختار — سيُسجَّل في الحضور**; other results are dimmed. If the highlighted student is wrong, choose another candidate or drop the row.
- Unresolved names never reach the run. You can copy the whole unresolved list before dropping it.

### Payment looks wrong

- Payment is only sent when you wrote it explicitly. A bare `code` line uses the platform's lesson default — it is never silently marked fully paid.
- `كامل` / `مدفوع` → paid, `جزئي` → partial, `مخفض` / `مجاني` → discounted, `نسي` / `مؤجل` / `متأخر` → forgotten. A bare second number means partial.
- Amount and status can be swapped; Arabic comma `،` and semicolons work.
- Inline **الدفع** controls in the preview override parsed values; **افتراضي الحصة** removes the override.
- `partial` and `discounted` overrides require an amount; arming is blocked until it is provided.
- Changing a payment control after preview disarms the run — arm again before running.

### Walk-in registration failed

- The walk-in panel must be present on the page; if collapsed, open it first. Tamperina tries to click a toggle matching `طلاب جدد بدون كارت` / `بدون كارت` / `walk-in`.
- The default amount is `45` when you do not write one; each amount is editable in the preview.
- Successful registrations are removed from the attendance batch and logged as `walk-in` / `created`. They are **not undoable**.

### The batch cannot be undone

- Undo/Redo must be enabled before you arm and run.
- Exam attendance check-ins, walk-in registrations and other actions without a confirmed inverse request are intentionally excluded from undo.
- The completion toast reports the created / already present / skipped / failed breakdown; that snapshot is also stored in `sessionStorage`.

---

## <img src="../public/rina/keyboard.png" width="70" align="center" /> Evaluation tools

| Symptom | Check |
|---|---|
| Grade hotkeys do nothing | A row must be selected (`student-select` on, no Ctrl/Meta/Alt, find bar closed, focus not in a field). The selected row is outlined and a toast confirms it. |
| Hotkeys fight the keyboard layout | Aliases cover Arabic and English layouts plus physical codes; if a custom layout remaps keys, use the Arabic character aliases. |
| Score does not commit | Type digits and `.` only; `Enter` commits immediately, otherwise a 400ms pause dispatches `change`. Arabic-Indic digits are normalized. |
| Find bar will not open | `Ctrl+Alt+F` works only on `/evaluation` with the find switch on. Plain `Ctrl+F` is left to the browser. |
| Four-digit code does not select | The query must normalize to exactly four digits and match a row code. This works even when selection is off; press `Enter` to hand off to the student. |
| Highlights do not appear | The browser may not support CSS Custom Highlights; Tamperina falls back to row classes. Styling is injected into `document.head`. |
| Homework buttons missing | Expected in v0.0.22 — the feature is hard-disabled. Bulk evaluation can still set the homework grade; the menu diagnostic reports what was detected. |

---

## <img src="../public/rina/wave.png" width="70" align="center" /> Remote bridge

| Symptom | Likely cause / fix |
|---|---|
| No target tabs listed | Remote mode must be on in at least the target tab. Tabs advertise every 5s and expire after 15s; refresh or reload the target tab and wait. |
| Target tab listed but action rejected | The target must be on the exact matching page: same kind and same lesson id (`?lesson_id=…`) or exam id in `/comprehensive-exams/<id>`. |
| Prepare works, arm fails | The target re-checks that its local input is identical and that its preview is ready. Re-prepare after changing input, then resolve any decision rows. |
| `Timed out waiting for the target tab` | No response within 60s. The target may still be running — keep the source tab open and press **stop**. Check that the target tab stayed open. |
| Remote run had no undo entry | The target tab's history is authoritative. Undo there, not in the source tab. Exam check-ins are never undoable. |

---

## <img src="../public/rina/limited.png" width="70" align="center" /> Install, UI and platform integration

| Symptom | Fix |
|---|---|
| Mascot disappeared / clicks pass through | Press `Alt+Shift+T`, click the small restore pin, or use **Tamperina — Cancel click-through**. |
| Modal will not close | `Esc` closes in order: find bar → modal → selection. Clicking the backdrop also closes it. |
| Arabic text shows as boxes | Rebuild the userscript: Cairo subsets are inlined at build time and registered via `FontFace`, so a stale artifact may lack them. |
| Typing in Tamperina's inputs is eaten | The host page's barcode scanner is the usual cause. Ensure the current build includes `src/ui/keyShield.ts`; it retargets shadow keystrokes to a real editable field. |
| Actions recorded twice | Both production and DEV builds enabled. They share `__tamperinaUndoRedoController_v3` on `unsafeWindow`; reload both tabs after updating. |
| Tampermonkey does not auto-update | Install from the raw production URL, not a local file. The DEV build intentionally has no update URL. |
| A CSS override stopped working | Page-effect CSS is injected into `document.head` by `ensureToggleEffectsStyle()`; a platform markup change can break its selectors. Report the page URL. |

---

## <img src="../public/rina/limited.png" width="70" align="center" /> Known limitations

- **Exam check-ins are not undoable.** `POST /comprehensive-exams/<id>/check-in` has no confirmed delete route; replaying `DELETE /attendance/:id` would target the wrong resource.
- **Walk-in registrations are not undoable.** They create a student and a collection through the platform's own form.
- **Homework buttons are hard-disabled in v0.0.22.** `isFeatureEnabled('homework-buttons')` returns `false` unconditionally; the native homework dropdown is left alone. The grade machinery, bulk homework grades and the diagnostic remain.
- **Bulk attendance depends on platform markup.** Center mode drives the scan form; school mode posts one student at a time with concurrency 5. A platform redesign can break form detection (`detectScanForm()`) or student search.
- **Remote mode needs a live target tab.** It is a GM-value protocol, not a server; closing the target tab or losing heartbeat advertisements stops discovery.
- **Session-scoped history.** Undo history and the last bulk report live in `sessionStorage` and are lost when the tab/browser closes.
- **No credentials or tokens stored.** Tamperina runs in your logged-in session; replay only allows four safe request headers.
- **English mode is cosmetic for host data.** Grade keys, payment status words, hotkey characters, CSS selectors and example inputs stay Arabic by design.

---

## Reporting a problem

1. Reproduce with Undo/Redo enabled so the diagnostic has data.
2. Copy the relevant diagnostic report (undo diagnostic console table, bulk report, or homework diagnostic).
3. Note the Tamperina version, browser, page URL (redacted), and what you expected.
4. Open an issue at `https://github.com/Omar-Khaled-57/Tamperina/issues`.
