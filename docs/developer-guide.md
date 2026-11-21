# <img src="../public/rina/note.png" width="88" align="center" /> Developer Guide

Everything you need to build, test, extend and release Tamperina. The generated userscripts are committed to `dist/` because that is what Tampermonkey installs.

---

## Prerequisites and setup

| Requirement | Version / note |
|---|---|
| Node.js | 20+ recommended (CI uses 22) |
| npm | Comes with Node |
| Tampermonkey | For manual smoke-testing the built userscript |
| A logged-in session on `mrahmedzakaria.online` | For end-to-end checks; unit tests need no network |

```bash
git clone https://github.com/Omar-Khaled-57/Tamperina.git
cd Tamperina
npm ci       # or npm install
npm run check
```

`npm run check` is the full gate: typecheck → Vitest → production build → DEV build → `node --check` on both artifacts → i18n integrity. If it passes locally, CI will pass.

---

## Build the userscripts

| Script | Command | Output |
|---|---|---|
| Dev server | `npm run dev` | Vite dev server (HMR) |
| Production | `npm run build` | `dist/tamperina.user.js` |
| Development userscript | `npm run build:dev` | `dist/tamperina.dev.user.js` |
| Typecheck | `npm run typecheck` | `tsc --noEmit` |
| Tests | `npm test` | Vitest, happy-dom |
| Full gate | `npm run check` | Everything above plus artifact syntax + i18n checks |

`build.emptyOutDir` is `false` so production and DEV artifacts coexist. `publicDir` is `false`: nothing under `public/` is copied verbatim. Instead:

- **`rinaAssets()`** (plugin `tamperina-rina-assets`) reads every `.png` / `.webp` in `public/rina/`, trims transparent padding with `sharp.trim({ background: '#00000000', threshold: 5 })`, encodes WebP (`quality: 95`, `alphaQuality: 100`, `effort: 4`) and exposes a virtual module `virtual:tamperina-rina` mapping basename → `data:image/webp;base64,…`. Source images are never modified.
- **`cairoFontCss()`** (plugin `tamperina-cairo-font`) inlines the three Cairo woff2 subsets from `public/fonts/` into a virtual `virtual:tamperina-fonts` module with `@font-face` rules and explicit `unicode-range`s. At runtime `ensureCairoFont()` registers the decoded bytes through the `FontFace` API so host CSP rules do not block them.
- **`monkey()`** emits the userscript headers and outputs the two files.

### Metadata

| Field | Production | DEV |
|---|---|---|
| `name` | `Tamperina` | `Tamperina (DEV)` |
| `match` | `https://mrahmedzakaria.online/*` | `/attendance/scan`, `/evaluation`, `/comprehensive-exams/*`, `localhost:8080`, `127.0.0.1:8080` |
| `run-at` | `document-start` | `document-start` |
| `updateURL` / `downloadURL` | raw GitHub production URL | none |
| `supportURL` | GitHub issues | none |
| grants | `GM_getValue`, `GM_setValue`, `GM_addValueChangeListener`, `GM_removeValueChangeListener`, `GM_registerMenuCommand`, `GM_unregisterMenuCommand`, `unsafeWindow` | same |

Version comes from `package.json`. Check a built artifact with:

```bash
node scripts/read-version.mjs dist/tamperina.user.js
```

---

## Tests

Vitest runs in `happy-dom` with aliases for `$` → `tests/stubs/tampermonkey.ts`, `virtual:tamperina-rina` → a stub mascot and `virtual:tamperina-fonts` → empty CSS.

| Suite | Covers |
|---|---|
| `parsers.test.ts` | attendance/evaluation parsing, digit normalization, roster fallback, exam matching, ambiguous numbers |
| `pageGuards.test.ts` | run kinds ↔ paths, trailing slashes, remote target/id matching, input guards |
| `examGuards.test.ts` | exam id extraction, exam path detection, exam input validation |
| `remoteProtocol.test.ts` | untrusted bridge state, clamping, enum validation, coercion |
| `remoteBulk.test.ts` | tab discovery and request round-trip through serialized GM state |
| `storage.test.ts` | shell defaults, malformed data, clamping, legacy migration |
| `keyShield.test.ts` | editable-target detection, global shortcut detection, shadow keystroke retargeting |
| `uiHelpers.test.ts` | page-panel placement, exam stage markup escaping, review fields, center mode |

Add a test next to the module it exercises. Prefer pure functions for new logic — the project's tests deliberately avoid a real browser and real network.

---

## CI/CD

`.github/workflows/ci.yml` runs on pushes to `main` (source/config/test paths) and on `workflow_dispatch`, skipping bot commits. It:

1. Records the current `dist/` version, package version and artifact hash.
2. Runs `npm run check`.
3. If the generated script did not change, stops.
4. If the package version still matches the artifact, runs `scripts/bump-version.mjs` (patch bump) and re-checks. A developer bump first wins, so minor/major releases are intentional.
5. Refreshes the lockfile, commits both artifacts plus `package.json` / `package-lock.json` as `github-actions[bot]` with `[skip ci]`, and pushes.

**Release checklist:** bump `package.json` yourself for a minor/major release, update `CHANGELOG.md`, run `npm run check`, commit source, let CI publish `dist/`.

---

## Adding things

### A new toggle

1. Add the field and default to `ShellState` in `src/core/storage.ts` (if it is shell state) and validate it explicitly in `loadShell()`.
2. Add the card in `renderFeature()` in `src/core/ui.ts` with a `data-feature-id` attribute, and handle it in the feature-list click handler.
3. If it is page-gated, add the scope to `featureStateSignature()` so the panel re-renders when the page changes.
4. Add both `ar` and `en` strings to the appropriate catalog in `src/core/i18n/` and use `t()` / `data-i18n*`.
5. Add storage tests in `tests/storage.test.ts`; run `npm run check`.

Small evaluation flags use `setFeatureEnabled()` in `src/core/evaluation.ts` instead; page-effect flags use `localStorage` in `src/core/ui.ts`.

### A new keyboard shortcut

Update **both** places:

1. `isGlobalShortcutKey()` in `src/ui/keyShield.ts` — otherwise the host barcode scanner or the shadow bubble shield may swallow it.
2. The document `keydown` handler in `src/core/ui.ts`, plus the shadow-stop bypass condition if the shortcut can originate inside Tamperina's UI.

### A new UI string

1. Add one entry `{ ar, en }` to a catalog in `src/core/i18n/`; keep `{{p0}}` placeholders identical in both locales.
2. Static markup: `data-i18n`, `data-i18n-title`, `data-i18n-aria`, `data-i18n-placeholder`.
3. Generated markup: re-render it on locale change (`rerenderForLocale()`).
4. Run `node scripts/check-i18n.mjs`.
5. Keep host-site Arabic data (grade keys, status words, selectors, examples) out of the catalogs — it must keep matching the real site in both modes.

### A new bulk action

1. Add the kind to `BULK_RUN_KINDS` in `src/core/pageGuards.ts` and its local path in `bulkLocalPath()`.
2. Add parser/resolution logic in `src/core/bulkAttendance.ts` or `src/core/bulkEvaluation.ts`; keep writes behind a preview → arm → run gate.
3. Add the view and wiring in `src/core/ui.ts` (`BulkView`, `showBulkView()`, button handlers), plus i18n keys.
4. If it should work remotely, extend the kind in `src/core/remoteBulk.ts` / `src/core/remoteProtocol.ts` and guard it in `remoteInputAllowed()`.
5. Decide undo semantics: if there is no confirmed inverse request, do **not** record an undo action.

### A new page-effect or host-page panel

Use `src/ui/pagePanels.ts` helpers and place the panel via the anchor priority in `placeHoldNotice()`. Inject document-level CSS through `ensureToggleEffectsStyle()` in `src/core/ui.ts` so it is not trapped inside the shadow root.

---

## Image assets

Docs and the userscript reference images by **source path**, so GitHub renders them without a build step. Two locations with different behavior:

| Location | Build behavior | Recommended contents |
|---|---|---|
| `public/rina/` | Every `.png`/`.webp` is trimmed, WebP-encoded and **inlined into the userscript**, keyed by basename. `logo` is the launcher; `applied` and mapped stickers are used by toasts. | Small transparent stickers only |
| `public/media/` | Not inlined, not copied — used by Markdown only. | Wide screenshots and banners |

The documentation set currently asks for the following files. Everything marked **core** is referenced in README/CHANGELOG/docs today; missing files render as broken images on GitHub.

### Core screenshots — `public/media/`

| File | Suggested size | What to draw |
|---|---|---|
| `banner.png` | 1600×400 | Hero banner: dark coffee/amber palette, pixel Rina peeking from the right, bold Cairo wordmark "Tamperina", subtle grid or scan-line texture. Leave the left half readable for the badge row below it. |
| `work.png` | 1600×900 | Stylized product shot: the corner mascot with its hover pill, the **المفاتيح** modal open, and a hint of the **الجماعي** tab behind it. Realistic platform backdrop, but no real student data. |
| `workflow.png` | 1600×900 | Horizontal three-step diagram — **معاينة وتحليل → تسليح التنفيذ → تنفيذ** — with a row of student codes moving through it and a final toast. Friendly, minimal, Arabic labels. |
| `evaluation.png` | 1600×900 | `/evaluation` page with a selected student row, the find bar at the bottom showing `2/7` highlighted matches, and a small hotkey legend floating to the side. |
| `remote.png` | 1600×900 | Two browser tabs side by side: source tab showing the remote panel with a target list, target tab running the same bulk preview; a thin bridge arrow between them. No credentials or hostnames. |

### Core stickers — `public/rina/*.png`

Use the PNG source files directly in Markdown so links work on GitHub. The userscript build trims transparent padding, encodes each source as WebP, and embeds it; it never modifies the PNGs. The current sticker set is reused across headings and UI states instead of requiring a separate image for every section.

| File | Best fit in docs and app |
|---|---|---|
| `logo.png` | Mascot launcher and general fallback |
| `applied.png` | Successful action toast |
| `wave.png` | Welcome, remote tools, and friendly section headings |
| `update.png` | Releases and update notes |
| `note.png` | Setup, implementation notes, architecture, and neutral information |
| `thumb.png` | Installation, successful workflows, and redo confirmation |
| `keyboard.png` | Controls, shortcuts, evaluation, and API reference |
| `err.png` | Error toast and troubleshooting |
| `limited.png` | Warning toast and known limitations |
| `bug-fixed.png` | Playful milestones and celebratory documentation sections |

### Toast sticker mapping

Toast variants use the closest available art: `applied` → `applied`, `undo` → `note`, `redo` → `thumb`, `error` → `err`, `warning` → `limited`, and `info` → `note`. The app falls back to `applied` and then `logo` if a mapped asset is unavailable.

### Using a new image

```bash
# 1. Drop the file into public/rina/ (sticker) or public/media/ (screenshot)
# 2. Rebuild so the virtual modules pick it up
npm run build
npm run build:dev
```

Reference it in Markdown as `public/rina/<name>.png` from root files and `../public/rina/<name>.png` from `docs/`. Do not reference generated WebP data or `dist/` images; `public/` is not copied into the userscript build output.

---

## Debugging tips

| Symptom | First check |
|---|---|
| A grade write was not recorded | Tampermonkey menu → **Undo diagnostic**; look at `observed` and the skip reason. |
| A bulk run stopped early | Panel **تقرير التشخيص**, console `[Tamperina] bulk attendance diagnostic`, and the "never attempted" section. |
| Typing in the modal is eaten by the page | Rebuild and check `keyShield.ts` capture listeners; the host barcode scanner is the usual cause. |
| Arabic text renders as boxes | Rebuild so Cairo woff2 files are inlined; `ensureCairoFont()` registers them via `FontFace`. |
| Two builds double-record | They share `__tamperinaUndoRedoController_v3` on `unsafeWindow`; check the version constant if not. |
| i18n check fails | Run `node scripts/check-i18n.mjs` for the exact key/placeholder mismatch. |
| Remote tab not listed | Check the target page path, lesson/exam id, heartbeat (5s) and 15s TTL; use a fresh tab if it went stale. |
