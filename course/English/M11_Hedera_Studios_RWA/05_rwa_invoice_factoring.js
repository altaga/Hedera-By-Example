/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Real-World Asset (RWA) Invoice Factoring Pipeline
 * [ CONCEPT ] Fractional Commercial Debt & Secondary Liquidity
 * ============================================================================
 * [ KEY CONCEPT ]
 * Unlocking Illiquid Working Capital: Small and medium enterprises (SMEs) routinely
 * wait 60 to 90 days for Fortune 500 buyers to settle invoices, creating severe
 * liquidity constraints. By tokenizing verified accounts receivable on Hedera,
 * businesses can sell discounted fractional invoice tokens to global liquidity
 * pools in seconds, with automated on-chain yield redemption upon debtor payment.
 * *
 * [ LEARNABLE MOMENT ]
 * Tokenizing trade receivables unlocks fractional secondary market liquidity for small businesses, while anchoring invoice hashes to HCS prevents double-invoicing fraud.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/tokenization/ats
 *
 * [ LEARNING PATH ]
 * - Previous: M11 Lab 04: Proof-of-Reserve Oracle
 * - Next:     M11 Lab 06: RWA Multi-Asset Pool Tokens
 *
 * [ SIMULATED ]
 * Investor subscriptions and the debtor repayment are modeled with simple transfers. The tokens are real.
 *
 * [ HOW TO RUN ]
 * node English/M11_Hedera_Studios_RWA/05_rwa_invoice_factoring.js
 * ============================================================================
 */

import {
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TransferTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

const INVOICE_METADATA = {
  invoiceId: 'INV-2026-OCT-8842',
  debtor: 'Global Logistics Corp (AA+ Rated)',
  supplierSme: 'Precision Semiconductor Components Ltd',
  faceValueUsd: 50000,
  termDays: 60,
  annualDiscountRate: 0.08, // 8% annualized discount
  units: 50000 // $1 face value per unit
}

const main = async () => {
  console.log('--- SESSION START: RWA Invoice Factoring & Settlement Pipeline ---\n')
  const { client, operatorId, network } = getClient()

  try {
    // 1. Calculate Factoring Economics
    const discountAmountUsd = INVOICE_METADATA.faceValueUsd * (INVOICE_METADATA.annualDiscountRate * (INVOICE_METADATA.termDays / 365))
    const upfrontPayoutToSmeUsd = INVOICE_METADATA.faceValueUsd - discountAmountUsd
    const annualizedRoiPercent = INVOICE_METADATA.annualDiscountRate * 100

    console.log('[⚙️ PROCESS] Calculating Invoice Tokenization Economics...')
    console.log(`[📊 LOG] Invoice ID:         ${INVOICE_METADATA.invoiceId}`)
    console.log(`[📊 LOG] Debtor (Payer):     ${INVOICE_METADATA.debtor}`)
    console.log(`[📊 LOG] SME Supplier:       ${INVOICE_METADATA.supplierSme}`)
    console.log(`[📊 LOG] Face Value:         $${INVOICE_METADATA.faceValueUsd.toLocaleString()} USD (60 Day Term)`)
    console.log(`[📊 LOG] Upfront SME Cash:   $${upfrontPayoutToSmeUsd.toFixed(2)} USD (Immediate Liquidity)`)
    console.log(`[📊 LOG] Investor Yield:     $${discountAmountUsd.toFixed(2)} USD (${annualizedRoiPercent}% APY)`)

    // 2. Tokenize the Receivable on HTS
    console.log('\n[⚙️ PROCESS] Minting 50,000 Fractional Invoice Tokens on Hedera Token Service...')
    const tokenCreateTx = await new TokenCreateTransaction()
      .setTokenName(`Invoice ${INVOICE_METADATA.invoiceId}`)
      .setTokenSymbol('INV-8842')
      .setDecimals(0)
      .setInitialSupply(INVOICE_METADATA.units)
      .setTokenType(TokenType.FungibleCommon)
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(INVOICE_METADATA.units)
      .setTreasuryAccountId(operatorId)
      .setAdminKey(client.operatorPublicKey)
      .setFreezeKey(client.operatorPublicKey)
      .setTokenMemo(`rwa:invoice:${INVOICE_METADATA.invoiceId}:face_${INVOICE_METADATA.faceValueUsd}`)
      .freezeWith(client)

    const tokenResponse = await tokenCreateTx.execute(client)
    const tokenReceipt = await tokenResponse.getReceipt(client)
    const invoiceTokenId = tokenReceipt.tokenId.toString()

    console.log(`[✅ SUCCESS] RWA Invoice Token Deployed: ${invoiceTokenId}`)
    console.log(`[🔗 EXPLORER] HashScan: ${getHashscanUrl(tokenResponse)}`)

    // 3. Simulate Investor Pool Subscription (Secondary Liquidity)
    console.log('\n[⚙️ PROCESS] Liquidity Pool purchases 50,000 tokens for upfront working capital...')
    const subscriptionTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-0.5)) // Simulation of liquidity transfer
      .addHbarTransfer(operatorId, new Hbar(0.5))
      .setTransactionMemo(`rwa:factoring_advance:${INVOICE_METADATA.invoiceId}`)
      .freezeWith(client)

    const subResponse = await subscriptionTx.execute(client)
    await subResponse.getReceipt(client)
    console.log('[✅ SUCCESS] Upfront Capital Transferred to SME Supplier.')

    // 4. Day 60: Debtor Repayment & Automated Investor Payout
    console.log('\n===============================================================')
    console.log('📅 MATURITY SETTLEMENT: DEBTOR SETTLES $50,000 USD FULL VALUE')
    console.log('===============================================================')

    const payoutTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-1.0)) // Simulated full repayment + yield
      .addHbarTransfer(operatorId, new Hbar(1.0))
      .setTransactionMemo(`rwa:maturity_payout:${INVOICE_METADATA.invoiceId}:full_settlement`)
      .freezeWith(client)

    const payoutResponse = await payoutTx.execute(client)
    const payoutReceipt = await payoutResponse.getReceipt(client)
    const payoutHashscanUrl = getHashscanUrl(payoutResponse)

    console.log('[✅ SUCCESS] Final Yield Distribution Settled On-Chain:')
    console.log(`[📊 LOG] Status:         ${payoutReceipt.status.toString()}`)
    console.log(`[📊 LOG] Transaction ID: ${payoutResponse.transactionId.toString()}`)
    console.log(`[🔗 EXPLORER] HashScan:  ${payoutHashscanUrl}`)

    updateState('INVOICE_TOKEN_ID', invoiceTokenId)
    updateState('INVOICE_SETTLEMENT_TX_ID', payoutResponse.transactionId.toString())

    console.log('\n💡 KEY CONCEPT:')
    console.log('RWA Tokenization connects real-world commerce with decentralized finance.')
    console.log('Hedera eliminates reconciliation friction, allowing businesses to access')
    console.log('instant global liquidity at a fraction of traditional factoring costs.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Invoice factoring simulation failed:', error.message)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
