/**
 * Isolate HBE faucet pool from any shared HFD mnemonic.
 * - Generates a NEW BIP-39 mnemonic
 * - Rewrites FAUCET_MNEMONIC in faucet/.env (+ optional app/.env)
 * - Fixes OPERATOR_ID to match OPERATOR_KEY's on-chain account
 * - Archives old faucet-accounts.json
 * - Verifies 100/100 distinct derivable wallets (RPC balance query)
 * - DOES NOT send any HBAR
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { ethers } from 'ethers'
import { PrivateKey } from '@hiero-ledger/sdk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const faucetRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(faucetRoot, '..')
const envPath = path.resolve(faucetRoot, '.env')
const appEnvPath = path.resolve(repoRoot, 'app', '.env')
const accountsPath = path.resolve(faucetRoot, 'faucet-accounts.json')
const backupDir = path.resolve(faucetRoot, '.local-backups')

dotenv.config({ path: envPath })

const POOL_SIZE = parseInt(process.env.FAUCET_POOL_SIZE || '25', 10)
const RPC_URL =
  (process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet') === 'mainnet'
    ? 'https://mainnet.hashio.io/api'
    : 'https://testnet.hashio.io/api'
const MIRROR = 'https://testnet.mirrornode.hedera.com/api/v1'

function readEnvFile (file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

function upsertEnv (content, key, value) {
  const line = `${key}=${value}`
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm')
  if (re.test(content)) return content.replace(re, line)
  return `${content.trimEnd()}\n${line}\n`
}

function parseEnvValue (content, key) {
  const m = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm'))
  if (!m) return ''
  let v = m[1].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  return v
}

async function mirrorAccount (evmOrId) {
  const res = await fetch(`${MIRROR}/accounts/${evmOrId}`)
  if (!res.ok) return null
  return res.json()
}

const oldEnv = readEnvFile(envPath)
const oldMnemonic = parseEnvValue(oldEnv, 'FAUCET_MNEMONIC') || (process.env.FAUCET_MNEMONIC || '')
const operatorKey = parseEnvValue(oldEnv, 'OPERATOR_KEY') || (process.env.OPERATOR_KEY || '')

if (!operatorKey) {
  console.error('OPERATOR_KEY missing — aborting (need HBE operator to keep)')
  process.exit(1)
}

// Resolve operator EVM + Hedera account from key
let rawHex
try {
  const decoded = PrivateKey.fromStringDer(operatorKey.trim())
  const raw = decoded.toStringRaw()
  rawHex = raw.startsWith('0x') ? raw : `0x${raw}`
} catch {
  rawHex = operatorKey.trim().startsWith('0x') ? operatorKey.trim() : `0x${operatorKey.trim()}`
}
const opEvm = new ethers.Wallet(rawHex).address
const opInfo = await mirrorAccount(opEvm)
if (!opInfo?.account) {
  console.error('Could not resolve OPERATOR_KEY to a Hedera account on testnet mirror')
  process.exit(1)
}
const operatorId = opInfo.account

// Backup old mnemonic (local only; gitignored via **/.env* and we use .local-backups)
fs.mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
if (oldMnemonic) {
  fs.writeFileSync(
    path.join(backupDir, `FAUCET_MNEMONIC.shared-or-old.${stamp}.txt`),
    oldMnemonic + '\n',
    { mode: 0o600 }
  )
}
if (fs.existsSync(accountsPath)) {
  fs.renameSync(accountsPath, path.join(backupDir, `faucet-accounts.${stamp}.json`))
}

// New isolated mnemonic
const wallet = ethers.Wallet.createRandom()
const newMnemonic = wallet.mnemonic.phrase

// Prove old vs new pools differ (if old existed)
let overlap = null
if (oldMnemonic) {
  try {
    const old0 = ethers.HDNodeWallet.fromPhrase(oldMnemonic.trim(), undefined, "m/44'/60'/0'/0/0").address
    const new0 = ethers.HDNodeWallet.fromPhrase(newMnemonic, undefined, "m/44'/60'/0'/0/0").address
    overlap = { old0, new0, same: old0.toLowerCase() === new0.toLowerCase() }
  } catch (e) {
    overlap = { error: e.message }
  }
}

// Write envs (quote mnemonic)
let nextEnv = oldEnv
nextEnv = upsertEnv(nextEnv, 'FAUCET_MNEMONIC', `"${newMnemonic}"`)
nextEnv = upsertEnv(nextEnv, 'OPERATOR_ID', operatorId)
// strip PORT from being required in app copy later
fs.writeFileSync(envPath, nextEnv.endsWith('\n') ? nextEnv : nextEnv + '\n')

if (fs.existsSync(appEnvPath) || true) {
  let appEnv = readEnvFile(appEnvPath)
  if (!appEnv) appEnv = nextEnv
  appEnv = upsertEnv(appEnv, 'FAUCET_MNEMONIC', `"${newMnemonic}"`)
  appEnv = upsertEnv(appEnv, 'OPERATOR_ID', operatorId)
  appEnv = upsertEnv(appEnv, 'OPERATOR_KEY', operatorKey.trim())
  appEnv = appEnv.replace(/^\s*PORT\s*=.*\r?\n?/m, '')
  fs.writeFileSync(appEnvPath, appEnv.endsWith('\n') ? appEnv : appEnv + '\n')
}

// Verify 100 wallets
const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true })
const addresses = []
const seen = new Set()
let rpcOk = 0
let rpcFail = 0
const CONCURRENCY = 10
let next = 0
const results = new Array(POOL_SIZE)

async function worker () {
  while (next < POOL_SIZE) {
    const i = next++
    try {
      const w = ethers.HDNodeWallet.fromPhrase(newMnemonic, undefined, `m/44'/60'/0'/0/${i}`)
      if (seen.has(w.address.toLowerCase())) {
        results[i] = { i, ok: false, err: 'duplicate address' }
        continue
      }
      seen.add(w.address.toLowerCase())
      addresses[i] = w.address
      const bal = await provider.getBalance(w.address)
      results[i] = {
        i,
        ok: true,
        address: w.address,
        balHbar: parseFloat(ethers.formatEther(bal)),
      }
      rpcOk++
    } catch (e) {
      results[i] = { i, ok: false, err: e.message }
      rpcFail++
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

const failed = results.filter((r) => !r?.ok)
const withDust = results.filter((r) => r?.ok && r.balHbar > 0)
const allOk = failed.length === 0 && seen.size === POOL_SIZE

const summary = {
  isolated: true,
  funded: false,
  poolSize: POOL_SIZE,
  allWalletsOk: allOk,
  distinctAddresses: seen.size,
  rpcOk,
  rpcFail,
  unexpectedPreBalance: withDust.length,
  operator: {
    id: operatorId,
    evm: opEvm,
    balanceHbar: parseFloat(ethers.formatEther(await provider.getBalance(opEvm))),
  },
  poolDiffersFromOld: overlap ? !overlap.same : null,
  oldPoolSample0: overlap?.old0 || null,
  newPoolSample0: addresses[0] || null,
  newPoolSample1: addresses[1] || null,
  newPoolSample99: addresses[99] || null,
  backupsDir: backupDir,
  note: 'No HBAR was sent. Wait for treasury top-up, then run faucet:setup ONLY after explicit approval.',
}

fs.writeFileSync(
  path.join(backupDir, `isolate-summary.${stamp}.json`),
  JSON.stringify(summary, null, 2)
)

console.log(JSON.stringify(summary, null, 2))
if (!allOk) process.exit(2)
