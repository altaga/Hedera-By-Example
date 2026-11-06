/**
 * ============================================================================
 * Lab 05: Real-World Asset (RWA) Invoice Factoring Pipeline
 * [CONCEPT] Tokenized Receivables, Delivery-versus-Payment & On-Chain Redemption
 * ============================================================================
 * [ KEY CONCEPT ]
 * SMEs often wait 60-90 days for large buyers to pay invoices. Tokenizing the
 * receivable lets an investor buy it at a discount today and collect the full face
 * value when the debtor pays. This lab runs the whole cycle between three real,
 * distinct testnet accounts:
 * 1. The SME anchors the invoice hash on HCS (prevents double-invoicing) and mints
 *    an invoice token with ITSELF as treasury.
 * 2. Advance: ONE atomic transaction swaps the investor's discounted HBAR for all
 *    invoice tokens (delivery-versus-payment: neither leg can happen alone).
 * 3. Maturity: ONE atomic transaction moves the debtor's full face value to the
 *    investor and returns the invoice tokens to the SME treasury (redemption).
 * 4. Mirror Node balances confirm who earned what.
 *
 * [ LEARNABLE MOMENT ]
 * Atomic multi-party TransferTransactions give you delivery-versus-payment without
 * an escrow contract. Amounts are scaled to tinybars for testnet (1 invoice unit =
 * 100 tinybars).
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 * - https://docs.hedera.com/solutions/tokenization/ats
 *
 * [ LEARNING PATH ]
 * - Previous: M11 Lab 04: Proof-of-Reserve (PoR) Oracle & Circuit Breakers
 * - Next:     M11 Lab 06: Institutional Multi-Asset Pool Tokens & RWA Baskets (Archax / ATS)
 *
 * [ SEQUENCE ]
 * SME -> Hedera: Anchor invoice hash on HCS, mint invoice token
 * Investor -> SME: Discounted HBAR for all invoice tokens (atomic DvP)
 * Debtor -> Investor: Full face value at maturity
 * Investor -> SME: Invoice tokens redeemed in the same transaction
 *
 * [ SIMULATED ]
 * The invoice data is sample data and maturity happens immediately instead of after 60 days; amounts are scaled to tinybars. All three parties are real accounts and every payment is real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (creates 3 throwaway accounts: SME, investor, debtor).
 * - Cost: ~18 ℏ (the operator pays the ~15 ℏ token creation) + ~0.7 ℏ to throwaway accounts + fees.
 *
 * [ HOW TO RUN ]
 * node English/M11_Hedera_Studios_RWA/05_rwa_invoice_factoring.js
 * ============================================================================
 */

import crypto from 'node:crypto'
import {
  Hbar,
  TokenCreateTransaction,
  TokenSupplyType,
  TokenType,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { createClient, createLabAccount, getClient, getHashscanUrl, getMirrorHbarTinybars, sleep, updateState } from '../M99_Utilities/index.js'

const INVOICE = {
  invoiceId: 'INV-2026-OCT-8842',
  debtor: 'Global Logistics Corp (AA+ Rated)',
  supplierSme: 'Precision Semiconductor Components Ltd',
  faceValueUsd: 50000,
  termDays: 60,
  annualDiscountRate: 0.08,
  units: 50000 // $1 face value per unit
}
const TINYBARS_PER_UNIT = 100 // testnet scale

const main = async () => {
  console.log('--- SESSION START: RWA Invoice Factoring & Settlement Pipeline ---\n')
  const { client } = getClient()

  try {
    // 1. Economics
    const faceTinybars = INVOICE.units * TINYBARS_PER_UNIT
    const discountTinybars = Math.floor(faceTinybars * INVOICE.annualDiscountRate * (INVOICE.termDays / 365))
    const advanceTinybars = faceTinybars - discountTinybars
    console.log('[PROCESS] Step 1: Invoice economics')
    console.log(`[LOG] ${INVOICE.invoiceId} | Debtor: ${INVOICE.debtor} | SME: ${INVOICE.supplierSme}`)
    console.log(`[LOG] Face ${faceTinybars} tinybars | Advance ${advanceTinybars} | Investor discount ${discountTinybars} (${INVOICE.annualDiscountRate * 100}% APR, ${INVOICE.termDays} days)`)

    // 2. Three real parties
    console.log('\n[PROCESS] Step 2: Creating SME, investor and debtor accounts...')
    const sme = await createLabAccount(client, { hbar: 0.3 })
    const investor = await createLabAccount(client, { hbar: 0.2 })
    const debtor = await createLabAccount(client, { hbar: 0.2 })
    console.log(`[LOG] SME ${sme.accountId} | Investor ${investor.accountId} | Debtor ${debtor.accountId}`)
    const smeClient = createClient(sme.accountId.toString(), sme.privateKey)

    // 3. SME anchors the invoice and mints the receivable token (SME is treasury)
    console.log('\n[PROCESS] Step 3: SME anchors the invoice hash on HCS and mints the invoice token...')
    const invoiceHash = crypto.createHash('sha256').update(JSON.stringify(INVOICE)).digest('hex')
    const topicId = (await (await new TopicCreateTransaction().setTopicMemo('hbe:invoice-registry').execute(smeClient)).getReceipt(smeClient)).topicId
    await (await new TopicMessageSubmitTransaction().setTopicId(topicId)
      .setMessage(JSON.stringify({ type: 'invoice-anchor', invoiceId: INVOICE.invoiceId, sha256: invoiceHash }))
      .execute(smeClient)).getReceipt(smeClient)
    const tokenId = (await (await (await new TokenCreateTransaction()
      .setTokenName(`Invoice ${INVOICE.invoiceId}`)
      .setTokenSymbol('INV-8842')
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(0)
      .setInitialSupply(INVOICE.units)
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(INVOICE.units)
      .setTreasuryAccountId(sme.accountId)
      .setAdminKey(sme.privateKey.publicKey)
      .setTokenMemo(`rwa:invoice:${INVOICE.invoiceId}:sha256:${invoiceHash.slice(0, 16)}`)
      // The operator pays the ~15 ℏ creation fee; the SME still signs as treasury and admin
      .freezeWith(client)
      .sign(sme.privateKey)).execute(client)).getReceipt(client)).tokenId
    console.log(`[SUCCESS] Invoice anchored on topic ${topicId}; token ${tokenId} (treasury: SME)`)

    // 4. Advance: atomic delivery-versus-payment
    console.log('\n[PROCESS] Step 4: Investor buys the receivable — HBAR and tokens swap atomically...')
    const advanceTx = await new TransferTransaction()
      .addHbarTransfer(investor.accountId, Hbar.fromTinybars(-advanceTinybars))
      .addHbarTransfer(sme.accountId, Hbar.fromTinybars(advanceTinybars))
      .addTokenTransfer(tokenId, sme.accountId, -INVOICE.units)
      .addTokenTransfer(tokenId, investor.accountId, INVOICE.units)
      .setTransactionMemo(`rwa:factoring_advance:${INVOICE.invoiceId}`)
      .freezeWith(client)
    await advanceTx.sign(investor.privateKey)
    await advanceTx.sign(sme.privateKey)
    const advanceRes = await advanceTx.execute(client)
    await advanceRes.getReceipt(client)
    console.log(`[SUCCESS] Advance settled — ${advanceRes.transactionId} | ${getHashscanUrl(advanceRes)}`)

    // 5. Maturity: debtor pays face value; tokens are redeemed to the SME treasury
    console.log('\n[PROCESS] Step 5: Maturity — debtor pays the investor; invoice tokens are redeemed...')
    const invBefore = await getMirrorHbarTinybars(investor.accountId.toString())
    const maturityTx = await new TransferTransaction()
      .addHbarTransfer(debtor.accountId, Hbar.fromTinybars(-faceTinybars))
      .addHbarTransfer(investor.accountId, Hbar.fromTinybars(faceTinybars))
      .addTokenTransfer(tokenId, investor.accountId, -INVOICE.units)
      .addTokenTransfer(tokenId, sme.accountId, INVOICE.units)
      .setTransactionMemo(`rwa:maturity_payout:${INVOICE.invoiceId}`)
      .freezeWith(client)
    await maturityTx.sign(debtor.privateKey)
    await maturityTx.sign(investor.privateKey)
    const maturityRes = await maturityTx.execute(client)
    await maturityRes.getReceipt(client)
    console.log(`[SUCCESS] Maturity settled — ${maturityRes.transactionId} | ${getHashscanUrl(maturityRes)}`)

    await sleep(6000)
    const invAfter = await getMirrorHbarTinybars(investor.accountId.toString())
    console.log(`[VERIFY] Investor received ${invAfter - invBefore} tinybars at maturity (paid ${advanceTinybars} upfront, profit ${faceTinybars - advanceTinybars})`)
    smeClient.close()

    updateState('RWA_INVOICE_TOKEN_ID', tokenId.toString())
    updateState('RWA_INVOICE_TOPIC_ID', topicId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('Three independent parties settled a factoring cycle with two atomic transactions:')
    console.log('cash and receivable always moved together, with no escrow contract.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Invoice factoring failed:', error.message)
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
