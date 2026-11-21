// Tracked i18n integrity check; runs in CI via `npm run check`.
// Verifies: catalog ar/en parity, placeholder parity, t() keys/vars, data-i18n keys.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const src = path.join(root, 'src')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : []
  })
}

const files = walk(src)
const placeholders = (text) => new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))
const problems = []
const catalog = new Map()

// ---- catalog: 'key': { ar: '…', en: '…' } ------------------------------------
for (const file of files.filter((f) => f.includes(`${path.sep}i18n${path.sep}`) || f.endsWith(`${path.sep}i18n.ts`))) {
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(/'([^']+)':\s*\{\s*ar:\s*'([^']*)',\s*en:\s*'([^']*)'\s*\}/g)) {
    const [, key, ar, en] = match
    if (catalog.has(key)) problems.push(`duplicate catalog key ${key}`)
    catalog.set(key, { ar, en, file: path.basename(file) })
  }
}

for (const [key, msg] of catalog) {
  const ar = placeholders(msg.ar)
  const en = placeholders(msg.en)
  if ([...ar].sort().join(',') !== [...en].sort().join(',')) {
    problems.push(`placeholder parity (ar/en): ${key}`)
  }
}

// ---- t() calls and data-i18n attributes --------------------------------------
const usedKeys = new Set()
const tCall = /\bt\(\s*'([^']+)'\s*(?:,\s*\{([^}]*)\})?/g
const dataAttr = /data-i18n(?:-title|-aria|-placeholder)?="([^"]+)"/g

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const label = path.relative(root, file)

  for (const match of source.matchAll(tCall)) {
    const [, key, varsBlock] = match
    usedKeys.add(key)
    const msg = catalog.get(key)
    if (!msg) {
      problems.push(`${label}: unknown t() key ${key}`)
      continue
    }
    const expected = placeholders(msg.ar)
    // Only p0/p1/… are valid t() vars; a bare \w+: would also catch ternary
    // colons inside values (e.g. `error.message : String(error)`).
    const supplied = new Set(varsBlock
      ? [...varsBlock.matchAll(/\b(p\d+)\s*:/g)].map((m) => m[1])
      : [])
    for (const name of expected) {
      if (!supplied.has(name)) problems.push(`${label}: ${key} missing var {{${name}}}`)
    }
    for (const name of supplied) {
      if (!expected.has(name)) problems.push(`${label}: ${key} unused var ${name}`)
    }
  }

  for (const match of source.matchAll(dataAttr)) {
    const key = match[1]
    usedKeys.add(key)
    if (!catalog.has(key)) problems.push(`${label}: unknown data-i18n key ${key}`)
  }
}

for (const problem of problems) console.error(problem)
console.log(`catalog keys: ${catalog.size}; referenced keys: ${usedKeys.size}; problems: ${problems.length}`)
if (problems.length) process.exitCode = 1
else console.log('i18n integrity: PASS')
