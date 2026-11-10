/**
 * ============================================================================
 * Lab 08: Two-Party Settlement (Merchant as Facilitator)
 * [CONCEPT] x402 Between a Buyer and a Seller, With No Third Party
 * ============================================================================
 * [ KEY CONCEPT ]
 * Two Topologies, One Protocol: In Labs 01-07 three parties took part: the
 * buyer, the seller and a facilitator that paid the network fee. The seller can
 * also run the facilitator itself: it puts its own account in extra.feePayer,
 * verifies the buyer's signed transfer, co-signs it and submits it. The buyer
 * does exactly the same as before and still needs no HBAR for gas; the seller
 * receives the price and pays the fee out of it, then audits the settlement on
 * the Mirror Node.
 * *
 * [ LEARNABLE MOMENT ]
 * The wire format does not change between topologies: the buyer cannot tell, and does not need to know, who hosts the facilitator. Hosting it means holding a funded key that co-signs payments, so its checks (fee payer, amount, payee, signature, expiry) are what protect the seller.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/facilitators
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 07: Live AI Streaming Proxy Gateway (SSE + x402 Settlement)
 * - Next:     M10 Lab 09: Metered Payments with the x402 upto Scheme
 *
 * [ SEQUENCE ]
 * Buyer -> Seller: GET /api/v1/quantum-pricing/derivatives-matrix
 * Seller -> Buyer: 402 (payTo = feePayer = seller)
 * Note Buyer: Signs the transfer, as in Lab 02
 * Buyer -> Seller: Retry with PAYMENT-SIGNATURE
 * Seller -> Hedera: Verifies, co-signs and submits with its own key
 * Seller -> Hedera: Audits the settlement on the Mirror Node
 * Seller -> Buyer: 200 OK + PAYMENT-RESPONSE
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account only tops up the practice wallets if they run low.
 * - Practice wallets: ACCOUNT_1 is the buyer, ACCOUNT_2 the seller (and its own facilitator).
 * - Cost: 0.01 ℏ from ACCOUNT_1 to ACCOUNT_2; ACCOUNT_2 pays about 0.003 ℏ in fees.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/08_self_hosted_facilitator.js
 * ============================================================================
 */

import {
  getClient,
  createClient,
  updateState,
  getHashscanUrl,
  ensureFunded,
  waitForMirror,
  encodeHeader,
  decodeHeader,
  createPaymentRequired,
  signExactPayment,
  verifyExactPayment,
  settleExactPayment,
  getTransactionRecord
} from '../M99_Utilities/index.js'

const main = async () => {
  console.log('====================================================================')
  console.log('X402 LAB 08: TWO-PARTY SETTLEMENT (MERCHANT AS FACILITATOR)')
  console.log('====================================================================\n')
  const { client } = getClient()
  const buyerId = process.env.ACCOUNT_1_ID
  const buyerKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const sellerId = process.env.ACCOUNT_2_ID
  const sellerKey = process.env.ACCOUNT_2_PRIVATE_KEY

  if (!buyerId || !buyerKey || !sellerId || !sellerKey) {
    console.error('[FAILED] Missing credentials in .env (ACCOUNT_1 buyer, ACCOUNT_2 seller).')
    process.exitCode = 1
    return
  }

  // The seller signs and pays with its own account.
  const sellerClient = createClient(sellerId, sellerKey)

  try {
    // The buyer needs the price; the seller needs HBAR for the fees it now pays.
    await ensureFunded(client, buyerId, 1)
    await ensureFunded(client, sellerId, 1)

    // 1. Seller issues the 402: it is both payTo and feePayer
    const priceTinybars = 1_000_000 // 0.01 HBAR
    console.log('[PROCESS] Phase 1: Seller issuing HTTP 402 with itself as fee payer...')
    const paymentRequiredHeader = encodeHeader(createPaymentRequired({
      resource: '/api/v1/quantum-pricing/derivatives-matrix',
      description: 'Derivatives volatility matrix',
      payTo: sellerId,
      amount: priceTinybars,
      feePayer: sellerId
    }))
    console.log(`[LOG] PAYMENT-REQUIRED: ${priceTinybars / 1e8} HBAR to ${sellerId}, fee payer ${sellerId}`)

    // 2. Buyer signs, exactly as with a third-party facilitator
    console.log('\n[PROCESS] Phase 2: Buyer signing the transfer (no HBAR needed for gas)...')
    const payment = await signExactPayment(client, decodeHeader(paymentRequiredHeader), buyerId, buyerKey)
    const paymentSignatureHeader = encodeHeader(payment)
    console.log(`[LOG] PAYMENT-SIGNATURE: ${paymentSignatureHeader.substring(0, 48)}...`)

    // 3. Seller verifies the payment with its own facilitator checks
    console.log('\n[PROCESS] Phase 3: Seller verifying the signed transfer...')
    const check = await verifyExactPayment(decodeHeader(paymentSignatureHeader), sellerId)
    if (!check.isValid) throw new Error(`Payment rejected: ${check.invalidReason}`)
    console.log(`[SUCCESS] Valid: fee payer, amount, payee and the signature of ${check.payer} all check out.`)

    // 4. Seller co-signs as fee payer and submits with its own client
    console.log('\n[PROCESS] Phase 4: Seller co-signing and submitting to Hedera...')
    const settlement = await settleExactPayment(sellerClient, decodeHeader(paymentSignatureHeader), sellerKey)
    if (!settlement.success) throw new Error(`Settlement failed: ${settlement.errorReason}`)
    console.log(`[SUCCESS] Settled! Status: ${settlement.status}`)
    console.log(`[LOG] Transaction ID: ${settlement.transaction}`)
    console.log(`[EXPLORER] HashScan: ${getHashscanUrl(settlement.transaction)}`)

    // 5. Seller audits the settlement on the Mirror Node before releasing the data
    console.log('\n[PROCESS] Phase 5: Seller auditing the transaction on the Mirror Node...')
    const record = await waitForMirror(() => getTransactionRecord(settlement.transaction))
    if (!record || record.result !== 'SUCCESS') throw new Error('The settlement is not visible on the Mirror Node yet.')
    const net = (id) => record.transfers.filter((t) => t.account === id).reduce((sum, t) => sum + t.amount, 0) -
      (record.staking_reward_transfers || []).filter((t) => t.account === id).reduce((sum, t) => sum + t.amount, 0)
    console.log(`[LOG] Buyer ${buyerId}:  ${net(buyerId) / 1e8} HBAR`)
    console.log(`[LOG] Seller ${sellerId}: +${net(sellerId) / 1e8} HBAR (price ${priceTinybars / 1e8} − fee ${record.charged_tx_fee / 1e8})`)

    console.log('\n[SUCCESS] Seller Unlocks Resource: HTTP 200 OK')
    console.log(`[LOG] PAYMENT-RESPONSE: ${JSON.stringify({ success: true, network: settlement.network, payer: settlement.payer, transaction: settlement.transaction })}`)
    console.log('[LOG] Response Body: {"symbol": "HBAR/USD-PERP", "volatilityIndex": 42.8}')

    // 6. Architectural comparison
    console.log('\n===================================================================')
    console.log('X402 TOPOLOGIES ON HEDERA')
    console.log('===================================================================')
    console.log('Three parties (Labs 01-07):  buyer signs, a facilitator pays the fee and submits')
    console.log('Two parties (this lab):       buyer signs, the seller pays the fee and submits')
    console.log('Same for both:                PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE,')
    console.log('                              the buyer never needs HBAR for gas')
    console.log('===================================================================')

    updateState('X402_SELF_HOSTED_TX_ID', settlement.transaction)

    console.log('\n KEY CONCEPT:')
    console.log('No middleman took part: the seller verified, co-signed and submitted the')
    console.log('payment itself, and audited it on the Mirror Node. The buyer did nothing')
    console.log('different, because the x402 messages are the same in both topologies.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Two-party settlement failed:', error.message)
    process.exitCode = 1
  } finally {
    sellerClient.close()
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
