/**
 * TEST 09: Walkthrough coverage.
 * Builds the walkthrough exactly as the app does (app/src/lib/labTabs.ts, bundled with esbuild)
 * for every lab in EN and ES, and fails when real code is hidden or a line shows a wrong number.
 * Blank lines, comments (shown as prose) and the CLI self-launcher are allowed to be hidden.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(ROOT, 'app')

export async function runWalkthroughCoverageTest () {
  console.log('\n🧪 TEST 09: Walkthrough shows every code line with its real number')
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hbe-walk-')), 'labTabs.mjs')
  execFileSync(path.join(APP, 'node_modules/.bin/esbuild'), [path.join(APP, 'src/lib/labTabs.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`, '--log-level=error'])
  const { buildLabFileTabs } = await import(pathToFileURL(out).href)
  const index = JSON.parse(fs.readFileSync(`${APP}/src/content/index.json`, 'utf8'))
  const results = []
  const isCodeLine = (l) => l.trim() && !/^\s*(\/\/|\/\*|\*|\*\/)/.test(l)
  for (const lang of ['en', 'es']) {
    const content = JSON.parse(fs.readFileSync(`${APP}/src/content/${lang}.json`, 'utf8'))
    for (const mod of index.modules) for (const lab of mod.labs) {
      const body = content[lab.slug]; if (!body) { results.push({ slug: lab.slug, lang, error: 'no body' }); continue }
      const src = fs.readFileSync(`${APP}/public/source/${lang}/${lab.slug}.js`, 'utf8').replace(/\r\n?/g, '\n')
      const L = src.split('\n')
      const entry = { lab, module: mod }
      let tabs
      try { tabs = buildLabFileTabs({ code: src, entry, body, lang, auxiliaryTexts: {} }).tabs } catch (e) { results.push({ slug: lab.slug, lang, error: 'buildLabFileTabs threw: ' + e.message }); continue }
      const covered = new Set(); let misnumbered = 0; const misSamples = []
      const mapBlock = (text, start, countMis, nums) => {
        let ptr = Math.max(1, start)
        text.split('\n').forEach((line, i) => {
          const shown = nums ? nums[i] : start + i
          if (nums && nums[i] == null) { if (line.trim()) { misnumbered++; misSamples.push('unnumbered code line') } return }
          if (countMis && line.trim() && L[shown - 1] === line) { covered.add(shown); return }
          if (countMis && line.trim() && L[shown - 1] !== line) { misnumbered++; if (misSamples.length < 2) misSamples.push(`shows #${shown} for real line text "${line.trim().slice(0, 50)}"`) }
          if (!line.trim()) return
          let j = ptr; while (j <= L.length && L[j - 1].trim() !== line.trim()) j++
          if (j <= L.length) { covered.add(j); ptr = j + 1 } else { let k = 1; while (k <= L.length && L[k - 1].trim() !== line.trim()) k++; if (k <= L.length) covered.add(k) }
        })
      }
      for (const t of tabs) {
        if (t.secondary) continue
        const segs = (t.segments || []).filter((s) => s.code)
        if (segs.length) segs.forEach((s) => mapBlock(s.code, s.start ?? 1, true, s.lines))
        else if (t.id !== 'main' && t.code) mapBlock(t.code, 1, false)
      }
      // body start = first line after the header comment
      let b = 0; while (b < L.length && (/^\s*\/\*\s*eslint/.test(L[b]) || !L[b].trim())) b++
      if (/^\s*\/\*\*/.test(L[b] || '')) { while (b < L.length && !/\*\/\s*$/.test(L[b])) b++; b++ }
      let launch = L.findIndex((l) => /^if\s*\(\s*process\.argv\[1\]/.test(l)) + 1; if (!launch) launch = L.length + 1
      const missing = []
      let inBlock = false
      for (let n = b + 1; n <= L.length; n++) {
        const l = L[n - 1]
        if (inBlock) { if (/\*\/\s*$/.test(l)) inBlock = false; continue }
        if (/^\s*\/\*/.test(l) && !/\*\/\s*$/.test(l)) { inBlock = true; continue }
        if (n >= launch) continue
        if (isCodeLine(l) && !covered.has(n)) missing.push(n)
      }
      const ranges = []
      for (const n of missing) { const r = ranges[ranges.length - 1]; if (r && n <= r[1] + 3 && missing.includes(n)) r[1] = n; else ranges.push([n, n]) }
      const mainTab = tabs.find((t) => t.id === 'main')
      const sourceFull = mainTab.code === src
      const where = (r) => r[1] >= launch - 4 ? 'tail' : (r[0] <= b + 3 ? 'start' : 'gap')
      results.push({ slug: lab.slug, lang, lines: L.length, bodyStart: b + 1, missing: ranges.map((r) => ({ from: r[0], to: r[1], where: where(r), code: L.slice(r[0] - 1, Math.min(r[1], r[0] + 1)).map((x) => x.trim()).join(' ⏎ ').slice(0, 90) })), missingCount: missing.length, misnumbered, misSamples, sourceFull, modules: tabs.length - 1 })
    }
  }

  const bad = results.filter((r) => r.error || r.missingCount || r.misnumbered)
  for (const r of bad.slice(0, 20)) {
    console.log(`  ✗ ${r.slug} [${r.lang}] ${r.error || ''} hidden: ${(r.missing || []).map((m) => `${m.from}-${m.to}`).join(', ') || '-'} | misnumbered: ${r.misnumbered || 0} ${(r.misSamples || [])[0] || ''}`)
  }
  console.log(`  ✓ Labs checked: ${results.length}`)
  if (bad.length) throw new Error(`TEST 09 FAILED: ${bad.length} lab walkthroughs hide code or show wrong line numbers`)
  console.log('✅ TEST 09 PASSED: Every walkthrough shows all code with real line numbers.')
  return { passed: true, checked: results.length }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runWalkthroughCoverageTest().catch((err) => {
    console.error(err.message || err)
    process.exit(1)
  })
}
