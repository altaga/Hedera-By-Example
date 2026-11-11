// Faucet locks: concurrent claims for one address pay once (no network: ethers is stubbed).
// Run: npx --yes tsx tests/13_faucet_lock.test.ts
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { ethers } from '../app/node_modules/ethers/lib.esm/index.js'

// The faucet service may load ethers' ESM or CommonJS build depending on the loader: stub both.
const appRequire = createRequire(new URL('../app/package.json', import.meta.url))
const ethersBuilds = [ethers, appRequire('ethers').ethers]

process.env.FAUCET_MNEMONIC = 'test test test test test test test test test test test junk'
process.env.POSTHOG_DISABLED = 'true'

const payments: string[] = []
const PAY_DELAY_MS = 200
for (const build of ethersBuilds) {
  ;(build.JsonRpcProvider.prototype as any).getTransactionCount = async () => 0
  ;(build.JsonRpcProvider.prototype as any).getFeeData = async () => ({ gasPrice: 300_000_000_000n })
  ;(build.Wallet.prototype as any).sendTransaction = async function (tx: { to: string }) {
    payments.push(String(tx.to).toLowerCase())
    await new Promise((resolve) => setTimeout(resolve, PAY_DELAY_MS))
    return { hash: `0x${String(payments.length).padStart(64, '0')}` }
  }
}

const { disburseHbar } = await import('../app/src/server/faucetService')
const { POST: welcomeDrop } = await import('../app/src/app/api/welcome-drop+api')

let n = 0
const t = async (label: string, fn: () => Promise<void>) => { await fn(); n++; console.log('ok', label) }
const addr = (i: number) => ethers.getAddress(`0x${i.toString(16).padStart(40, '0')}`)
const paidTo = (a: string) => payments.filter((p) => p === a.toLowerCase()).length

await t('two simultaneous claims for the same address make one payment', async () => {
  const a = addr(0xa1)
  const [r1, r2] = await Promise.all([disburseHbar({ evmAddress: a }), disburseHbar({ evmAddress: a })])
  assert.equal(paidTo(a), 1)
  assert.equal([r1, r2].filter((r) => r.success).length, 1)
})

await t('a request turned away does not release the in-flight lock of the one being paid', async () => {
  const a = addr(0xb2)
  const first = disburseHbar({ evmAddress: a }) // paying, holds the in-flight lock
  await new Promise((resolve) => setTimeout(resolve, 20))
  const second = await disburseHbar({ evmAddress: a }) // turned away by the in-flight lock
  assert.match(second.error || '', /already in progress for this address/)
  // Before the fix the second request's `finally` cleared the first one's in-flight mark, so a
  // third request got past it (and only the 5-minute claim lock stopped it).
  const third = await disburseHbar({ evmAddress: a })
  assert.match(third.error || '', /already in progress for this address/, 'the in-flight lock must still be held')
  assert.equal((await first).success, true)
  assert.equal(paidTo(a), 1)
})

await t('five concurrent claims through POST /api/welcome-drop with skipCooldown: true pay once', async () => {
  const a = addr(0xc3)
  const post = () => welcomeDrop(new Request('https://hbe.expo.app/api/welcome-drop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ evmAddress: a, skipCooldown: true })
  }))
  const responses = await Promise.all([post(), post(), post(), post(), post()])
  const bodies = await Promise.all(responses.map((r) => r.json()))
  assert.equal(paidTo(a), 1)
  assert.equal(bodies.filter((b: any) => b.success).length, 1)
})

await t('after the payment, the 5-minute claim lock still turns the address away', async () => {
  const a = addr(0xa1)
  const again = await disburseHbar({ evmAddress: a })
  assert.equal(again.success, false)
  assert.equal(again.code, 'FAUCET_IN_FLIGHT')
  assert.equal(paidTo(a), 1)
})

console.log(`\n${n} passed`)
