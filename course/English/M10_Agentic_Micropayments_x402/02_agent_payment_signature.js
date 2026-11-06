/* eslint-disable camelcase, no-unused-vars */

import '@x402/fetch' // Node-only: official x402 client stack

/**
 * ============================================================================
 * Lab 02: Autonomous Agent Payment Signature
 * [CONCEPT] Official client signer + PAYMENT-SIGNATURE auto-retry
 * ============================================================================
 * [ KEY CONCEPT ]
 * @x402/hedera builds a partially signed TransferTransaction whose
 * transactionId.accountId is the facilitator's feePayer. @x402/fetch then
 * retries the request with a Base64 PAYMENT-SIGNATURE header (x402 v2).
 *
 * [ LEARNABLE MOMENT ]
 * Agents do not invent JSON "intent" signatures. They sign the Hedera
 * cryptoTransfer the exact scheme requires, then let the facilitator co-sign gas.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/pay-with-x402
 * - https://www.npmjs.com/package/@x402/fetch
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 01: Server 402 Challenge
 * - Next:     M10 Lab 03: Facilitator Settlement
 *
 * [SEQUENCE]
 * Server -> Agent: 402 + PAYMENT-REQUIRED
 * Note Agent: createClientHederaSigner + ExactHederaScheme
 * Agent -> Server: retry with PAYMENT-SIGNATURE
 * Server -> Agent: 200 + resource
 *
 * [SIMULATED]
 * Nothing simulated beyond a local Express resource server.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: OPERATOR_ID pays; MERCHANT_ID receives.
 * - Cost: ~0.001 HBAR transfer + facilitator-sponsored network fee.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/02_agent_payment_signature.js
 * ============================================================================
 */

import {
  createPaidExpressApp,
  listenLocal,
  createPayingFetch,
  decodePaymentRequiredHeader,
  decodePaymentResponse,
  getOperatorContext,
  LAB_PRICE_TINYBARS,
  HBAR_ASSET_ID
} from '../M99_Utilities/index.js'
import { updateState } from '../M99_Utilities/storage.js'

const main = async () => {
  console.log('--- SESSION START: Official Agent Payment Signature ---\n')
  const { operatorId, operatorKey, merchantId } = getOperatorContext()
  const pathName = '/api/v1/alpha-intelligence/market-depth'
  const { app } = createPaidExpressApp({
    route: `GET ${pathName}`,
    payTo: merchantId,
    price: { amount: LAB_PRICE_TINYBARS.challenge, asset: HBAR_ASSET_ID },
    description: 'Signed agent access',
    handler: (_req, res) => res.json({ alpha_signal: 'BULLISH_CONVERGENCE', confidence: 0.942 })
  })
  const { server, baseUrl } = await listenLocal(app)
  try {
    const unpaid = await fetch(`${baseUrl}${pathName}`)
    const required = decodePaymentRequiredHeader(unpaid)
    console.log(`[LOG] Challenge x402Version=${required.x402Version} amount=${required.accepts[0].amount} tinybars`)

    const fetchPaid = createPayingFetch(operatorId.toString(), operatorKey)
    console.log('[PROCESS] @x402/fetch auto-pays and retries...')
    const paid = await fetchPaid(`${baseUrl}${pathName}`)
    console.log(`[SUCCESS] HTTP ${paid.status}`)
    const settlement = decodePaymentResponse(paid)
    console.log('[LOG] PAYMENT-RESPONSE:', JSON.stringify(settlement))
    console.log('[LOG] Body:', await paid.text())
    if (paid.status !== 200 || !settlement?.success) throw new Error('Payment did not settle')
    updateState('X402_LAB02_TX', settlement.transaction || '')
    updateState('X402_LAB02_PAYER', settlement.payer || operatorId.toString())
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    server.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => process.exit(0)).catch((e) => { console.error('[FAILED]', e.message); process.exit(1) })
}
