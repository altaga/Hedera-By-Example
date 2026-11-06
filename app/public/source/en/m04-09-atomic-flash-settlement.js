/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 09: Zero-Capital Flash Loans & Atomic Layer 1 Settlement
 * [CONCEPT] Single-Transaction Atomic Borrow, Arbitrage, and Repayment
 * ============================================================================
 * [ KEY CONCEPT ]
 * On Ethereum, a flash loan needs a lending-pool contract with callback hooks; if the
 * borrower does not repay in the same call, everything reverts.
 * On Hedera, ONE TransferTransaction can move HBAR and tokens between several
 * accounts, signed by every party, and the network applies all of it or none of it.
 * This lab runs that with four real, distinct testnet accounts and a real HTS token:
 *   - Leg 1: Vault lends the principal to the Arbitrageur.
 *   - Leg 2: Arbitrageur buys 100 FLASH from Market Alpha for the principal.
 *   - Leg 3: Arbitrageur sells the 100 FLASH to Market Beta at +0.5%.
 *   - Leg 4: Arbitrageur repays principal + 0.09% fee to the Vault and keeps the spread.
 * Then a second attempt with a principal Beta cannot cover is rejected as a whole.
 *
 * [ LEARNABLE MOMENT ]
 * Hedera nets all legs per account before checking balances: the vault's loan and
 * repayment collapse into "+fee". Atomicity comes from the transaction, not a contract.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/transfer-cryptocurrency
 *
 * [ LEARNING PATH ]
 * - Previous: M4 Lab 08: In-Memory Orderbook & Triangular L1 Clearing
 * - Next:     M5 Lab 01: Immutable Topics
 *
 * [SEQUENCE]
 * Vault, Arbitrageur, Alpha, Beta -> Hedera: One transaction: borrow + buy + sell + repay
 * Note Hedera: All legs netted per account and checked at consensus
 * Hedera -> Arbitrageur: Settles only if every party can pay its net amount
 *
 * [SIMULATED]
 * The two "markets" are throwaway accounts with fixed prices, not real exchanges.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (creates 4 throwaway accounts and a FLASH token).
 * - Cost: ~17 ℏ (FLASH token creation ~15 ℏ on testnet) + ~0.6 ℏ to throwaway accounts + fees.
 *
 * [ HOW TO RUN ]
 * node English/M4_Token_Operations_Atomic_Swaps/09_atomic_flash_settlement.js
 * ============================================================================
 */

import { Hbar, TokenCreateTransaction, TokenType, TransferTransaction } from '@hiero-ledger/sdk'
import { createLabAccount, getClient, getHashscanUrl, getMirrorHbarTinybars, sleep, updateState } from '../M99_Utilities/index.js'

const FEE_BPS = 9 // 0.09% flash fee
const SPREAD = 0.005 // Beta pays +0.5%
const UNITS = 100

const buildFlashTx = (client, parties, tokenId, principal) => {
  const { vault, arb, alpha, beta } = parties
  const fee = Math.ceil((principal * FEE_BPS) / 10000)
  const sale = Math.floor(principal * (1 + SPREAD))
  const tx = new TransferTransaction()
    // Leg 1: loan
    .addHbarTransfer(vault.accountId, Hbar.fromTinybars(-principal))
    .addHbarTransfer(arb.accountId, Hbar.fromTinybars(principal))
    // Leg 2: buy from Alpha
    .addHbarTransfer(arb.accountId, Hbar.fromTinybars(-principal))
    .addHbarTransfer(alpha.accountId, Hbar.fromTinybars(principal))
    .addTokenTransfer(tokenId, alpha.accountId, -UNITS)
    .addTokenTransfer(tokenId, arb.accountId, UNITS)
    // Leg 3: sell to Beta
    .addHbarTransfer(beta.accountId, Hbar.fromTinybars(-sale))
    .addHbarTransfer(arb.accountId, Hbar.fromTinybars(sale))
    .addTokenTransfer(tokenId, arb.accountId, -UNITS)
    .addTokenTransfer(tokenId, beta.accountId, UNITS)
    // Leg 4: repay principal + fee
    .addHbarTransfer(arb.accountId, Hbar.fromTinybars(-(principal + fee)))
    .addHbarTransfer(vault.accountId, Hbar.fromTinybars(principal + fee))
    .setTransactionMemo('hbe:flash-loan-atomic-settlement')
    .freezeWith(client)
  return { tx, fee, profit: sale - principal - fee }
}

const signAll = async (tx, parties) => {
  for (const p of Object.values(parties)) await tx.sign(p.privateKey)
  return tx
}

const main = async () => {
  console.log('--- SESSION START: Zero-Capital Flash Loan & Atomic L1 Settlement ---\n')
  const { client } = getClient()

  try {
    console.log('[PROCESS] Step 1: Creating Vault, Arbitrageur, Market Alpha and Market Beta accounts...')
    const parties = {
      vault: await createLabAccount(client, { hbar: 0.2 }),
      arb: await createLabAccount(client, { hbar: 0.05 }),
      alpha: await createLabAccount(client, { hbar: 0.05 }),
      beta: await createLabAccount(client, { hbar: 0.3 })
    }
    for (const [name, p] of Object.entries(parties)) console.log(`[LOG] ${name.padEnd(6)} ${p.accountId}`)

    console.log('\n[PROCESS] Step 2: Creating the FLASH token and giving Alpha its inventory...')
    const tokenId = (await (await new TokenCreateTransaction()
      .setTokenName('Flash Demo Asset').setTokenSymbol('FLASH').setTokenType(TokenType.FungibleCommon)
      .setDecimals(0).setInitialSupply(UNITS * 10).setTreasuryAccountId(client.operatorAccountId)
      .execute(client)).getReceipt(client)).tokenId
    await (await new TransferTransaction()
      .addTokenTransfer(tokenId, client.operatorAccountId, -UNITS)
      .addTokenTransfer(tokenId, parties.alpha.accountId, UNITS)
      .execute(client)).getReceipt(client)
    console.log(`[SUCCESS] Token ${tokenId}; Alpha holds ${UNITS} FLASH`)

    const principal = 10_000_000 // 0.1 HBAR
    console.log(`\n[PROCESS] Step 3: One 4-leg transaction, principal ${principal} tinybars, signed by all four parties...`)
    const arbBefore = await getMirrorHbarTinybars(parties.arb.accountId.toString())
    const { tx, fee, profit } = buildFlashTx(client, parties, tokenId, principal)
    const res = await (await signAll(tx, parties)).execute(client)
    const receipt = await res.getReceipt(client)
    console.log(`[SUCCESS] Status ${receipt.status} — ${res.transactionId} | ${getHashscanUrl(res)}`)
    console.log(`[LOG] Fee to vault: ${fee} tinybars | Expected arbitrageur profit: ${profit} tinybars`)

    await sleep(6000)
    const arbAfter = await getMirrorHbarTinybars(parties.arb.accountId.toString())
    console.log(`[VERIFY] Mirror Node: arbitrageur balance changed by ${arbAfter - arbBefore} tinybars (no fees paid by it; the operator paid the transaction fee)`)

    console.log('\n[PROCESS] Step 4: Failure case — principal 1 ℏ, which Beta cannot pay for...')
    const vaultBefore = await getMirrorHbarTinybars(parties.vault.accountId.toString())
    try {
      const bad = buildFlashTx(client, parties, tokenId, 100_000_000)
      // Alpha no longer holds FLASH and Beta lacks HBAR: the network must reject everything
      await (await (await signAll(bad.tx, parties)).execute(client)).getReceipt(client)
      throw new Error('Expected the network to reject the transaction')
    } catch (error) {
      if (/Expected the network/.test(error.message)) throw error
      console.log(`[REJECTED] ${error.status ?? error.message}`)
    }
    await sleep(4000)
    const vaultAfter = await getMirrorHbarTinybars(parties.vault.accountId.toString())
    console.log(`[VERIFY] Vault balance unchanged: ${vaultBefore === vaultAfter} (${vaultAfter} tinybars)`)

    updateState('FLASH_SETTLEMENT_TX_ID', res.transactionId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('Four parties, one transaction: either every leg settles or none does.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Flash Loan Settlement Failure:', error.message)
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
