/**
 * Keeps the machine-readable files for AI agents in step with the course:
 *   - public/llms-full.txt: the "Course map" section is rebuilt from src/content/index.json
 *   - public/llms.txt, public/llms-full.txt, public/mcp/tools.json: lab and module counts
 * Runs as part of build-content.mjs, so a lab added or removed can never leave these stale.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PUBLIC = path.join(ROOT, 'public')

export function buildLlms () {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'content', 'index.json'), 'utf8'))
  const modules = index.modules
  const labCount = modules.reduce((n, m) => n + m.labs.length, 0)
  const moduleCount = modules.length

  // Counts in prose: "131 labs", "131 runnable labs", "16 modules".
  const withCounts = (text) => text
    .replace(/\b\d+ (runnable )?labs\b/g, (_m, runnable) => `${labCount} ${runnable || ''}labs`)
    .replace(/\b\d+ modules\b/g, `${moduleCount} modules`)
    .replace(/^Lab count: \d+$/m, `Lab count: ${labCount}`)

  const map = modules.map((m) => [
    `### M${String(m.n).padStart(2, '0')} — ${m.en.title}`,
    `- Directory: \`course/English/${m.dir}/\` (and Spanish parity)`,
    `- Labs (${m.labs.length}): ${m.labs.map((l) => l.slug).join(', ')}`
  ].join('\n')).join('\n\n')

  const full = path.join(PUBLIC, 'llms-full.txt')
  let text = fs.readFileSync(full, 'utf8')
  const start = text.indexOf('\n### M00 ')
  const end = text.indexOf('\n## Source paths')
  if (start < 0 || end < 0) throw new Error('llms-full.txt: course map section not found')
  text = text.slice(0, start + 1) + map + '\n' + text.slice(end)
  fs.writeFileSync(full, withCounts(text))

  for (const file of ['llms.txt', path.join('mcp', 'tools.json')]) {
    const p = path.join(PUBLIC, file)
    fs.writeFileSync(p, withCounts(fs.readFileSync(p, 'utf8')))
  }
  return { labCount, moduleCount }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const r = buildLlms()
  console.log(`llms.txt, llms-full.txt, mcp/tools.json → ${r.labCount} labs in ${r.moduleCount} modules`)
}
