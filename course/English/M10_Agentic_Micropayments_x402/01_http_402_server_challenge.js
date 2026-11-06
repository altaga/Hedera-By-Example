/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */

import '@x402/fetch' // Node-only: official x402 client stack

/**
 * ============================================================================
 * Lab 01: Server HTTP 402 Challenge Generation
 * [CONCEPT] Official x402 v2 Payment Required wire format
 * ============================================================================
 * [ KEY CONCEPT ]
 * The official x402 v2 resource server answers an unpaid request with HTTP 402
 * and a Base64 PAYMENT-REQUIRED header. The decoded JSON uses x402Version: 2,
 * a resource object, and an accepts[] list with scheme "exact", network
 * "hedera:testnet", asset, amount, payTo, and extra.feePayer from the facilitator.
 *
 * [ LEARNABLE MOMENT ]
 * Custom x402-* headers are not the protocol. Compliant agents look for
 * PAYMENT-REQUIRED and talk to a facilitator that advertises hedera:testnet.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://docs.hedera.com/solutions/ai/x402/merchant-integration
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 11: A2A Encrypted Handshake
 * - Next:     M10 Lab 02: Agent Payment Signature
 *
 * [SEQUENCE]
 * Agent -> Server: GET /api/v1/alpha-intelligence/market-depth
 * Server -> Agent: 402 + PAYMENT-REQUIRED (exact / hedera:testnet / feePayer)
 *
 * [SIMULATED]
 * Nothing is simulated: this boots a real Express server with @x402/express middleware.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: OPERATOR_ID + OPERATOR_PRIVATE_KEY and a distinct MERCHANT_ID (payTo).
 * - Cost: network fees only when a client later pays (this lab only issues 402).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/01_http_402_server_challenge.js
 * ============================================================================
 */

import {
  createPaidExpressApp,
  listenLocal,
  decodePaymentRequiredHeader,
  fetchFacilitatorFeePayer,
  getOperatorContext,
  LAB_PRICE_TINYBARS,
  HBAR_ASSET_ID,
  X402_FACILITATOR_URL,
  X402_NETWORK
} from '../M99_Utilities/index.js'
import { updateState as persist } from '../M99_Utilities/storage.js'

const main = async () => {
  console.log('--- SESSION START: Official x402 Server Challenge (v2) ---\n')
  const { merchantId } = getOperatorContext()
  const { feePayer } = await fetchFacilitatorFeePayer()
  console.log(`[INFO] Facilitator: ${X402_FACILITATOR_URL}`)
  console.log(`[INFO] Advertised feePayer: ${feePayer}`)
  console.log(`[INFO] Merchant payTo: ${merchantId}`)

  const resourcePath = '/api/v1/alpha-intelligence/market-depth'
  const { app } = createPaidExpressApp({
    route: `GET ${resourcePath}`,
    payTo: merchantId,
    price: { amount: LAB_PRICE_TINYBARS.challenge, asset: HBAR_ASSET_ID },
    description: 'Alpha intelligence market-depth feed'
  })

  const { server, baseUrl } = await listenLocal(app)
  try {
    console.log(`\n[PROCESS] Unauthenticated GET ${baseUrl}${resourcePath}`)
    const res = await fetch(`${baseUrl}${resourcePath}`)
    console.log(`[LOG] HTTP status: ${res.status}`)
    const required = decodePaymentRequiredHeader(res)
    if (!required) throw new Error('Missing PAYMENT-REQUIRED header')

    console.log('\n[SUCCESS] Official PAYMENT-REQUIRED decoded:')
    console.log(`[LOG] x402Version: ${required.x402Version}`)
    console.log(`[LOG] error: ${required.error}`)
    const accept = required.accepts?.[0]
    console.log(`[LOG] scheme: ${accept?.scheme}`)
    console.log(`[LOG] network: ${accept?.network}`)
    console.log(`[LOG] asset: ${accept?.asset}`)
    console.log(`[LOG] amount (tinybars): ${accept?.amount}`)
    console.log(`[LOG] payTo: ${accept?.payTo}`)
    console.log(`[LOG] feePayer: ${accept?.extra?.feePayer}`)

    if (required.x402Version !== 2) throw new Error('Expected x402Version 2')
    if (accept?.network !== X402_NETWORK) throw new Error('Unexpected network')
    if (accept?.extra?.feePayer !== feePayer) {
      console.log('[WARN] feePayer in challenge differs from /supported snapshot (facilitator may have rotated).')
    }

    persist('X402_LAB01_BASE_URL', baseUrl)
    persist('X402_LAB01_PATH', resourcePath)
    persist('X402_CHALLENGE_PAYEE', merchantId)
    persist('X402_CHALLENGE_AMOUNT', accept.amount)
    persist('X402_CHALLENGE_ASSET', accept.asset)
    persist('X402_FEE_PAYER', accept?.extra?.feePayer || feePayer)

    console.log('\n KEY CONCEPT:')
    console.log('This challenge is interoperable with @x402/fetch and the public facilitator.')
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    server.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => process.exit(0)).catch((e) => {
    console.error('[FAILED]', e.message)
    process.exit(1)
  })
}
