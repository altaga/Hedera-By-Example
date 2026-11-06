#!/usr/bin/env node
/**
 * ============================================================================
 * Hedera by Example (HBE) — Master CI/CD & Production Test Runner
 * [ PURPOSE ] Executes all 4 layers of testing across course, compiler,
 *             in-browser sandbox, and live headless browser automation.
 * ============================================================================
 */
import { runCourseStandaloneTest } from './01_course_standalone.test.mjs'
import { runCourseCompilerTest } from './02_course_compiler.test.mjs'
import { runBrowserSandboxTest } from './03_browser_sandbox.test.mjs'
import { runE2ELiveBrowserTest } from './04_e2e_live_browser.test.mjs'
import { runMcpServerTest } from './05_mcp_server.test.mjs'
import { runQaFixesTest } from './06_qa_fixes.test.mjs'
import { runRunOnceTest } from './07_run_once_browser.test.mjs'
import { runWalkthroughCoverageTest } from './09_walkthrough_coverage.test.mjs'
import { runHashNavigationTest } from './10_hash_navigation.test.mjs'

const args = process.argv.slice(2)
const skipE2E = args.includes('--skip-e2e') || process.env.CI === 'true'

async function main() {
  console.log('================================================================')
  console.log('🏆 HEDERA BY EXAMPLE: MASTER QUALITY GATEWAY TEST HARNESS')
  console.log('================================================================')

  const results = []
  const startTime = Date.now()

  try {
    // Stage 1
    const t1 = await runCourseStandaloneTest()
    results.push({ name: 'Suite 01: Standalone Course Integrity & Syntax', status: 'PASS' })
  } catch (err) {
    results.push({ name: 'Suite 01: Standalone Course Integrity & Syntax', status: 'FAIL', error: err.message })
  }

  try {
    // Stage 2
    const t2 = await runCourseCompilerTest()
    results.push({ name: 'Suite 02: Course-to-App Compiler (131 Labs)', status: 'PASS' })
  } catch (err) {
    results.push({ name: 'Suite 02: Course-to-App Compiler (131 Labs)', status: 'FAIL', error: err.message })
  }

  try {
    // Stage 3
    const t3 = await runBrowserSandboxTest()
    results.push({ name: 'Suite 03: In-Browser V8 Polyfill Sandbox', status: 'PASS' })
  } catch (err) {
    results.push({ name: 'Suite 03: In-Browser V8 Polyfill Sandbox', status: 'FAIL', error: err.message })
  }

  if (!skipE2E) {
    try {
      // Stage 4
      const t4 = await runE2ELiveBrowserTest()
      results.push({ name: 'Suite 04: Live Headless Chrome E2E Test', status: 'PASS' })
    } catch (err) {
      results.push({ name: 'Suite 04: Live Headless Chrome E2E Test', status: 'FAIL', error: err.message })
    }
  } else {
    results.push({ name: 'Suite 04: Live Headless Chrome E2E Test', status: 'SKIPPED' })
  }

  try {
    // Stage 5
    const t5 = await runMcpServerTest()
    results.push({ name: 'Suite 05: Universal MCP Server (stdio & HTTP)', status: 'PASS' })
  } catch (err) {
    results.push({ name: 'Suite 05: Universal MCP Server (stdio & HTTP)', status: 'FAIL', error: err.message })
  }

  try {
    await runQaFixesTest()
    await runWalkthroughCoverageTest()
    await runHashNavigationTest() // skips unless HBE_BASE_URL is set
    results.push({ name: 'Suite 06: QA fixes (title, Run anyway, curve card)', status: 'PASS' })
  } catch (err) {
    results.push({ name: 'Suite 06: QA fixes (title, Run anyway, curve card)', status: 'FAIL', error: err.message })
  }

  try {
    const r7 = await runRunOnceTest()
    results.push({ name: 'Suite 07: One Run = one transaction (browser)', status: r7.skipped ? 'SKIPPED' : 'PASS' })
  } catch (err) {
    results.push({ name: 'Suite 07: One Run = one transaction (browser)', status: 'FAIL', error: err.message })
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log('\n================================================================')
  console.log('🏁 MASTER TEST EXECUTION SUMMARY')
  console.log('================================================================')
  console.table(results)
  console.log(`⏱️ Total Time: ${duration}s\n`)

  const hasFailures = results.some(r => r.status === 'FAIL')
  if (hasFailures) {
    console.error('❌ MASTER QUALITY SUITE FAILED')
    process.exit(1)
  } else {
    console.log('✨ ALL QUALITY GATES PASSED WITH COMPLETE SUCCESS!')
    process.exit(0)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
