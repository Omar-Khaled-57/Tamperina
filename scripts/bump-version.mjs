import fs from 'node:fs'

const file = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
const parts = String(pkg.version).split('.').map(Number)

if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
  throw new Error(`Unsupported version format: ${pkg.version}`)
}

parts[2] += 1
pkg.version = parts.join('.')
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
process.stdout.write(pkg.version)
