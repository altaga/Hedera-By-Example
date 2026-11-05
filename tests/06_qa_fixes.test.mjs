/**
 * QA fixes: home tab title, Run-anyway gate, and the key-type card hit target.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { canRunLab, documentTitle, SITE_TITLE } from '../app/src/lib/uiState.mjs'
import { labFor, normalizeTxId } from '../app/src/lib/labAttribution.mjs'
import { shouldRetryExecution, MAX_NODE_ATTEMPTS } from '../app/src/lib/retryPolicy.mjs'
import { resolve as labResolve, join as labJoin } from '../app/src/lib/posixPath.mjs'

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
    for (const view of ['index', 'lab', 'resources', 'missing']) {
      assert(documentTitle(view, 'Immutable Issuance', lang) === 'HBE by Effisend', `title drifted for ${view}/${lang}`)
    }
  }
  assert(SITE_TITLE === 'HBE by Effisend', 'SITE_TITLE')
  for (const f of ['src/app/_layout.tsx', 'src/app/+not-found.tsx', 'src/app/index.tsx']) {
    const src = fs.readFileSync(path.join(APP, f), 'utf8')
    assert(!/·\s*Hedera by Example/.test(src), `${f} still sets a per-page title`)
    assert(!/document\.title\s*=/.test(src), `${f} sets document.title`)
  }
  console.log('  ✓ Tab title is exactly "HBE by Effisend" on every view in EN and ES')

  // Resources: each entity is named after the lab whose run submitted the creating transaction.
  const runs = [
    { slug: 'm05-01', start: 1000, end: 1200, accountId: '0.0.1', txIds: ['0.0.1@1005.000000007'] },
    { slug: 'm09-01', start: 1004, end: 1100, accountId: '0.0.1', txIds: ['0.0.1@1050.000000001'] }
  ]
  assert(labFor(runs, '1006.000000001', '0.0.1-1005-7') === 'm05-01', 'M05 topic must be labelled M05 even inside M09 window')
  assert(labFor(runs, '1051.000000001', '0.0.1-1050-000000001') === 'm09-01', 'M09 topic labelled M09')
  assert(normalizeTxId('0.0.1@1005.000000007') === normalizeTxId('0.0.1-1005-7'), 'tx id forms compare equal')
  assert(labFor([{ slug: 'a', start: 10, end: 20, accountId: '0.0.1' }, { slug: 'b', start: 21, end: 30, accountId: '0.0.1' }], '19.5') === 'a', 'legacy runs: containing window wins over grace margin')
  console.log('  ✓ Resources are labelled by the run that submitted the creating transaction')

  // Retries never resend a transaction that may already have reached consensus.
  const tx = (message, attempt = 1) => shouldRetryExecution({ isTransaction: true, message, attempt })
  assert(tx('NodeAccountId not recognized: 0.0.6') === true, 'unknown node is pre-submission')
  assert(tx('transaction failed precheck with status BUSY') === true, 'BUSY is pre-consensus')
  assert(tx('max attempts of 10 was reached for request with last error being: GrpcServiceError: UNAVAILABLE') === false, 'max attempts may hide a submission')
  assert(tx('gRPC timed out') === false && tx('Failed to fetch') === false, 'timeouts / dropped connections are not retried for transactions')
  assert(tx('INSUFFICIENT_PAYER_BALANCE') === false, 'real failures are not retried')
  assert(tx('BUSY', MAX_NODE_ATTEMPTS) === false, 'attempt cap')
  assert(shouldRetryExecution({ isTransaction: true, message: 'BUSY', attempt: 1, stopped: true }) === false, 'stopped runs never retry')
  assert(shouldRetryExecution({ isTransaction: false, message: 'Failed to fetch', attempt: 1 }) === true, 'queries retry transport errors')
  console.log('  ✓ Retry policy: only pre-consensus errors, same transaction, max 3 attempts')

  assert(labResolve('/lab', './assets/test_image.png') === '/lab/assets/test_image.png', 'resolve normalizes ./')
  assert(labResolve('assets/x.png') === '/lab/assets/x.png', 'resolve uses /lab as cwd')
  assert(labResolve('/lab/sub', '../a.txt') === '/lab/a.txt' && labResolve('/a', '/b', 'c') === '/b/c', 'resolve .. and absolute')
  assert(labJoin('/lab', './x', '../y.json') === '/lab/y.json', 'join normalizes')
  console.log('  ✓ Lab paths display normalized (/lab/assets/test_image.png)')

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
