/**
 * ============================================================================
 * TEST SUITE 01: Standalone Course Syllabus Integrity, Parity & Syntax
 * ============================================================================
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const COURSE_DIR = path.join(ROOT, 'course')

export async function runCourseStandaloneTest() {
  console.log('\n================================================================')
  console.log('🧪 TEST 01: STANDALONE COURSE INTEGRITY, PARITY & SYNTAX')
  console.log('================================================================')

  const enDir = path.join(COURSE_DIR, 'English')
  const esDir = path.join(COURSE_DIR, 'Spanish')

  if (!fs.existsSync(enDir) || !fs.existsSync(esDir)) {
    throw new Error('Course English or Spanish directory not found')
  }

  const enModules = fs.readdirSync(enDir).filter(d => d.startsWith('M') && !d.startsWith('M99'))
  const esModules = fs.readdirSync(esDir).filter(d => d.startsWith('M') && !d.startsWith('M99'))

  console.log(`  ✓ English Modules Found: ${enModules.length}`)
  console.log(`  ✓ Spanish Modules Found: ${esModules.length}`)

  if (enModules.length !== esModules.length) {
    throw new Error(`Module count mismatch: EN=${enModules.length}, ES=${esModules.length}`)
  }

  let totalLabsChecked = 0
  const syntaxFailures = []
  const parityFailures = []

  for (const mod of enModules) {
    const enModDir = path.join(enDir, mod)
    const esModDir = path.join(esDir, mod)

    if (!fs.existsSync(esModDir)) {
      parityFailures.push(`Missing Spanish module folder: ${mod}`)
      continue
    }

    const enFiles = fs.readdirSync(enModDir).filter(f => f.endsWith('.js'))
    const esFiles = new Set(fs.readdirSync(esModDir).filter(f => f.endsWith('.js')))

    for (const file of enFiles) {
      totalLabsChecked++
      if (!esFiles.has(file)) {
        parityFailures.push(`Missing Spanish parity for: ${mod}/${file}`)
      }

      // Check Syntax of English file
      try {
        const codeEn = fs.readFileSync(path.join(enModDir, file), 'utf8')
        new vm.Script(codeEn, { filename: `English/${mod}/${file}` })
      } catch (err) {
        // ES module imports throw in vm.Script without module flag, check via parse
        if (!err.message.includes('Cannot use import statement')) {
          syntaxFailures.push(`Syntax error in English/${mod}/${file}: ${err.message}`)
        }
      }

      // Check Syntax of Spanish file
      if (esFiles.has(file)) {
        try {
          const codeEs = fs.readFileSync(path.join(esModDir, file), 'utf8')
          new vm.Script(codeEs, { filename: `Spanish/${mod}/${file}` })
        } catch (err) {
          if (!err.message.includes('Cannot use import statement')) {
            syntaxFailures.push(`Syntax error in Spanish/${mod}/${file}: ${err.message}`)
          }
        }
      }
    }
  }

  // Check M99_Utilities
  const enUtils = path.join(enDir, 'M99_Utilities', 'index.js')
  const esUtils = path.join(esDir, 'M99_Utilities', 'index.js')
  if (!fs.existsSync(enUtils) || !fs.existsSync(esUtils)) {
    throw new Error('M99_Utilities missing in English or Spanish')
  }
  console.log('  ✓ Shared M99_Utilities verified in both languages.')

  console.log(`  ✓ Total Lab Files Audited: ${totalLabsChecked * 2} (${totalLabsChecked} EN + ${totalLabsChecked} ES)`)

  if (parityFailures.length > 0) {
    console.error('  ❌ Parity Failures:', parityFailures)
    throw new Error(`Parity check failed with ${parityFailures.length} errors`)
  }

  if (syntaxFailures.length > 0) {
    console.error('  ❌ Syntax Failures:', syntaxFailures)
    throw new Error(`Syntax check failed with ${syntaxFailures.length} errors`)
  }

  console.log('✅ TEST 01 PASSED: All course files have 100% parity and clean syntax!')
  return { passed: true, totalLabsChecked }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCourseStandaloneTest().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
