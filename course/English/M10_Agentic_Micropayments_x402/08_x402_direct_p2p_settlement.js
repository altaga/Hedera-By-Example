/* eslint-disable camelcase, no-unused-vars */

import '@x402/fetch' // Node-only: official x402 client stack

/**
 * ============================================================================
 * Lab 08: x402 Facilitated Settlement (Official exact Scheme)
 * [CONCEPT] Official facilitator flow (replaces homemade Direct P2P)
 * ============================================================================
 * [ KEY CONCEPT ]
 * Earlier curriculum drafts showed a "Direct P2P" pattern (buyer submits a
 * TransferTransaction and retries with PAYMENT-TXID / memo nonces). That pattern
 * is NOT the official Hedera exact scheme. Official Hedera x402 requires a
 * facilitator feePayer that /verify and /settle the partially signed transfer.
 *
 * This lab keeps the historical slug for continuity but implements the official
 * facilitated flow end-to-end.
 *
 * [ LEARNABLE MOMENT ]
 * If you need trust-minimized P2P without a facilitator, that is a custom app
 * protocol — label it honestly and do not call it x402 exact on Hedera.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/how-it-works
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 07: Live AI Streaming Gateway
 * - Module Finish: Official x402 suite
 *
 * [SEQUENCE]
 * Buyer -> Seller: GET /api/v1/quantum-pricing/derivatives-matrix
 * Seller -> Buyer: 402 PAYMENT-REQUIRED (feePayer from facilitator)
 * Buyer -> Seller: PAYMENT-SIGNATURE
 * Seller -> Facilitator: /verify + /settle
 * Seller -> Buyer: 200 + PAYMENT-RESPONSE
 *
 * [SIMULATED]
 * None — official middleware + public facilitator on testnet.
 *
 * [ BEFORE YOU RUN ]
 * - OPERATOR_ID pays; MERCHANT_ID receives.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/08_x402_direct_p2p_settlement.js
 * ============================================================================
 */

import {
  createPaidExpressApp,
  listenLocal,
  createPayingFetch,
  decodePaymentRequiredHeader,
  decodePaymentResponse,
  fetchFacilitatorFeePayer,
  getOperatorContext,
  LAB_PRICE_TINYBARS,
  HBAR_ASSET_ID,
  X402_FACILITATOR_URL
} from '../M99_Utilities/index.js'
import { updateState } from '../M99_Utilities/storage.js'

const main = async () => {
  console.log('====================================================================')
  console.log('X402 LAB 08: OFFICIAL FACILITATED SETTLEMENT (slug kept for history)')
  console.log('NOTE: Homemade Direct P2P / PAYMENT-TXID is NOT official Hedera x402.')
  console.log('====================================================================\n')

  const { operatorId, operatorKey, merchantId } = getOperatorContext()
  const { feePayer } = await fetchFacilitatorFeePayer()
  console.log(`[INFO] Facilitator ${X402_FACILITATOR_URL} feePayer=${feePayer}`)

  const pathName = '/api/v1/quantum-pricing/derivatives-matrix'
  const { app } = createPaidExpressApp({
    route: `GET ${pathName}`,
    payTo: merchantId,
    price: { amount: LAB_PRICE_TINYBARS.p2p, asset: HBAR_ASSET_ID },
    description: 'Official facilitated derivatives matrix',
    handler: (_req, res) => res.json({
      symbol: 'HBAR/USD-PERP',
      volatilityIndex: 42.8,
      architecture: 'facilitated_exact_hedera'
    })
  })
  const { server, baseUrl } = await listenLocal(app)
  try {
    const unpaid = await fetch(`${baseUrl}${pathName}`)
    const required = decodePaymentRequiredHeader(unpaid)
    console.log('[402] PAYMENT-REQUIRED accept:', JSON.stringify(required.accepts[0]))

    const fetchPaid = createPayingFetch(operatorId.toString(), operatorKey)
    const paid = await fetchPaid(`${baseUrl}${pathName}`)
    const settlement = decodePaymentResponse(paid)
    console.log(`[SUCCESS] HTTP ${paid.status}`)
    console.log('[LOG] PAYMENT-RESPONSE:', JSON.stringify(settlement))
    console.log('[LOG] Body:', await paid.text())
    if (paid.status !== 200 || !settlement?.success) throw new Error('Official facilitated settlement failed')

    updateState('X402_DIRECT_TX_ID', settlement.transaction || '')
    updateState('X402_LAB08_MODE', 'facilitated_official')
    console.log('\n KEY CONCEPT: This slug no longer teaches Direct P2P as official x402.')
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    server.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => process.exit(0)).catch((e) => { console.error('[FAILED]', e.message); process.exit(1) })
}
