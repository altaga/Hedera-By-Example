/**
 * Read-only: for a few pool wallets, ask Mirror Node who last funded them.
 * Never prints private keys / mnemonic.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { ethers } from 'ethers'
import { PrivateKey } from '@hiero-ledger/sdk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const MIRROR = 'https://testnet.mirrornode.hedera.com/api/v1'
const mnemonic = (process.env.FAUCET_MNEMONIC || '').trim().replace(/^["']|["']$/g, '')
const operatorKey = (process.env.OPERATOR_KEY || '').trim()
const operatorId = process.env.OPERATOR_ID || ''

if (!mnemonic || !operatorKey) {
  console.error('Missing FAUCET_MNEMONIC or OPERATOR_KEY')
  process.exit(1)
}

let opEvm
try {
  const decoded = PrivateKey.fromStringDer(operatorKey)
  const raw = decoded.toStringRaw()
  opEvm = new ethers.Wallet(raw.startsWith('0x') ? raw : `0x${raw}`).address
} catch {
  const raw = operatorKey.startsWith('0x') ? operatorKey : `0x${operatorKey}`
  opEvm = new ethers.Wallet(raw).address
}

async function mirror (pathname) {
  const res = await fetch(`${MIRROR}${pathname}`)
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}`)
  return res.json()
}

async function accountForEvm (evm) {
  const data = await mirror(`/accounts/${evm}`)
  return {
    account: data.account,
    balanceTinybars: data.balance?.balance ?? null,
    evmAddress: data.evm_address || evm,
  }
}

async function fundingTransfers (accountId, limit = 15) {
  // crypto transfers involving this account, newest first
  const data = await mirror(
    `/transactions?account.id=${accountId}&transactiontype=cryptotransfer&order=desc&limit=${limit}`
  )
  const hits = []
  for (const tx of data.transactions || []) {
    const transfers = tx.transfers || []
    const self = transfers.find((t) => t.account === accountId)
    if (!self || self.amount <= 0) continue // only inbound
    const payers = transfers
      .filter((t) => t.amount < 0)
      .map((t) => ({ account: t.account, tinybars: t.amount }))
      .sort((a, b) => a.tinybars - b.tinybars) // most negative first
    hits.push({
      consensus: tx.consensus_timestamp,
      txId: tx.transaction_id,
      receivedTinybars: self.amount,
      receivedHbar: +(self.amount / 1e8).toFixed(4),
      topDebits: payers.slice(0, 3),
    })
  }
  return hits
}

const sampleIdx = [0, 1, 2, 30, 50, 99]
const opInfo = await accountForEvm(opEvm)

console.log(JSON.stringify({
  operatorIdEnv: operatorId,
  operatorEvm: opEvm,
  operatorMirrorAccount: opInfo.account,
  operatorMatch: opInfo.account === operatorId,
  samples: await Promise.all(sampleIdx.map(async (i) => {
    const w = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${i}`)
    const info = await accountForEvm(w.address)
    const inbound = await fundingTransfers(info.account, 20)
    const fromOperator = inbound.filter((h) =>
      h.topDebits.some((d) => d.account === operatorId || d.account === opInfo.account)
    )
    return {
      index: i,
      address: w.address,
      accountId: info.account,
      balanceHbar: info.balanceTinybars != null ? +(info.balanceTinybars / 1e8).toFixed(2) : null,
      inboundChecked: inbound.length,
      inboundFromOperator: fromOperator.length,
      latestInbound: inbound[0] || null,
      latestFromOperator: fromOperator[0] || null,
      otherPayersSeen: [...new Set(
        inbound.flatMap((h) => h.topDebits.map((d) => d.account))
          .filter((a) => a !== operatorId && a !== opInfo.account)
      )].slice(0, 8),
    }
  })),
}, null, 2))
