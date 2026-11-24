# <img src="public/rina/logo.png" width="120" align="center" /> Tamperina Changelog

All notable changes, release notes, and version history for **Tamperina** are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version in `package.json` is the source of truth and is copied into the `@version` header of both generated userscripts at build time.

<br />

<div align="center">
  <img src="public/media/banner.png" alt="Tamperina Banner" width="100%" style="border-radius: 10px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);" />
</div>

<br />

---

## <img src="public/rina/note.png" width="90" align="center" /> About this file

This changelog was started on **2026-11-21** at version **0.0.22**. Entries before that date were not recorded in a changelog, so the 0.0.22 entry below is a **reconstructed baseline**: it describes the feature set that was present in the code at that baseline, rather than inventing historical release notes. From here on, every version bump should add its own section.

---

## <img src="public/rina/bug-fixed.png" width="100" align="center" /> [0.0.24] — 2026-11-24

### Fixed

- **Evaluation hotkey "جيد جدا"**: `normalizeLabel()` now strips Arabic tashkeel/harakat (`U+064B–U+065F`, `U+0670`) before comparing grade labels. Platform option text that includes diacritics (e.g. `جيد جدًا`) now matches the plain `جيد جدا` key, so the hotkey and grade-button classification work reliably.

---

## <img src="public/rina/update.png" width="100" align="center" /> [0.0.23] — 2026-11-24

### Added

- Documentation suite under [`docs/`](docs/README.md): documentation hub, user guide, feature reference, architecture, developer guide, API reference and troubleshooting playbook.
- Stylized README and this changelog (documentation only; no userscript behavior changed in that pass).

### Changed

- The evaluation find bar now smoothly lifts toasts and the mascot launcher out of its way while open, then slides them back down when it closes (respecting reduced-motion settings).
- Rina stickers are inlined at 256px with an alpha-scan trim instead of `sharp.trim()` on the full-size originals. Builds dropped from ~8s to ~1.2s, both userscripts from ~4.5MB to ~1MB, and the `PLUGIN_TIMINGS` warning is gone. On-screen art is unchanged at its 120px launcher / 64px toast sizes.

---

## <img src="public/rina/update.png" width="120" align="center" /> [0.0.22] — 2026-11-21 · *Baseline: One Mascot, Four Tool Families*

> Reconstructed baseline of the current userscript. Tamperina runs on the Ahmed Zakaria platform as a single self-contained userscript: a pixel launcher in the corner, a modal with **المفاتيح** (Toggles) and **الجماعي** (Bulk), and workflow tools that drive the platform's own forms and requests. No credentials are stored; no private backend is called.

### <img src="public/rina/bug-fixed.png" width="80" align="center" /> ✦ Added — shell and platform integration

- **Pixel mascot launcher** (`src/core/ui.ts`): draggable, resizable (64–240px in 12px steps), mirrorable, pausable with three manual frames, lockable, and click-through with a restore pin. Position, size and visual state are persisted in `GM_setValue` under `tamperina.shell.v1`.
- **Shadow-DOM shell** with a dark Cairo design system (`src/ui/styles.css`): all Tamperina UI is isolated from host-page CSS, uses the inlined Cairo variable font, and switches between RTL/Arabic and LTR/English.
- **Keyboard shield** (`src/ui/keyShield.ts`): retargets shadow-DOM keystrokes past the platform's document-level barcode scanner so typing in Tamperina's own inputs keeps working; global shortcuts are explicitly exempted.
- **Toast system** (`src/core/toast.ts`): six variants (`applied`, `undo`, `redo`, `error`, `warning`, `info`) with sticker icons, a max of three visible toasts, optional action buttons, and i18n-labeled close controls.
- **Tampermonkey menu commands**: open settings, undo/redo, toggle undo, undo diagnostic, evaluation find, last bulk report copy, homework-button diagnostic, toast preview, and click-through restore. Captions are re-registered when the language changes.

### <img src="public/rina/thumb.png" width="80" align="center" /> ✦ Added — M1: undo/redo

- **Network observer** (`src/core/undoRedo.ts`) installed at `document-start` on both `fetch` and `XMLHttpRequest`: records attendance adds/removes and confirmed grade writes, with grade baselines captured before each programmatic change.
- **Reversible batches**: `beginBatch()` / `commitBatch()` collapse a whole bulk run into one undoable action; partial failures are isolated and reported.
- **Session persistence** in `sessionStorage` (`tamperina.undoRedo.session.v1`): history survives reloads and in-platform navigation, and persisted actions are recursively validated before being revived.
- **Shortcuts**: `Ctrl+Z` / `⌘+Z` to undo, `Ctrl+Y` / `Ctrl+Shift+Z` / `⌘+Shift+Z` to redo, including inside focused inputs on `/attendance/scan`.
- **Diagnostics**: the Tampermonkey *Undo diagnostic* command prints the last 20 observed write requests with skip reasons such as `no-matching-row`, `no-saved-baseline`, `unchanged-from-saved` and `save-not-confirmed`.

### <img src="public/rina/thumb.png" width="80" align="center" /> ✦ Added — M2: bulk actions

- **Bulk attendance** (`src/core/bulkAttendance.ts`): paste codes or names one per line; normalize Arabic/Persian digits, dedupe, search the lesson roster, resolve ambiguous/not-found names, then preview → arm → run. Center mode drives the page's scan form sequentially; school mode posts five students in parallel. Each row is logged; runs become one undoable batch.
- **Payment input**: inline `code, amount, status` parsing with Arabic status words and comma variants; payment data is only sent when explicitly written, so the platform's lesson default is never silently overwritten.
- **Walk-in registration**: unresolved names can be registered through the platform's own `#walkInForm`, with editable per-student amounts and a 45 default. These registrations are not undoable.
- **Diagnostic report** per bulk run: request payloads, HTTP status/body, observer results, never-attempted lines, copy-full-report/copy-failed-codes actions, console output and menu access to the last report.
- **Attendance export**: cached lesson records copied as `CODE, Name` lines or downloaded as UTF-8 `.txt` with BOM.
- **Remove all lesson attendance**: loads the live list, previews up to 20 records, arms, deletes through the undo controller and commits one reversible batch.
- **Bulk evaluation** (`src/core/bulkEvaluation.ts`): paste `code, exam, homework` lines, resolve identifiers against the current page, disambiguate two numeric values, apply through the page's own controls as one undoable batch.

### <img src="public/rina/keyboard.png" width="80" align="center" /> ✦ Added — M3: evaluation tools

- **Student select + hotkeys** (`src/core/evaluation.ts`): click a row to select it, then grade with Arabic/English key aliases or type digits and `.` into the exam score, with Arabic-Indic digit normalization and a 400ms debounced commit.
- **Evaluation find bar** (`src/core/findBar.ts`): `Ctrl+Alt+F`, Firefox-style match navigation, CSS Custom Highlights with class fallback, and four-digit code auto-select/hand-off that works independently of the selection toggle.
- **Homework button diagnostic**: menu command that reports detected selects, labels and options for the first three rows; the button replacement itself is currently switched off (see Known limitations).

### <img src="public/rina/wave.png" width="80" align="center" /> ✦ Added — M4: exam and remote tools

- **Editable exam attendance stage** (`src/ui/examStageTable.ts`): add/remove staged rows, include/exclude, payment status, amount, note and check-in source; edits disarm the run and Confirm submits through the platform's own `#examScan` form.
- **WhatsApp hold**: stops the WhatsApp worker on exam pages and shows an in-page notice; only a worker Tamperina stopped itself is resumed.
- **Remote bulk bridge** (`src/core/remoteBulk.ts`, `src/core/remoteProtocol.ts`): four run kinds can be prepared, armed and run in another tab through an `GM_setValue` protocol with heartbeats, 15s tab TTL, 60s request timeout and strict validation of all bridge data.
- **English mode**: a persisted shell toggle flips Tamperina-owned labels and the shadow layout to LTR, including Tampermonkey menu captions; host-page Arabic data stays unchanged.
- **Page helpers**: centered payment modal, barcode hiding, page-panel notice placement, and i18n integrity checks (`scripts/check-i18n.mjs`, 549 catalog keys at this baseline).

### <img src="public/rina/bug-fixed.png" width="80" align="center" /> ✦ Fixed / hardened in the baseline

- Bulk attendance continues after a failed post or missing observer event instead of stopping the whole list; school mode falls back to the POST response to build an undoable snapshot.
- "Already registered" checks are scoped to the selected lesson, so codes reused in other year groups are not skipped.
- Ambiguous name resolution distinguishes auto-selected students from other dimmed results, making it explicit who will be recorded.
- Undo/redo shortcuts work in attendance inputs despite the host page's barcode scanner; invalid persisted history is dropped rather than replayed.
- Cairo fonts are registered through `FontFace` so shadow-DOM Arabic text renders even when the host CSP blocks `data:` font sources.

### <img src="public/rina/limited.png" width="80" align="center" /> ✦ Known limitations (honest disclosure)

- **Exam check-ins are not undoable:** the observed `POST /comprehensive-exams/<id>/check-in` has no confirmed delete route; replaying a generic attendance delete would target the wrong resource.
- **Walk-in registrations are not undoable:** they create a student and a collection through the platform's own form.
- **Homework buttons are hard-disabled at this baseline:** `isFeatureEnabled('homework-buttons')` returns `false` unconditionally; the native homework dropdown is left alone. The save machinery and diagnostic remain in the code.
- **Bulk attendance is automation, not an API:** center mode loops the scan form and school mode posts one student at a time; runtime depends on the platform's own markup staying stable.
- **Remote mode needs two enabled tabs:** the source tab sends commands, the target tab must remain open on the matching page and execute the run.

<br />

---

<div align="center">
  <sub>Release notes for v0.0.24 · see <a href="docs/README.md">docs/</a> for the full manual.</sub>
</div>
