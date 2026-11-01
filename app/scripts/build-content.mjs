#!/usr/bin/env node
/**
 * Builds the static content for Hedera by Example from the Hedera for Dummies
 * curriculum. Every example on the site is a real, runnable lab: the header
 * block becomes the introduction, full-line `//` and `/* ... * /` comments
 * become commentary, and the remaining source becomes the code column (with
 * real file line numbers).
 *
 * Usage: node scripts/build-content.mjs [path-to-hedera-for-dummies]
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SOURCE = path.resolve(process.argv[2] || path.join(ROOT, '..', 'Hedera for Dummies'))
const OUT = path.join(ROOT, 'src', 'content')
const LANGS = { en: 'English', es: 'Spanish' }

const SECTION_ALIASES = {
  CONCEPT: 'kicker',
  'KEY CONCEPT': 'concept',
  'CONCEPTO CLAVE': 'concept',
  'LEARNABLE MOMENT': 'moment',
  'TEACHABLE MOMENT': 'moment',
  'MOMENTO DE APRENDIZAJE': 'moment',
  'OFFICIAL REFERENCES': 'refs',
  'REFERENCIAS OFICIALES': 'refs',
  'HOW TO RUN': 'run',
  'COMO EJECUTAR': 'run'
}

const normalizeKey = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim()

const toParagraphs = (lines) => {
  const paras = []
  let buf = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line === '*') {
      if (buf.length) paras.push(buf.join(' '))
      buf = []
    } else {
      buf.push(line)
    }
  }
  if (buf.length) paras.push(buf.join(' '))
  return paras
}

function parseHeader (lines) {
  const out = { title: '', kicker: '', concept: [], moment: '', refs: [], run: '' }
  const sections = {}
  let current = null
  for (const raw of lines) {
    const line = raw.replace(/^\s*\/?\*+\/?\s?/, '').replace(/\s*\*\/\s*$/, '').trimEnd()
    if (/^=+$/.test(line.trim())) continue
    const title = line.match(/^\s*Lab\s+\d+\w*\s*[:\-–]\s*(.+)$/i)
    if (title && !out.title) {
      out.title = title[1].trim()
      current = null
      continue
    }
    const section = line.match(/^\s*\[\s*([^\]]+?)\s*\]\s*(.*)$/)
    if (section) {
      current = SECTION_ALIASES[normalizeKey(section[1])] || '_ignored'
      sections[current] = sections[current] || []
      if (section[2]) sections[current].push(section[2])
      continue
    }
    if (current) sections[current].push(line)
  }
  out.kicker = toParagraphs(sections.kicker || []).join(' ')
  out.concept = toParagraphs(sections.concept || [])
  out.moment = toParagraphs(sections.moment || []).join(' ')
  out.refs = (sections.refs || []).map((l) => l.trim().replace(/^-\s*/, '')).filter((l) => /^https?:\/\//.test(l))
  out.run = (sections.run || []).map((l) => l.trim()).filter(Boolean)[0] || ''
  return out
}

function parseSegments (lines, offset) {
  const segments = []
  let cur = { doc: [], code: [], start: 0 }
  const isSingleComment = (l) => /^\s*\/\/(?!\s*(eslint|@ts-|#region|#endregion))/.test(l)
  const flushIfCode = () => {
    if (cur.code.some((c) => c.trim())) {
      segments.push(cur)
      cur = { doc: [], code: [], start: 0 }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isSingleComment(line)) {
      flushIfCode()
      cur.doc.push(line.replace(/^\s*\/\/\s?/, ''))
    } else if (/^\s*\/\*(?!\s*eslint)/.test(line)) {
      flushIfCode()
      while (i < lines.length) {
        const cleaned = lines[i]
          .replace(/^\s*\/\*+\s?/, '')
          .replace(/\s*\*+\/\s*$/, '')
          .replace(/^\s*\*\s?/, '')
        if (!/^[-=]{3,}$/.test(cleaned.trim())) cur.doc.push(cleaned)
        if (/\*\/\s*$/.test(lines[i])) break
        i++
      }
    } else {
      if (!cur.code.length) cur.start = offset + i + 1
      cur.code.push(line)
    }
  }
  segments.push(cur)

  return segments
    .map((s) => {
      let start = s.start
      const code = [...s.code]
      while (code.length && !code[0].trim()) { code.shift(); start++ }
      while (code.length && !code[code.length - 1].trim()) code.pop()
      return { doc: toParagraphs(s.doc), code: code.join('\n'), start }
    })
    .filter((s) => s.code || s.doc.length)
}

function extractSdkSymbols (code) {
  const symbols = new Set()
  const re = /import\s*\{([^}]+)\}\s*from\s*['"]@hiero-ledger\/sdk['"]/g
  let m
  while ((m = re.exec(code)) !== null) {
    m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean).forEach((s) => symbols.add(s))
  }
  return [...symbols]
}

function parseLab (file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length && (/^\s*\/\*\s*eslint/.test(lines[i]) || !lines[i].trim())) i++
  let header = { title: '', kicker: '', concept: [], moment: '', refs: [], run: '' }
  if (/^\s*\/\*\*/.test(lines[i] || '')) {
    const start = i
    while (i < lines.length && !/\*\/\s*$/.test(lines[i])) i++
    header = parseHeader(lines.slice(start, i + 1))
    i++
  }
  const bodyLines = lines.slice(i)
  const segments = parseSegments(bodyLines, i)
  const sdk = extractSdkSymbols(bodyLines.join('\n'))
  return { ...header, segments, sdk, lines: lines.length }
}

function parseReadme (dir) {
  const file = path.join(dir, 'README.md')
  if (!fs.existsSync(file)) return { title: '', subtitle: '', objective: '' }
  const md = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
  const strip = (s) => s.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  const h1 = (md.match(/^#\s+(.+)$/m) || [])[1] || ''
  const h2 = (md.match(/^##\s+(.+)$/m) || [])[1] || ''
  const objective = (md.match(/\*\*(?:OBJECTIVE|OBJETIVO):\*\*\s*(.+)$/mi) || [])[1] || ''
  return {
    title: strip(h1).replace(/^(Module|M[oó]dulo)\s+\d+\s*[:\-–]\s*/i, '').trim(),
    subtitle: strip(h2),
    objective: objective.trim()
  }
}

const titleFromFile = (f) => f.replace(/^\d+\w*?_/, '').replace(/\.js$/, '').split('_')
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

function build () {
  if (!fs.existsSync(path.join(SOURCE, LANGS.en))) {
    throw new Error(`Curriculum not found at ${SOURCE}`)
  }
  fs.mkdirSync(OUT, { recursive: true })

  const moduleDirs = fs.readdirSync(path.join(SOURCE, LANGS.en), { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^M\d+_/.test(d.name) && !d.name.startsWith('M99'))
    .map((d) => d.name)
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))

  const index = { modules: [] }
  const bodies = { en: {}, es: {} }
  const warnings = []

  for (const dir of moduleDirs) {
    const n = parseInt(dir.slice(1))
    const id = `m${String(n).padStart(2, '0')}`
    const meta = {}
    for (const [lang, folder] of Object.entries(LANGS)) meta[lang] = parseReadme(path.join(SOURCE, folder, dir))

    const files = fs.readdirSync(path.join(SOURCE, LANGS.en, dir))
      .filter((f) => /^\d+.*\.js$/.test(f))
      .sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b))

    const labs = []
    for (const file of files) {
      const num = file.match(/^(\d+)/)[1].padStart(2, '0')
      const slug = `${id}-${num}-${file.replace(/^\d+\w*?_/, '').replace(/\.js$/, '').replace(/_/g, '-').toLowerCase()}`
      const entry = { slug, n: num, file, sdk: [], en: {}, es: {} }

      for (const [lang, folder] of Object.entries(LANGS)) {
        let abs = path.join(SOURCE, folder, dir, file)
        if (!fs.existsSync(abs)) {
          warnings.push(`missing ${folder}/${dir}/${file}, falling back to English`)
          abs = path.join(SOURCE, LANGS.en, dir, file)
        }
        const lab = parseLab(abs)
        const title = lab.title || titleFromFile(file)
        if (lang === 'en') entry.sdk = lab.sdk
        entry[lang] = { title, kicker: lab.kicker }
        bodies[lang][slug] = {
          title,
          kicker: lab.kicker,
          concept: lab.concept,
          moment: lab.moment,
          refs: lab.refs,
          sdk: lab.sdk,
          segments: lab.segments,
          lines: lab.lines
        }
      }
      labs.push(entry)
    }

    index.modules.push({ id, n, dir, en: meta.en, es: meta.es, labs })
  }

  const pkg = path.join(SOURCE, 'package.json')
  if (fs.existsSync(pkg)) {
    const deps = JSON.parse(fs.readFileSync(pkg, 'utf8')).dependencies || {}
    index.sdk = (deps['@hiero-ledger/sdk'] || '').replace(/^\^/, '')
  }
  index.labCount = index.modules.reduce((s, m) => s + m.labs.length, 0)

  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index))
  for (const lang of Object.keys(LANGS)) {
    fs.writeFileSync(path.join(OUT, `${lang}.json`), JSON.stringify(bodies[lang]))
  }

  warnings.forEach((w) => console.warn(`warn: ${w}`))
  console.log(`Built ${index.modules.length} modules, ${index.labCount} labs → src/content`)
}

build()
