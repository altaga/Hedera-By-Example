/**
 * ============================================================================
 * TEST SUITE 04: Live Production E2E Headless Chrome Browser Automation
 * ============================================================================
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

const require = createRequire(import.meta.url)

function loadPuppeteer() {
  try {
    return require('puppeteer-core')
  } catch (_) {
    try {
      return require(path.join(ROOT, 'app', 'node_modules', 'puppeteer-core'))
    } catch (__) {
      throw new Error('puppeteer-core is not installed. Run `npm install` at the repository root.')
    }
  }
}

// Resolve a Chrome/Chromium binary: CHROME_PATH wins, then common install locations per OS.
function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/opt/pw-browsers/chromium'
    ]
  }[process.platform] || []
  const found = candidates.find((p) => fs.existsSync(p))
  if (!found) {
    throw new Error(`No Chrome/Chromium binary found for ${process.platform}. Set CHROME_PATH to your browser executable.`)
  }
  return found
}

const TARGET_URL = process.env.HBE_URL || 'https://hbe.expo.app'

export async function runE2ELiveBrowserTest() {
  console.log('\n================================================================')
  console.log('🧪 TEST 04: LIVE E2E HEADLESS BROWSER AUDIT')
  console.log(`🌐 Target: ${TARGET_URL}`)
  console.log('================================================================')

  const puppeteer = loadPuppeteer()
  const chromePath = resolveChromePath()
  console.log(`🧭 Browser: ${chromePath}`)
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    defaultViewport: { width: 1440, height: 900 },
    // E2E_CHROME_ARGS adds flags for restricted networks, e.g. "--proxy-server=http://host:port --ignore-certificate-errors".
    args: ['--no-sandbox', '--disable-setuid-sandbox', ...(process.env.E2E_CHROME_ARGS || '').split(' ').filter(Boolean)]
  })

  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))
  // The account dialog asks before replacing an existing key.
  page.on('dialog', async (dialog) => {
    try { await dialog.accept() } catch (_) {}
  })

  const LAB = 'm00-01-generate-wallet'

  try {
    // 1. Load a lab page
    console.log(`  [STEP 1] Opening lab ${LAB}...`)
    await page.goto(`${TARGET_URL.replace(/\/$/, '')}/#${LAB}`, { waitUntil: 'networkidle2', timeout: 45000 })
    await page.waitForSelector('[data-testid=run-button]', { timeout: 15000 })

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    console.log(`  ✓ Horizontal overflow: ${overflow}`)
    if (overflow) throw new Error('Horizontal overflow detected on the lab page')

    // 2. Source tab serves the exact lab file
    console.log('  [STEP 2] Checking the Source tab...')
    await page.click('#tab-source')
    await page.waitForFunction(
      () => document.querySelector('#panel-source .code-line') || document.querySelector('#panel-source .source-status'),
      { timeout: 15000 }
    )
    const sourceLines = await page.$$eval('#panel-source .code-line', (els) => els.length)
    if (sourceLines < 10) throw new Error('Source tab did not load the lab file')
    console.log(`  ✓ Source tab shows ${sourceLines} lines.`)
    await page.click('#tab-walkthrough')

    // 3. Generate a key in the account dialog
    console.log('  [STEP 3] Generating an ECDSA key in the browser...')
    await page.click('[data-testid=account-button]')
    await page.waitForSelector('[data-testid=account-dialog]', { timeout: 10000 })
    await page.waitForSelector('[data-testid=create-wallet]', { timeout: 10000 })
    await page.click('[data-testid=create-wallet]')
    await page.waitForFunction(
      () => /0x[0-9a-f]{40}/i.test(document.querySelector('[data-testid=account-dialog]')?.textContent || ''),
      { timeout: 15000 }
    )
    console.log('  ✓ ECDSA key and EVM address generated.')
    await page.click('[data-testid=account-close]')

    // 4. Run the lab in the browser
    console.log(`  [STEP 4] Running ${LAB} in the browser...`)
    await page.click('[data-testid=run-button]')
    await page.waitForSelector('[data-testid=run-output][data-status=success], [data-testid=run-output][data-status=error]', { timeout: 30000 })
    const status = await page.$eval('[data-testid=run-output]', (el) => el.getAttribute('data-status'))
    const logs = await page.$$eval('[data-testid=output-line]', (els) => els.map((l) => l.textContent.replace(/\s+/g, ' ').trim()))
    if (status !== 'success') {
      throw new Error(`Lab run failed: ${logs.slice(-3).join(' | ')}`)
    }
    if (!logs.some((l) => l.includes('SESSION COMPLETE'))) {
      throw new Error('Lab output did not reach SESSION COMPLETE')
    }
    console.log(`  ✓ Output has ${logs.length} lines. Last line: "${logs[logs.length - 1]}"`)

    // 5. Teaching features render on the pages that need them (no network spend)
    const base = TARGET_URL.replace(/\/$/, '')
    const expectOn = async (slug, selector, what) => {
      await page.goto(`${base}/#${slug}`, { waitUntil: 'networkidle2', timeout: 45000 })
      await page.waitForSelector(selector, { timeout: 15000 }).catch(() => { throw new Error(`${what} missing on ${slug}`) })
      console.log(`  ✓ ${what} on ${slug}`)
    }
    console.log('  [STEP 5] Checking teaching features...')
    await expectOn('m10-03-facilitator-settlement', '[data-testid=sequence-diagram]', 'Sequence diagram')
    await expectOn('m15-04-passkeys-webauthn-p256-authenticator', '[data-testid=simulated-note]', 'Simulated note')
    await expectOn('m15-04-passkeys-webauthn-p256-authenticator', '[data-testid=passkey-demo]', 'Passkey demo')
    await expectOn('m06-04-economic-hcs1', '[data-testid=lab-files]', 'Lab files')
    // Labs built on standards-sdk used to be Node-only; they run in the browser now.
    await page.goto(`${base}/#m09-06-hcs10-u2a-public`, { waitUntil: 'networkidle2', timeout: 45000 })
    await page.waitForSelector('[data-testid=run-button]', { timeout: 15000 })
    if (await page.$('[data-testid=node-only-notice]')) throw new Error('m09-06-hcs10-u2a-public still shows the Node-only notice')
    console.log('  ✓ No Node-only notice on m09-06-hcs10-u2a-public (runs in the browser)')
    await page.goto(`${base}/#resources`, { waitUntil: 'networkidle2', timeout: 45000 })
    await page.waitForSelector('[data-testid=resources-panel]', { timeout: 15000 }).catch(() => { throw new Error('Resources panel missing') })
    console.log('  ✓ Resources panel renders')

    // 6. A visual renders from a local-only lab (no transactions)
    console.log('  [STEP 6] Running m01-01-consensus-and-abft (hashgraph DAG)...')
    await page.goto(`${base}/#m01-01-consensus-and-abft`, { waitUntil: 'networkidle2', timeout: 45000 })
    await page.waitForSelector('[data-testid=run-button]', { timeout: 15000 })
    await page.click('[data-testid=run-button]')
    await page.waitForSelector('[data-testid=run-output][data-status=success] [data-testid=visual]', { timeout: 30000 })
    console.log('  ✓ Hashgraph DAG visual rendered')

    if (pageErrors.length) throw new Error(`Uncaught page errors: ${pageErrors.join(' | ')}`)
    console.log('✅ TEST 04 PASSED: Live E2E Browser execution verified end-to-end!')
    return { passed: true }
  } finally {
    await browser.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runE2ELiveBrowserTest().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
