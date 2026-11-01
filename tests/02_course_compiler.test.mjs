/**
 * ============================================================================
 * TEST SUITE 02: Course-to-App Compiler Verification
 * ============================================================================
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileCourse } from '../scripts/compile-course.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

export async function runCourseCompilerTest() {
  console.log('\n================================================================')
  console.log('🧪 TEST 02: COURSE-TO-APP COMPILER VERIFICATION')
  console.log('================================================================')

  // Run compiler
  const { modulesCount, labsCount } = compileCourse()

  if (modulesCount < 16) {
    throw new Error(`Expected at least 16 modules, got ${modulesCount}`)
  }
  if (labsCount !== 131) {
    throw new Error(`Expected exactly 131 labs, got ${labsCount}`)
  }

  const contentDir = path.join(ROOT, 'app', 'src', 'content')
  const indexFile = path.join(contentDir, 'index.json')
  const enFile = path.join(contentDir, 'en.json')
  const esFile = path.join(contentDir, 'es.json')

  if (!fs.existsSync(indexFile) || !fs.existsSync(enFile) || !fs.existsSync(esFile)) {
    throw new Error('Generated content files missing in app/src/content')
  }

  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
  const en = JSON.parse(fs.readFileSync(enFile, 'utf8'))
  const es = JSON.parse(fs.readFileSync(esFile, 'utf8'))

  const enKeys = Object.keys(en)
  const esKeys = Object.keys(es)

  console.log(`  ✓ index.json: ${index.modules.length} modules, ${index.labCount} total labs`)
  console.log(`  ✓ en.json:    ${enKeys.length} labs`)
  console.log(`  ✓ es.json:    ${esKeys.length} labs`)

  if (enKeys.length !== 131 || esKeys.length !== 131) {
    throw new Error(`Expected 131 labs in en.json and es.json, got EN=${enKeys.length}, ES=${esKeys.length}`)
  }

  // Validate structural integrity of labs
  for (const slug of enKeys) {
    const item = en[slug]
    if (!item.title || !item.segments || !Array.isArray(item.segments) || item.segments.length === 0) {
      throw new Error(`Malformed lab data in en.json for slug: ${slug}`)
    }
  }

  console.log('✅ TEST 02 PASSED: Course compiler parsed all 131 labs with zero errors!')
  return { passed: true, modulesCount, labsCount }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCourseCompilerTest().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
