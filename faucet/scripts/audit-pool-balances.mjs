/**
 * Read-only audit: how many of the 100 pool wallets actually hold HBAR.
 * Prints summary only — never private keys.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { ethers } from 'ethers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const NETWORK = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet'
const RPC_URL = NETWORK === 'mainnet' ? 'https://mainnet.hashio.io/api' : 'https://testnet.hashio.io/api'
const POOL_SIZE = parseInt(process.env.FAUCET_POOL_SIZE || '25', 10)
const TARGET = parseFloat(process.env.TARGET_HBAR_PER_WALLET || '100')
const FUNDED_MIN = 1 // ℏ — counts as "has money"
const mnemonic = (process.env.FAUCET_MNEMONIC || '').trim().replace(/^["']|["']$/g, '')

if (!mnemonic) {
  console.error('FAUCET_MNEMONIC missing')
  process.exit(1)
}

const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true })
const CONCURRENCY = 10

async function mapPool (fn) {
  const out = new Array(POOL_SIZE)
  let next = 0
  async function worker () {
    while (next < POOL_SIZE) {
      const i = next++
      out[i] = await fn(i)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  return out
}

const rows = await mapPool(async (i) => {
  const w = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${i + 1}`)
  let bal = 0
  try {
    bal = parseFloat(ethers.formatEther(await provider.getBalance(w.address)))
  } catch (e) {
    return { i, address: w.address, bal: null, err: e.message }
  }
  return { i, address: w.address, bal }
})

const ok = rows.filter((r) => r.bal != null)
const errors = rows.filter((r) => r.bal == null)
const withMoney = ok.filter((r) => r.bal >= FUNDED_MIN)
const atTarget = ok.filter((r) => r.bal >= TARGET)
const empty = ok.filter((r) => r.bal < FUNDED_MIN)
const bals = ok.map((r) => r.bal)
const sum = bals.reduce((a, b) => a + b, 0)
const min = bals.length ? Math.min(...bals) : 0
const max = bals.length ? Math.max(...bals) : 0

console.log(JSON.stringify({
  poolSize: POOL_SIZE,
  targetHbar: TARGET,
  fundedMinHbar: FUNDED_MIN,
  queriedOk: ok.length,
  rpcErrors: errors.length,
  withMoney: withMoney.length,
  emptyOrDust: empty.length,
  atOrAboveTarget: atTarget.length,
  belowTarget: ok.length - atTarget.length,
  totalPoolHbar: +sum.toFixed(2),
  minHbar: +min.toFixed(2),
  maxHbar: +max.toFixed(2),
  avgHbar: bals.length ? +(sum / bals.length).toFixed(2) : 0,
  emptyIndexes: empty.slice(0, 20).map((r) => r.i),
  emptyIndexesMore: Math.max(0, empty.length - 20),
  weakest10: [...ok].sort((a, b) => a.bal - b.bal).slice(0, 10).map((r) => ({ i: r.i, bal: +r.bal.toFixed(2) })),
}, null, 2))
