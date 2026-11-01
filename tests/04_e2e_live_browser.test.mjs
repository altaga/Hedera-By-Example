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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  })

  const page = await browser.newPage()
  page.on('dialog', async dialog => {
    try { await dialog.accept() } catch (_) {}
  })

  try {
    // 1. Load app
    console.log('  [STEP 1] Navigating to Hedera by Example...')
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 45000 })
    await page.waitForSelector('.hbe-app-root', { timeout: 15000 })

    // Check overflow
    const overflow = await page.evaluate(() => {
      return {
        bodyScrollWidth: document.body.scrollWidth,
        windowInnerWidth: window.innerWidth,
        hasHorizontalOverflow: document.body.scrollWidth > window.innerWidth
      }
    })
    console.log(`  ✓ Overflow Check: hasHorizontalOverflow = ${overflow.hasHorizontalOverflow}`)
    if (overflow.hasHorizontalOverflow) {
      throw new Error(`Horizontal overflow detected: body=${overflow.bodyScrollWidth}px, viewport=${overflow.windowInnerWidth}px`)
    }

    // 2. Open wallet modal
    console.log('  [STEP 2] Opening Browser Wallet Modal...')
    await page.waitForSelector('.hbe-wallet-btn', { timeout: 10000 })
    await page.click('.hbe-wallet-btn')
    await page.waitForSelector('.hbe-wallet-modal', { timeout: 10000 })
    console.log('  ✓ In-browser wallet modal opened.')

    // 3. Generate wallet
    console.log('  [STEP 3] Generating Ed25519 Keys in Browser...')
    const generateBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      return btns.find(b => b.textContent && b.textContent.includes('Ed25519'))
    })
    if (generateBtn) {
      await generateBtn.click()
      await delay(1200)
    }

    // 4. Request from faucet
    console.log('  [STEP 4] Submitting 1-Click Faucet Request to Hedera Testnet...')
    const faucetBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      return btns.find(b => b.textContent && (b.textContent.includes('Fund My Wallet') || b.textContent.includes('Instant Testnet Faucet')))
    })
    if (faucetBtn) {
      await faucetBtn.click()
    }

    await page.waitForFunction(
      () => {
        const text = document.body.innerText
        return text.includes('funded with 5.0 ℏ') || text.includes('fondeada con 5.0 ℏ') || text.includes('Faucet Error')
      },
      { timeout: 35000 }
    )

    const modalText = await page.evaluate(() => document.querySelector('.hbe-wallet-modal')?.innerText || '')
    const faucetError = modalText.match(/Faucet Error:?\s*([^\n]*)/)
    let faucetFailure = null
    let assignedAccountId = null
    if (faucetError) {
      faucetFailure = faucetError[1].trim() || 'unknown faucet error'
      console.log(`  ✗ Faucet Failed: ${faucetFailure}`)
    } else {
      const accountMatch = modalText.match(/(0\.0\.\d{5,8})/)
      assignedAccountId = accountMatch ? accountMatch[1] : null
      if (!assignedAccountId) {
        faucetFailure = 'faucet reported success but no Account ID (0.0.X) was shown'
        console.log(`  ✗ Faucet Failed: ${faucetFailure}`)
      } else {
        console.log(`  🎉 Faucet Success! Assigned On-Chain Account: ${assignedAccountId}`)
      }
    }

    // 5. Close modal
    await page.click('.hbe-modal-close-btn')
    await delay(800)

    // 6. Execute lab in browser
    console.log('  [STEP 5] Executing Lab m00-01-generate-wallet in Browser V8...')
    await page.waitForSelector('.hbe-studio-run-btn', { timeout: 10000 })
    await page.click('.hbe-studio-run-btn')

    await page.waitForFunction(
      () => {
        const stream = document.querySelector('.hbe-studio-terminal-stream')
        if (!stream) return false
        const text = stream.innerText
        return text.includes('Consensus verified') || text.includes('SESSION COMPLETE')
      },
      { timeout: 30000 }
    )

    const logs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.hbe-terminal-line')).map(l => l.innerText.replace(/\n+/g, ' '))
    })

    console.log(`  ✓ Terminal received ${logs.length} consensus lines. Last line: "${logs[logs.length - 1]}"`)
    if (faucetFailure) {
      throw new Error(`Faucet step failed: ${faucetFailure}`)
    }
    console.log('✅ TEST 04 PASSED: Live E2E Browser execution verified end-to-end!')
    return { passed: true, assignedAccountId }

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
