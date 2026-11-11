/* global localStorage, KeyboardEvent -- browser globals used inside page.evaluate() */
/**
 * TEST 07: one Run = one transaction.
 * Serves the exported web build (app/dist), opens the M04-01 HBAR transfer
 * lab in headless Chrome with a fake wallet, and answers every Hedera node
 * request locally (nothing reaches testnet). Clicking Run twice and pressing
 * Ctrl+Enter twice during the run must submit exactly ONE transfer.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APP = path.join(ROOT, 'app')
const require = createRequire(path.join(APP, 'package.json'))

const CHROMES = [process.env.CHROME_PATH, '/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean)

// gRPC-web frames: an empty OK message, then the trailers.
function grpcWebOk (msg = Buffer.alloc(0)) {
  const data = Buffer.concat([Buffer.from([0, 0, 0, 0, 0]), msg])
  data.writeUInt32BE(msg.length, 1)
  const trailer = Buffer.from('grpc-status:0\r\ngrpc-message:\r\n')
  const t = Buffer.concat([Buffer.from([0x80, 0, 0, 0, 0]), trailer])
  t.writeUInt32BE(trailer.length, 1)
  return Buffer.concat([data, t])
}

export async function runRunOnceTest () {
  console.log('\n================================================================')
  console.log('🧪 TEST 07: ONE RUN = ONE TRANSACTION (double click + Ctrl+Enter)')
  console.log('================================================================')
  const chrome = CHROMES.find((p) => fs.existsSync(p))
  const remote = process.env.HBE_BASE_URL // e.g. https://hbe.expo.app: test a deployed build instead
  if (!chrome || (!remote && !fs.existsSync(path.join(APP, 'dist', 'server')))) {
    console.log('  ✓ Skipped (needs Chrome and an exported build: npx expo export --platform web)')
    return { passed: true, skipped: true }
  }
  const hedera = require('@hiero-ledger/sdk')
  const mk = (id) => { const k = hedera.PrivateKey.generateECDSA(); return { id: `w${id}`, label: `W${id}`, accountId: `0.0.${id}`, privateKey: k.toStringRaw(), publicKey: k.publicKey.toStringRaw(), evmAddress: k.publicKey.toEvmAddress(), keyType: 'ECDSA', createdAt: Date.now() } }
  const w1 = mk(900001); const w2 = mk(900002); const w3 = mk(900003)
  const store = { wallets: [w1, w2, w3], activeId: w1.id, roles: { account1: w2.id, account2: w3.id } }

  const port = 18000 + Math.floor(Math.random() * 1000)
  const server = remote ? null : spawn('npx', ['expo', 'serve', '--port', String(port)], { cwd: APP, stdio: 'pipe', env: { ...process.env, CI: '1' } })
  const base = remote || `http://localhost:${port}`
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) break } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const transfers = new Map() // transaction id -> submissions
  try {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', async (req) => {
      const url = req.url()
      if (process.env.HBE_DEBUG) console.log('REQ', req.method(), url.slice(0, 120))
      if (url.startsWith(base)) return req.continue()
      if (/hedera\.com|hashgraph|grpc/i.test(url) && req.method() === 'POST') {
        if (/CryptoService\/cryptoTransfer/.test(url)) {
          const body = Buffer.from(req.postData() || '', 'latin1')
          let raw = body
          if (req.headers()['content-type']?.includes('grpc-web-text')) raw = Buffer.from(body.toString(), 'base64')
          try {
            const tx = hedera.Transaction.fromBytes(raw.subarray(5))
            const id = tx.transactionId.toString()
            transfers.set(id, (transfers.get(id) || 0) + 1)
          } catch (e) { transfers.set(`undecoded-${transfers.size}`, 1) }
        }
        const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' }
        // Health check (POST to the node root): ready.
        if (new URL(url).pathname === '/') return req.respond({ status: 200, headers: { ...cors, 'content-type': 'application/grpc-web+proto', 'grpc-status': '0', 'grpc-message': '' }, body: '' })
        // Any call: an empty TransactionResponse (precheck OK). Receipts answer after 3 s,
        // like consensus, so the keyboard presses below land while the run is still going.
        const reply = () => req.respond({ status: 200, headers: { ...cors, 'content-type': 'application/grpc-web+proto' }, body: grpcWebOk() })
        return /getTransactionReceipts/.test(url) ? setTimeout(reply, 3000) : reply()
      }
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
      if (/mirrornode/.test(url)) return req.respond({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}' })
      return req.abort()
    })
    await page.evaluateOnNewDocument((s) => { localStorage.setItem('hbe_wallets_v1', s) }, JSON.stringify(store))
    await page.goto(`${base}/#m04-01-hbar-transfers`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=run-button]:not([disabled])', { timeout: 30000 })
    // Two clicks in the same tick (before React can re-render and disable the button), then Ctrl+Enter twice.
    await page.evaluate(() => {
      const b = document.querySelector('[data-testid=run-button]')
      const ctrlEnter = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
      b.click(); b.click(); ctrlEnter(); ctrlEnter()
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.up('Control')
    // Wait until the transfer was submitted and things settle.
    for (let i = 0; i < 40 && transfers.size === 0; i++) await new Promise((resolve) => setTimeout(resolve, 250))
    await new Promise((resolve) => setTimeout(resolve, 4000))
    if (process.env.HBE_DEBUG) console.log(await page.$eval('[data-testid=run-output]', (e) => e.innerText).catch((e) => String(e)))
  } finally {
    await browser.close()
    server?.kill('SIGTERM')
  }
  const ids = [...transfers.keys()]
  console.log(`  · cryptoTransfer submissions: ${[...transfers.values()].reduce((a, b) => a + b, 0)} (${ids.length} distinct)`)
  if (ids.length !== 1) throw new Error(`Expected exactly 1 transfer submission, got ${ids.length}: ${ids.join(', ')}`)
  console.log('  ✓ Double click + Ctrl+Enter twice submitted exactly one transfer')
  return { passed: true }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runRunOnceTest().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1) })
}
