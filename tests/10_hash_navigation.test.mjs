/**
 * TEST 10: Hash navigation in fresh browser profiles.
 * Needs a running site: HBE_BASE_URL=https://... (or http://localhost:PORT from `npx expo serve`).
 * Skips when HBE_BASE_URL is not set or no Chrome/Chromium is installed.
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const LAB = 'm12-02-json-rpc-relay-ethers'
const LAB2 = 'm12-03-foundry-hardhat-workflow'
const LAB_TITLE = 'JSON-RPC Relay'
const chromePath = () => [process.env.CHROME_PATH, '/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .filter(Boolean).find((p) => fs.existsSync(p)) || null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function runHashNavigationTest ({ base = process.env.HBE_BASE_URL, rounds = Number(process.env.HBE_ROUNDS || 3) } = {}) {
  console.log('\n🧪 TEST 10: Hash navigation (fresh profiles)')
  const exe = chromePath()
  if (!base || !exe) { console.log('  ⚠ skipped (set HBE_BASE_URL and install Chrome)'); return { passed: true, skipped: true } }
  base = base.replace(/\/+$/, '')
  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({ executablePath: exe, args: ['--no-sandbox'] })
  const view = (p) => p.evaluate(() => ({ hash: location.hash, h1: document.querySelector('h1')?.textContent || '' }))
  const fresh = async () => { const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1300, height: 900 }); return { ctx, p } }
  const onLab = (v, slug = LAB, title = LAB_TITLE) => v.hash === `#${slug}` && (!title || v.h1.includes(title))
  const scenarios = {
    'hash set before hydration': async (p) => { await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' }); await p.evaluate((s) => { location.hash = s }, LAB); await sleep(3000); return onLab(await view(p)) },
    'hash set after load': async (p) => { await p.goto(`${base}/`, { waitUntil: 'networkidle0' }); await p.evaluate((s) => { location.hash = s }, LAB); await sleep(1500); return onLab(await view(p)) },
    'paste-style href before hydration': async (p) => { await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' }); await p.evaluate((s) => { location.href = `/#${s}` }, LAB); await sleep(3000); return onLab(await view(p)) },
    'paste-style href after load': async (p) => { await p.goto(`${base}/`, { waitUntil: 'networkidle0' }); await p.evaluate((s) => { location.href = `/#${s}` }, LAB); await sleep(1500); return onLab(await view(p)) },
    'direct lab link': async (p) => { await p.goto(`${base}/#${LAB}`, { waitUntil: 'networkidle0' }); await sleep(1000); return onLab(await view(p)) },
    'in-app click, back and forward': async (p) => {
      await p.goto(`${base}/#${LAB}`, { waitUntil: 'networkidle0' }); await sleep(1000)
      await p.click('.pager-next'); await sleep(1000)
      const a = await view(p); if (a.hash !== `#${LAB2}`) return false
      await p.goBack(); await sleep(1000); if (!onLab(await view(p))) return false
      await p.goForward(); await sleep(1000); return (await view(p)).hash === `#${LAB2}` && !(await view(p)).h1.includes(LAB_TITLE)
    },
    'home, hash, back to home': async (p) => {
      await p.goto(`${base}/`, { waitUntil: 'networkidle0' }); await p.evaluate((s) => { location.hash = s }, LAB); await sleep(1500)
      if (!onLab(await view(p))) return false
      await p.goBack(); await sleep(1500); const v = await view(p); return !v.h1.includes(LAB_TITLE)
    }
  }
  const failures = []
  try {
    for (const [name, fn] of Object.entries(scenarios)) {
      let ok = 0
      for (let i = 0; i < rounds; i++) {
        const { ctx, p } = await fresh()
        try { if (await fn(p)) ok++; else failures.push(`${name} (round ${i + 1}): ${JSON.stringify(await view(p))}`) } catch (e) { failures.push(`${name} (round ${i + 1}): ${e.message}`) } finally { await ctx.close() }
      }
      console.log(`  ${ok === rounds ? '✓' : '✗'} ${name}: ${ok}/${rounds}`)
    }
  } finally { await browser.close() }
  if (failures.length) { failures.slice(0, 10).forEach((f) => console.log('    ' + f)); throw new Error(`TEST 10 FAILED: ${failures.length} navigation checks failed`) }
  console.log('✅ TEST 10 PASSED: hash navigation works in fresh profiles.')
  return { passed: true }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runHashNavigationTest().catch((err) => { console.error(err.message || err); process.exit(1) })
}
