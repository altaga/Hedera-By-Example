// Every name a lab imports from M99_Utilities must exist in the browser runner too,
// or the lab works with `node` but fails on the website ("X is not a function").
// Run: node tests/12_browser_helpers.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runner = fs.readFileSync(path.join(root, 'app/src/lib/hederaBrowser.ts'), 'utf8')
const start = runner.indexOf('const helpers: Record<string, unknown> = {')
const block = runner.slice(start, runner.indexOf('\n    }\n', start))
const provided = new Set([...block.matchAll(/^\s+([A-Za-z_$][\w$]*)\s*[,:]/gm)].map((m) => m[1]))

// Names served by the bundled vendor build instead of `helpers`.
const x402 = fs.readFileSync(path.join(root, 'course/English/M99_Utilities/x402.js'), 'utf8')
for (const m of x402.matchAll(/export (?:const|function|async function) (\w+)/g)) provided.add(m[1])
provided.add('AgentCommunicationHandler')
// HCS-1 helpers (M99_Utilities/hcs1.js) are attached from the vendor build when a lab uses them.
const hcs1 = fs.readFileSync(path.join(root, 'course/English/M99_Utilities/hcs1.js'), 'utf8')
for (const m of hcs1.matchAll(/export (?:const|function|async function) (\w+)/g)) provided.add(m[1])

const missing = new Map()
for (const lang of ['English', 'Spanish']) {
  for (const mod of fs.readdirSync(path.join(root, 'course', lang))) {
    const dir = path.join(root, 'course', lang, mod)
    if (!/^M\d+_/.test(mod) || mod.startsWith('M99') || !fs.statSync(dir).isDirectory()) continue
    for (const file of fs.readdirSync(dir).filter((f) => /^\d+.*\.js$/.test(f))) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8')
      for (const m of src.matchAll(/import \{([^}]*)\} from '\.\.\/M99_Utilities\/index\.js'/g)) {
        for (const name of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
          if (!provided.has(name)) missing.set(name, [...(missing.get(name) || []), `${lang}/${mod}/${file}`])
        }
      }
    }
  }
}

if (missing.size) {
  for (const [name, files] of missing) console.error(`✗ ${name} is not provided by the browser runner (used in ${files.length} labs, e.g. ${files[0]})`)
  process.exit(1)
}
console.log(`✅ TEST 12 PASSED: every M99 import used by the labs exists in the browser runner (${provided.size} names).`)
