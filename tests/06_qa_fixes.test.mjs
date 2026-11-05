/**
 * QA fixes: home tab title, Run-anyway gate, and the key-type card hit target.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { canRunLab, documentTitle } from '../app/src/lib/uiState.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APP = path.join(ROOT, 'app')

function assert (cond, message) {
  if (!cond) throw new Error(message)
}

function chromePath () {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/local/bin/google-chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean)
  return candidates.find((p) => fs.existsSync(p)) || null
}

export async function runQaFixesTest () {
  console.log('\n================================================================')
  console.log('🧪 TEST 06: QA FIXES (TITLE, RUN ANYWAY, CURVE CARD)')
  console.log('================================================================')

  for (const lang of ['en', 'es']) {
    assert(documentTitle('index', null, lang) === 'HBE by Effisend', `home title drifted for ${lang}`)
  }
  assert(documentTitle('lab', 'Immutable Issuance', 'en') === 'Immutable Issuance · Hedera by Example', 'lab title')
  assert(documentTitle('lab', 'Emisión inmutable', 'es') === 'Emisión inmutable · Hedera by Example', 'lab title es')
  assert(documentTitle('resources', null, 'es') === 'Recursos · Hedera by Example', 'resources title')
  console.log('  ✓ Home title is exactly "HBE by Effisend" in EN and ES; labs keep their title')

  assert(canRunLab({ running: false, blockReason: 'account', allowLowBalance: true }) === false, 'no-account must stay blocked')
  assert(canRunLab({ running: false, blockReason: 'balance', allowLowBalance: false }) === false, 'low balance starts blocked')
  assert(canRunLab({ running: false, blockReason: 'balance', allowLowBalance: true }) === true, 'Run anyway enables Run')
  assert(canRunLab({ running: true, blockReason: 'balance', allowLowBalance: true }) === false, 'running stays disabled')
  assert(canRunLab({ running: false, blockReason: null, allowLowBalance: false }) === true, 'no block can run')
  console.log('  ✓ Run anyway enables a low-balance lab and never a wallet with no account')

  const chrome = chromePath()
  if (!chrome) {
    console.log('  ✓ Curve-card click test skipped (no Chrome)')
    return { passed: true, curveClicks: 'skipped' }
  }

  const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbe-curve-'))
  const harness = path.join(APP, '.qa-curve-harness.jsx')
  fs.writeFileSync(harness, `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CurvePicker } from './src/components/CurvePicker.tsx'

const curves = {
  ECDSA: {
    name: 'ECDSA (secp256k1)',
    badge: 'Recommended',
    pros: ['Has an EVM address'],
    cons: ['Signatures are a bit larger and slower to verify than Ed25519']
  },
  ED25519: {
    name: 'Ed25519',
    badge: 'Hedera native',
    pros: ['Fast signatures'],
    cons: ['No EVM address']
  }
}

function App () {
  const [value, setValue] = useState('ECDSA')
  return (
    <div>
      <CurvePicker curves={curves} value={value} onChange={setValue} label='Key type' />
      <output id='sel'>{value}</output>
    </div>
  )
}
createRoot(document.getElementById('root')).render(<App />)
`)
  const bundle = path.join(harnessDir, 'bundle.js')
  const built = spawnSync(path.join(APP, 'node_modules', '.bin', 'esbuild'), [
    harness, '--bundle', '--format=iife', `--outfile=${bundle}`, '--jsx=automatic'
  ], { cwd: APP, encoding: 'utf8' })
  if (built.status !== 0) {
    fs.rmSync(harness, { force: true })
    throw new Error(`esbuild failed: ${built.stderr || built.stdout}`)
  }

  const html = path.join(harnessDir, 'index.html')
  fs.writeFileSync(html, `<!doctype html>
<link rel="stylesheet" href="file://${path.join(APP, 'src/global.css')}">
<body><div id="root"></div><script src="file://${bundle}"></script>
`)

  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1100, height: 800 })
    await page.goto('file://' + html)
    await page.waitForSelector('[data-testid=curve-ed25519]')
    const click = async (selector) => {
      const box = await page.$eval(selector, (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x + Math.min(8, r.width / 2), y: r.y + r.height / 2 }
      })
      await page.mouse.click(box.x, box.y)
      return page.$eval('#sel', (el) => el.textContent)
    }
    assert(await click('[data-testid=curve-ed25519] strong') === 'ED25519', 'clicking "Ed25519" selected the wrong curve')
    assert(await click('[data-testid=curve-ecdsa] strong') === 'ECDSA', 'clicking the ECDSA title selected the wrong curve')
    assert(await click('[data-testid=curve-ed25519] .tag') === 'ED25519', 'clicking "Hedera native" selected the wrong curve')
    assert(await click('[data-testid=curve-ed25519] li') === 'ED25519', 'clicking Ed25519 body text selected the wrong curve')
    const name = await page.$eval('[data-testid=curve-ed25519]', (el) => el.getAttribute('aria-label'))
    const role = await page.$eval('[data-testid=curve-ed25519]', (el) => el.getAttribute('role'))
    assert(role === 'radio', 'curve card is not a radio')
    assert(name && name.includes('Ed25519') && name.includes('Hedera native'), 'curve card accessible name')
    console.log('  ✓ Clicking the Ed25519 title, badge, or body selects Ed25519')
  } finally {
    await browser.close()
    fs.rmSync(harness, { force: true })
    fs.rmSync(harnessDir, { recursive: true, force: true })
  }

  return { passed: true }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runQaFixesTest().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
