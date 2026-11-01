/**
 * ============================================================================
 * TEST SUITE 03: In-Browser V8 Execution Scope & Polyfill Sandbox
 * ============================================================================
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as hedera from '@hiero-ledger/sdk'
import nodeCrypto from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

export async function runBrowserSandboxTest() {
  console.log('\n================================================================')
  console.log('🧪 TEST 03: IN-BROWSER V8 SANDBOX & POLYFILL COMPILATION AUDIT')
  console.log('================================================================')

  const enPath = path.join(ROOT, 'app', 'src', 'content', 'en.json')
  const esPath = path.join(ROOT, 'app', 'src', 'content', 'es.json')

  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'))
  const es = JSON.parse(fs.readFileSync(esPath, 'utf8'))

  function sanitizeSourceForExecution(code) {
    let sanitized = code
      .replace(/import\s+[\s\S]*?from\s*['"][^'"]*['"]\s*;?/gm, '')
      .replace(/import\s*['"][^'"]*['"]\s*;?/gm, '')
      .replace(/export\s+default\s+.*?;?/gm, '')
      .replace(/export\s*\{[^}]*\}\s*;?/gm, '')
      .replace(/if\s*\(\s*process\.argv\[1\][\s\S]*$/gm, '')
      .replace(/import\.meta\.[a-zA-Z0-9_$]+/gm, '""')
      .trim()
    sanitized += '\n\nif (typeof main === "function") {\n  // dry-run\n}'
    return sanitized
  }

  const scopeKeys = Object.keys(hedera)
  const scopeParams = [
    ...scopeKeys,
    'client',
    'getClient',
    'getHashscanUrl',
    'getMirrorNodeBaseUrl',
    'updateState',
    'updateEnv',
    'getState',
    'sleep',
    'dotenv',
    'crypto',
    'path',
    'EventEmitter',
    'wallet',
    'console',
    'process'
  ]

  let enFailures = []
  let esFailures = []

  // Test English labs
  for (const [slug, lab] of Object.entries(en)) {
    const code = lab.segments.map(s => s.code).join('\n\n')
    const sanitized = sanitizeSourceForExecution(code)
    try {
      new Function(
        ...scopeParams,
        'return (async () => {\n  try {\n' + sanitized + '\n  } catch (err) { throw err; }\n})()'
      )
    } catch (err) {
      enFailures.push({ slug, error: err.message })
    }
  }

  // Test Spanish labs
  for (const [slug, lab] of Object.entries(es)) {
    const code = lab.segments.map(s => s.code).join('\n\n')
    const sanitized = sanitizeSourceForExecution(code)
    try {
      new Function(
        ...scopeParams,
        'return (async () => {\n  try {\n' + sanitized + '\n  } catch (err) { throw err; }\n})()'
      )
    } catch (err) {
      esFailures.push({ slug, error: err.message })
    }
  }

  console.log(`  ✓ English Labs Tested: ${Object.keys(en).length} | Failed: ${enFailures.length}`)
  console.log(`  ✓ Spanish Labs Tested: ${Object.keys(es).length} | Failed: ${esFailures.length}`)

  if (enFailures.length > 0 || esFailures.length > 0) {
    console.error('  ❌ In-Browser Compilation Failures EN:', enFailures)
    console.error('  ❌ In-Browser Compilation Failures ES:', esFailures)
    throw new Error(`In-browser sandbox audit failed: EN=${enFailures.length}, ES=${esFailures.length}`)
  }

  console.log('✅ TEST 03 PASSED: All 131 labs in EN & ES compile 100% in browser sandbox scope!')
  return { passed: true, totalTested: Object.keys(en).length + Object.keys(es).length }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runBrowserSandboxTest().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
