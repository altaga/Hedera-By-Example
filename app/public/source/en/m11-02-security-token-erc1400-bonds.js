/**
 * ============================================================================
 * Lab 02: Tranche Bonds on HTS & Coupon Payouts (ERC-1400 Concepts)
 * [CONCEPT] One Token per Tranche, Holder Snapshot from the Mirror Node, Atomic Coupon Run
 * ============================================================================
 * [ KEY CONCEPT ]
 * ERC-1400 models a security with "partitions" (e.g. Senior vs. Mezzanine) inside
 * one EVM contract. On Hedera's native Token Service the simplest faithful mapping
 * is one HTS token per tranche, sharing the issuer's keys. This lab:
 * 1. Issues two real tranche tokens (Senior 6.5% / Mezzanine 9.5%).
 * 2. Distributes bonds to three real, distinct investor accounts.
 * 3. Takes the holder snapshot from the Mirror Node (/tokens/{id}/balances) — the
 *    on-chain cap table, not a local list.
 * 4. Pays the quarterly coupon to every holder in ONE atomic TransferTransaction,
 *    sized from the snapshot, and verifies each holder's HBAR balance change.
 *
 * [ LEARNABLE MOMENT ]
 * This is NOT an ERC-1400 contract and does not use Asset Tokenization Studio:
 * partitions are separate HTS tokens and the coupon amounts are scaled down to
 * tinybars for testnet. For a production bond with ERC-1400/ERC-3643 semantics
 * (corporate actions, partitions, compliance modules) use Hedera's Asset
 * Tokenization Studio.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/define-a-token
 * - https://docs.hedera.com/hedera/sdks-and-apis/rest-api/tokens
 * - https://github.com/hashgraph/asset-tokenization-studio
 *
 * [ LEARNING PATH ]
 * - Previous: M11 Lab 01: Permissioned RWA Transfers (HTS KYC)
 * - Next:     M11 Lab 03: Stablecoin Roles on HTS
 *
 * [SEQUENCE]
 * Issuer -> Hedera: Create Senior and Mezzanine tranche tokens
 * Issuer -> Investors: Distribute bonds
 * Issuer -> MirrorNode: Read holder balances (cap table)
 * Issuer -> Investors: One atomic coupon transfer to all holders
 *
 * [SIMULATED]
 * The coupon date is "now" instead of a real quarter end, and coupon amounts are scaled to tinybars. Tokens, holders, snapshot and payments are real and go to distinct accounts.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (creates 3 throwaway investor accounts and 2 tokens).
 * - Cost: ~18 ℏ (token creation ~15 ℏ on testnet) + ~0.3 ℏ to throwaway accounts + fees.
 *
 * [ HOW TO RUN ]
 * node English/M11_Hedera_Studios_RWA/02_security_token_erc1400_bonds.js
 * ============================================================================
 */

import {
  Hbar,
  TokenCreateTransaction,
  TokenSupplyType,
  TokenType,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { createLabAccount, getClient, getHashscanUrl, getMirrorHbarTinybars, getMirrorNodeBaseUrl, sleep, updateState, waitForMirror } from '../M99_Utilities/index.js'

const BOND = {
  issuer: 'Hedera Renewable Energy Holdings Inc.',
  isin: 'US42312A1099',
  tranches: [
    { id: 'SENIOR', symbol: 'GRE31-SR', couponApy: 0.065, units: 500 },
    { id: 'MEZZANINE', symbol: 'GRE31-MZ', couponApy: 0.095, units: 250 }
  ]
}
// Testnet scale: each bond unit has a "face value" of 100,000 tinybars (0.001 ℏ).
const FACE_VALUE_TINYBARS = 100_000

const createTranche = async (client, operatorId, tranche) => {
  const receipt = await (await new TokenCreateTransaction()
    .setTokenName(`Green Energy 2031 Bond ${tranche.id}`)
    .setTokenSymbol(tranche.symbol)
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(0)
    .setInitialSupply(tranche.units)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(tranche.units)
    .setTreasuryAccountId(operatorId)
    .setAdminKey(client.operatorPublicKey)
    .setFreezeKey(client.operatorPublicKey)
    .setWipeKey(client.operatorPublicKey)
    .setTokenMemo(`bond:${BOND.isin}:tranche:${tranche.id}`)
    .execute(client)).getReceipt(client)
  return receipt.tokenId
}

/** On-chain cap table: every non-treasury holder of the token, from the Mirror Node. */
const holderSnapshot = async (tokenId, treasury, expectedHolders) => waitForMirror(async () => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/tokens/${tokenId}/balances?limit=100`)
  if (!res.ok) return null
  const holders = (await res.json()).balances.filter((b) => b.account !== treasury && b.balance > 0)
  return holders.length >= expectedHolders ? holders : null
})

const main = async () => {
  console.log('--- SESSION START: Tranche Bonds on HTS & Coupon Payouts ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Tranche tokens
    console.log(`[PROCESS] Step 1: Issuing tranche tokens for ${BOND.issuer} (ISIN ${BOND.isin})...`)
    for (const t of BOND.tranches) {
      t.tokenId = await createTranche(client, operatorId, t)
      console.log(`[SUCCESS] ${t.id} tranche: ${t.tokenId} | ${t.units} units | ${(t.couponApy * 100).toFixed(1)}% APY`)
    }

    // 2. Real investors and allocation
    console.log('\n[PROCESS] Step 2: Creating 3 investor accounts and allocating bonds...')
    const investors = []
    for (let i = 0; i < 3; i++) investors.push(await createLabAccount(client, { hbar: 0.1 }))
    const [sr, mz] = BOND.tranches
    const allocation = new TransferTransaction()
      .addTokenTransfer(sr.tokenId, operatorId, -300)
      .addTokenTransfer(sr.tokenId, investors[0].accountId, 200)
      .addTokenTransfer(sr.tokenId, investors[1].accountId, 100)
      .addTokenTransfer(mz.tokenId, operatorId, -150)
      .addTokenTransfer(mz.tokenId, investors[1].accountId, 50)
      .addTokenTransfer(mz.tokenId, investors[2].accountId, 100)
    const allocRes = await allocation.execute(client)
    await allocRes.getReceipt(client)
    console.log(`[SUCCESS] Allocation ${allocRes.transactionId}`)
    investors.forEach((inv, i) => console.log(`[LOG] Investor ${i + 1}: ${inv.accountId}`))

    // 3. Holder snapshot from the Mirror Node
    console.log('\n[PROCESS] Step 3: Reading the on-chain cap table from the Mirror Node...')
    const payouts = new Map()
    for (const t of BOND.tranches) {
      const holders = await holderSnapshot(t.tokenId.toString(), operatorId.toString(), 2)
      if (!holders) throw new Error(`Mirror Node did not return holders for ${t.tokenId}`)
      const perUnit = Math.floor(FACE_VALUE_TINYBARS * t.couponApy / 4)
      for (const h of holders) {
        const amount = h.balance * perUnit
        payouts.set(h.account, (payouts.get(h.account) || 0) + amount)
        console.log(`[SNAPSHOT] ${t.id} holder ${h.account}: ${h.balance} units -> coupon ${amount} tinybars`)
      }
    }

    // 4. One atomic coupon payment to all holders
    console.log('\n[PROCESS] Step 4: Paying the quarterly coupon to all holders in one transaction...')
    const before = Object.fromEntries(await Promise.all([...payouts.keys()].map(async (a) => [a, await getMirrorHbarTinybars(a)])))
    const total = [...payouts.values()].reduce((s, v) => s + v, 0)
    const couponTx = new TransferTransaction()
      .addHbarTransfer(operatorId, Hbar.fromTinybars(-total))
      .setTransactionMemo(`bond:${BOND.isin}:coupon`)
    for (const [account, amount] of payouts) couponTx.addHbarTransfer(account, Hbar.fromTinybars(amount))
    const couponRes = await couponTx.execute(client)
    const couponReceipt = await couponRes.getReceipt(client)
    console.log(`[SUCCESS] Coupon run ${couponReceipt.status} — ${couponRes.transactionId}`)
    console.log(`[EXPLORER] ${getHashscanUrl(couponRes)}`)

    await sleep(6000)
    for (const [account, amount] of payouts) {
      const delta = (await getMirrorHbarTinybars(account)) - before[account]
      console.log(`[VERIFY] ${account}: expected +${amount}, Mirror Node shows +${delta} tinybars`)
    }

    updateState('BOND_SENIOR_TOKEN_ID', sr.tokenId.toString())
    updateState('BOND_MEZZANINE_TOKEN_ID', mz.tokenId.toString())
    updateState('BOND_COUPON_TX_ID', couponRes.transactionId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('The coupon was computed from the on-chain cap table and paid to every holder')
    console.log('atomically. Tranches are separate HTS tokens; ERC-1400 partitions live in ATS contracts.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Bond lab failed:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
