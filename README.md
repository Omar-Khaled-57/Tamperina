# Tamperina

[![CI/CD](https://github.com/Omar-Khaled-57/Tamperina/actions/workflows/ci.yml/badge.svg)](https://github.com/Omar-Khaled-57/Tamperina/actions/workflows/ci.yml)

A single userscript for the Ahmed Zakaria platform: pixel-mascot launcher, settings modal, and (one at a time) small workflow tools.

## Status

**M1 — Undo/Redo.** The mascot shell is ready and the first real toggle is live. On `/attendance/scan`, Tamperina records attendance adds/removes; on `/evaluation`, it records a student's grading change and can restore the last saved score/grade. Both work with `Ctrl+Z` / `Ctrl+Y` (plus `Ctrl+Shift+Z`). On attendance, the shortcuts also fire while a search/input field is focused.

**M2 — Bulk attendance.** On `/attendance/scan`, the **الجماعي** tab accepts a list of student codes (one per line) and enters them by driving the page's existing scan form in a loop — no native bulk endpoint and no voice widget. The flow is **معاينة** (no writes) → **تسليح التنفيذ** → **تنفيذ**, with a stop button between codes. A completed run is recorded as **one batch** so `Ctrl+Z` can undo all created records together. The full plan lives in `dev/PLAN.md` (gitignored).

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
| `Esc` / backdrop click | Close the modal |

Open the mascot and use the **المفاتيح** tab to turn Undo/Redo on or off, run undo/redo with buttons, and inspect the per-action log. The toggle is the explicit arming step; undoing a single action does not open a confirmation dialog because the action is itself reversible and every result is confirmed by a toast. History lives only in the current page session and is intentionally cleared on reload.

### Bulk attendance

On `/attendance/scan` (including `?lesson_id=...` links), open **الجماعي**:

1. Paste **codes only** — one per line. Tamperina normalizes Arabic/Persian digits, uppercases, splits on commas/`و`/newlines, removes duplicates, and ignores invalid tokens.
2. Confirm the lesson id (prefilled from the open page). If you change it to a different lesson, open that lesson's scan page first.
3. Click **معاينة** to see what will happen (no writes), then **تسليح التنفيذ**, then **تنفيذ**.

Tamperina fills the scan input and submits one code at a time, waits for server confirmation, and logs each result. **إيقاف** stops between codes. Undo/Redo must be enabled so the run is recorded as one reversible batch.

Suggested prompt for transcribing handwriting:

```text
استخرج أكواد الطلاب فقط من القائمة المكتوبة يدويًا. اكتب كودًا واحدًا في كل سطر، بالأرقام اللاتينية، بدون أسماء أو شرح أو ترقيم.
```

When click-through is on, Tamperina stays visible as a faint ghost and a small pin sits on its corner to restore it. Tampermonkey's menu also has restore/open commands, plus **تشخيص التراجع**, which prints the last observed write requests to the browser console and toasts a short summary. If grading undo does not register, that diagnostic shows whether the request was seen and why it was skipped.

## Notes

- No credentials are stored or used. The script runs inside your existing logged-in session.
- Bulk attendance does not use a separate native bulk API or the platform voice widget; it automates the same single-student scan flow you would do manually.
- `dev/` and `node_modules/` are gitignored; `dist/` is tracked because it is the install artifact.
