# Tamperina

[![CI/CD](https://github.com/Omar-Khaled-57/Tamperina/actions/workflows/ci.yml/badge.svg)](https://github.com/Omar-Khaled-57/Tamperina/actions/workflows/ci.yml)

A single userscript for the Ahmed Zakaria platform: pixel-mascot launcher, settings modal, and (one at a time) small workflow tools.

## Status

**M1 — Undo/Redo.** The mascot shell is ready and the first real toggle is live. On `/attendance/scan`, Tamperina records attendance adds/removes; on `/evaluation`, it records a student's grading change and can restore the last saved score/grade. Both work with `Ctrl+Z` / `Ctrl+Y` (plus `Ctrl+Shift+Z`). On attendance, the shortcuts also fire while a search/input field is focused.

**M2 — Bulk actions.** The **الجماعي** tab shows bulk action items (attendance, evaluation placeholder, and a coming-soon slot). **تسجيل حضور جماعي** works on `/attendance/scan`: paste student codes or names (one per line), analyze/preview, resolve any ambiguous or not-found names (choose, edit, or drop), then arm and run. It drives the page's existing scan form in a loop — no native bulk endpoint and no voice widget. A completed run is recorded as **one batch** so `Ctrl+Z` can undo all created records together. The full plan lives in `dev/PLAN.md` (gitignored).

**M3 — Evaluation tools.** Three new independent switches in **المفاتيح**, active on `/evaluation`: select a student and grade them with hotkeys, a Firefox-style find bar on `Ctrl+Alt+F` (4-digit ID auto-selects a student), and glowy homework-grade buttons. All of them set the page's own controls and dispatch `change`, so the platform's auto-save and Tamperina's undo/redo keep working.

## Build

```bash
npm install
npm run build
```

Run `npm run check` to typecheck, build both production and DEV scripts, and syntax-check the generated artifacts — the same sequence CI uses.

Output: `dist/tamperina.user.js` — a single self-contained file. The mascot from `public/rina/logo.png` is inlined as a data URL at build time, so swap in your optimized PNG there and rebuild. The build trims transparent padding automatically (the original PNG has a lot of empty space around the head) and encodes every image in `public/rina/` as high-quality WebP with full alpha; your source files are never modified. Drop in a new Rina image (for example `applied.png`) and it becomes available as a toast sticker automatically. The Cairo variable font (Arabic, Latin and Latin-ext subsets in `public/fonts/`) is also inlined and injected into `document.head`, so Arabic text renders in Cairo inside the Shadow DOM without depending on the host page.

## CI/CD

Pushing a source change to `main` runs `.github/workflows/ci.yml`. It typechecks, builds both userscripts, syntax-checks them, and commits `dist/` back to `main` with `[skip ci]` so Tampermonkey's update URL always points at a fresh artifact. No manual upload is needed.

If the generated script changes and `package.json` still has the old version, CI bumps the patch version automatically. Bump it yourself first when you want a minor or major release.

The committed artifact is the install/update source. You can check the generated `@version` locally with:

```bash
node scripts/read-version.mjs dist/tamperina.user.js
```

## Install

Install from the raw GitHub URL so Tampermonkey can auto-update:

```
https://raw.githubusercontent.com/Omar-Khaled-57/Tamperina/main/dist/tamperina.user.js
```

For live testing, build with `npm run build:dev` and re-import `dist/tamperina.dev.user.js`. The DEV build matches the two live feature pages directly and has no update URL, so Tampermonkey will not refresh it automatically. If both DEV and production builds are enabled at the same time, they share one network-observer controller via `unsafeWindow`, so actions are only recorded once.

## Controls

| Action | Result |
|---|---|
| Hover the mascot | Pill appears above it: shrink / grow, mirror, pause, lock, click-through |
| `−` / `+` buttons, or mouse wheel | Resize the mascot (64–240px, snapped to 12px steps; saved) |
| Pause | Reveals three frame buttons: **F1** (+10°), **F2** (−10°), **F3** upright (0°) |
| Drag the mascot | Move it anywhere (position saved as % of viewport) |
| Click the mascot | Open the options modal (Toggles / Bulk tabs) |
| `Alt+Shift+T` | Open the modal, or restore the mascot after click-through |
| `Ctrl+Z` / `⌘+Z` | Undo the last recorded attendance, grading, or bulk-batch action |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo the last undone action |
| Focused input on `/attendance/scan` | Undo/redo shortcuts still run Tamperina instead of the browser's text undo |
| `Esc` / backdrop click | Close the modal, close the find bar, or clear the selected student (in that order) |
| `Ctrl+Alt+F` (on `/evaluation`) | Toggle the evaluation find bar; plain `Ctrl+F` stays with the browser |

Open the mascot and use the **المفاتيح** tab to turn Undo/Redo on or off, run undo/redo with buttons, and inspect the per-action log. The toggle is the explicit arming step; undoing a single action does not open a confirmation dialog because the action is itself reversible and every result is confirmed by a toast. History lives only in the current page session and is intentionally cleared on reload.

### Evaluation tools (`/evaluation`)

The three new switches are independent and default to on. They are disabled (but remember their state) outside `/evaluation`.

**اختيار الطالب والاختصارات** — click a student's row to select it, then use these keys. They work under both Arabic and English layouts:

| Key(s) | Grade |
|---|---|
| `?` / `؟` / `h` / `H` / `ا` | امتياز |
| `ج` / `[` / `{` | جيد جدا |
| `ح` / `p` / `P` | جيد |
| `م` / `l` / `L` | مقبول |
| `ض` / `q` / `Q` | ضعيف |
| `ن` / `k` / `K` | الواجب ناقص |

Digits and `.` type into the selected student's **exam score** (`7.5` works, Arabic-Indic digits are normalized). The first digit starts a new value; Backspace deletes; Enter or a short pause commits. Hotkeys are ignored while typing in a field or in the find bar.

**شريط البحث في التقييم** — `Ctrl+Alt+F` opens a Firefox-style bar at the bottom. It searches all student rows, highlights matches, and `Enter` / `Shift+Enter` move between them; `Esc` closes it. A query of exactly four digits (Latin or Arabic) selects the matching student automatically, even if the selection toggle is off.

**أزرار تقييم الواجب** — replaces the detected homework dropdown with colored glowing buttons. Clicking one selects that student and updates the grade through the page's own select, so its auto-save and undo/redo still apply. With this switch on, the letter hotkeys above also set the homework grade when a student is selected.

### Bulk actions

Open **الجماعي** to see available bulk actions. **تقييم جماعي** and additional actions are placeholders for later.

#### تسجيل حضور جماعي

On `/attendance/scan` (including `?lesson_id=...` links):

1. Paste one student per line — a **code** or a **name**. Tamperina normalizes Arabic/Persian digits, removes duplicates, and ignores invalid tokens.
2. Confirm the lesson id (prefilled from the open page). If you change it to a different lesson, open that lesson's scan page first.
3. Click **معاينة وتحليل**. Codes are accepted directly; names are searched in the lesson's students.
4. Resolve any names that are **not found**, **ambiguous**, or have **too many matches**: choose the correct student, edit the name and re-search, or **تجاهل (يدويًا)** to skip and handle manually.
5. When everything is resolved or dropped, click **تسليح التنفيذ**, then **تنفيذ**.

Tamperina submits one student at a time (sequential scan-form loop in **سنتر** mode, parallel direct posts in **مدرسة** mode), waits for the shared observer's confirmation, and logs each result. **إيقاف** stops between students. Undo/Redo must be enabled so the run is recorded as one reversible batch. A post without observer confirmation is logged as an error and stops the run instead of being reported as an undoable success.

#### School-mode payment input

One student per line. A code or a name is enough; payment is optional and only sent when written explicitly:

```text
2017, 45, كامل
2016, 10, مخفض
2015, مخفض, 10
أحمد محمد, 0, نسي
أحمد محمد, مؤجل
2018, 30
2019
أحمد محمد
```

Accepted status words: `كامل/مدفوع`, `جزئي`, `مخفض/مجاني`, `نسي/مؤجل/متأخر`. Either comma `,` or the Arabic comma `،` works; amount and status may be swapped. A bare second number means **partial** payment. With no payment field, Tamperina sends no payment data at all and the platform's own lesson default applies — it never silently marks students as fully paid. The inline **الدفع** controls in the preview can override any entry, including resetting it to **افتراضي الحصة**.

Suggested prompt for transcribing handwriting (codes are safest, names are also supported):

```text
استخرج طلاب القائمة المكتوبة يدويًا. اكتب في كل سطر كود الطالب إن كان واضحًا، وإلا اكتب اسم الطالب كما هو. سطر واحد لكل طالب، بدون شرح أو ترقيم.
```

When click-through is on, Tamperina stays visible as a faint ghost and a small pin sits on its corner to restore it. Tampermonkey's menu also has restore/open commands, plus **تشخيص التراجع**, which prints the last observed write requests to the browser console and toasts a short summary. If grading undo does not register, that diagnostic shows whether the request was seen and why it was skipped.

## Notes

- No credentials are stored or used. The script runs inside your existing logged-in session.
- Bulk attendance does not use a separate native bulk API or the platform voice widget; it automates the same single-student scan flow you would do manually.
- `dev/` and `node_modules/` are gitignored; `dist/` is tracked because it is the install artifact.
