import fs from 'node:fs'

const file = process.argv[2] ?? 'dist/tamperina.user.js'
const source = fs.readFileSync(file, 'utf8')
const match = source.match(/^\/\/ @version\s+(\S+)/m)

if (!match) {
  console.error(`No @version header found in ${file}`)
  process.exit(1)
}

process.stdout.write(match[1])
