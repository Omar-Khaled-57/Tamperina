import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const pkg = require('./package.json') as { version: string }
const rinaId = 'virtual:tamperina-rina'
const rinaResolved = `\0${rinaId}`
const fontId = 'virtual:tamperina-fonts'
const fontResolved = `\0${fontId}`

/* Unicode ranges from Google Fonts for the three Cairo variable subsets we ship. */
const cairoArabicRange = 'U+0600-06FF, U+0750-077F, U+0870-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC7, U+10EC9-10EEE, U+10EF0-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1;'
const cairoLatinExtRange = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF;'
const cairoLatinRange = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;'

let rinaAssetsPromise: Promise<Record<string, string>> | undefined

/** Build the Rina data-URL map once per Vite process, not once per load call. */
function loadRinaAssets(): Promise<Record<string, string>> {
  if (!rinaAssetsPromise) {
    rinaAssetsPromise = (async () => {
      const dir = path.join(projectRoot, 'public/rina')
      const files = fs.readdirSync(dir)
        .filter((file) => /\.(png|webp)$/i.test(file))
        .sort()
      const assets: Record<string, string> = {}
      for (const file of files) {
        const input = fs.readFileSync(path.join(dir, file))
        const webp = await sharp(input)
          .trim({ background: '#00000000', threshold: 5 })
          .webp({ quality: 95, alphaQuality: 100, effort: 4 })
          .toBuffer()
        assets[path.parse(file).name] = `data:image/webp;base64,${webp.toString('base64')}`
      }
      return assets
    })()
  }
  return rinaAssetsPromise
}

/**
 * Inlines every Rina image in public/rina (logo, toast stickers, future poses)
 * as trimmed lossless-WebP data URLs, keyed by filename without extension.
 * Source files are never modified — dropping in a new image just works.
 */
function rinaAssets() {
  return {
    name: 'tamperina-rina-assets',
    resolveId(id: string) {
      if (id === rinaId) return rinaResolved
    },
    async load(id: string) {
      if (id !== rinaResolved) return
      const assets = await loadRinaAssets()
      return `export default ${JSON.stringify(assets)}`
    },
  }
}

/**
 * Inlines the Cairo variable font (Arabic, Latin and Latin-ext subsets) as
 * @font-face rules. Keeps the userscript self-contained; the CSS is injected
 * into document.head because Chrome/Firefox ignore @font-face declared only
 * inside a Shadow DOM stylesheet.
 */
function cairoFontCss() {
  return {
    name: 'tamperina-cairo-font',
    resolveId(id: string) {
      if (id === fontId) return fontResolved
    },
    load(id: string) {
      if (id !== fontResolved) return
      const dir = path.join(projectRoot, 'public/fonts')
      const face = (file: string, range: string) => {
        const data = fs.readFileSync(path.join(dir, file)).toString('base64')
        return `@font-face{font-family:'Cairo';font-style:normal;font-weight:200 1000;font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${range}}`
      }
      const css = face('cairo-arabic.woff2', cairoArabicRange)
        + face('cairo-latin-ext.woff2', cairoLatinExtRange)
        + face('cairo-latin.woff2', cairoLatinRange)
      return `export default ${JSON.stringify(css)}`
    },
  }
}

const rawUrl = 'https://raw.githubusercontent.com/Omar-Khaled-57/Tamperina/main/dist/tamperina.user.js'

export default defineConfig(({ mode }) => {
  const isDev = mode === 'dev'

  return {
    // Rina images and fonts are inlined via virtual modules; don't copy public/ into dist/.
    publicDir: false,
    build: {
      // Keep both the production and DEV userscripts in dist/ after separate builds.
      emptyOutDir: false,
    },
    plugins: [
      rinaAssets(),
      cairoFontCss(),
      monkey({
        entry: 'src/main.ts',
        userscript: {
          name: isDev ? 'Tamperina (DEV)' : 'Tamperina',
          namespace: 'https://github.com/Omar-Khaled-57/Tamperina',
          version: pkg.version,
          description: isDev
            ? 'DEV build of Tamperina — live attendance + evaluation pages'
            : 'Pixel mascot launcher and growing toolkit for the Ahmed Zakaria platform',
          author: 'Omar Khaled',
          'run-at': 'document-start',
          match: isDev
            ? [
                'https://mrahmedzakaria.online/attendance/scan',
                'https://mrahmedzakaria.online/evaluation',
                'http://localhost:8080/*',
                'http://127.0.0.1:8080/*',
              ]
            : ['https://mrahmedzakaria.online/*'],
          grant: ['GM_getValue', 'GM_setValue', 'GM_registerMenuCommand', 'unsafeWindow'],
          ...(isDev
            ? {}
            : {
                updateURL: rawUrl,
                downloadURL: rawUrl,
                supportURL: 'https://github.com/Omar-Khaled-57/Tamperina/issues',
              }),
        },
        build: {
          fileName: isDev ? 'tamperina.dev.user.js' : 'tamperina.user.js',
        },
      }),
    ],
  }
})
